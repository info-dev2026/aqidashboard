# Saaphzone AQI Monitoring Portal — MAAPS Ambient Air Network

© 2026 **Saaphzone Technologies LLP**. All rights reserved.
Proprietary and confidential. Unauthorized copying, distribution, or use of this
software, via any medium, is strictly prohibited.

A secure, server-backed portal for monitoring PM2.5 / PM10 and computed AQI from
MAAPS ambient air devices, organised by project → site → device, with role-based
access (Admin / Service / Client) and a device data-ingestion API.

---

## Why this is secure (and the single-file version was not)

The earlier single-file HTML prototype kept all users, passwords and data inside
the browser — anyone could open the page source and read every credential. That
can never be made secure. This version fixes it properly:

- **Passwords are hashed** with bcrypt (cost 12) and stored server-side. The
  browser never receives any password hash.
- **Login is server-side** and returns a signed **JWT in an httpOnly, Secure,
  SameSite=strict cookie** — JavaScript cannot read it, which blocks XSS token theft.
- **Every data request is authorized on the server.** A client login is filtered
  to its own organisation in the database query itself — a client physically
  cannot fetch another client's sites or devices, even by editing the request.
- **Device API keys are never sent to client users** and are shown to admins once.
- **Rate limiting** on login (10 / 15 min), API (120 / min) and ingest (240 / min).
- **helmet** sets CSP, HSTS, and removes `X-Powered-By`.
- **Input validation** and a 64 KB body cap; parameterised SQL (no injection).
- **Audit log** records logins, user changes, key views, deletions.
- **HTTPS enforced** in production.

> No client-side-only file can provide any of the above. This backend is the part
> that actually keeps people out.

---

## Requirements

- Node.js 18+ (tested on Node 22)

## Setup

```bash
npm install
cp .env.example .env          # then edit .env
# generate a strong secret:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
# paste it as JWT_SECRET in .env

npm run seed                  # creates initial users/sites/devices (prints device keys)
npm start                     # http://localhost:3000
```

> **Note on passwords in `.env`:** if a password contains `#` or spaces, wrap it in
> quotes, e.g. `SEED_ADMIN_PW="ChangeMe#Admin1"`. An unquoted `#` is treated as a
> comment and will silently truncate the password.

### Default seed logins (change immediately in production)

| Role    | User ID   | Password (from .env)   | Scope                     |
|---------|-----------|------------------------|---------------------------|
| Admin   | `admin`   | `SEED_ADMIN_PW`        | Everything                |
| Service | `service` | `SEED_SERVICE_PW`      | Sites, devices, data      |
| Client  | `escorts` | `SEED_CLIENT_PW`       | Escorts Kubota only       |
| Client  | `santosh` | `SEED_CLIENT_PW`       | Santosh Medical only      |

The primary `admin` account cannot be deleted through the UI or API.

---

## Roles

- **Admin** — full access plus **User Management**: create users, reset any
  password, delete users; view the audit log.
- **Service** — add/edit projects, sites and devices; view all data and device keys.
- **Client** — read-only, sees only its own organisation's sites, devices and AQI.

---

## Device types

When adding a device you choose one of two types:

- **MAAPS Ambient Air Device** — PM2.5 + PM10 → AQI, **plus** the full health &
  control panel: running fan animation, power ON/OFF light (green/red), inlet &
  outlet **pressure gauges** with service colour-coding, **rain sensor** with
  auto-off, data-transmission toggle, and GPS location.
- **Basic PM Sensor** — PM2.5 + PM10 → AQI only (no fan / pressure / rain hardware).

## MAAPS device health & control

Each MAAPS device shows, in its **Details** panel:

- **Fan** — spins while the device is running, stops when off.
- **Power light** — green = running, red = off; auto-off while raining is labelled.
- **Filter pressure ΔP gauge** — differential = inlet − outlet. Colour coding:
  **green** = healthy, **amber** = monitor (rising), **red** = *service required*
  (ΔP above the service threshold = clogged filter, or ΔP ≈ 0 while running = leak).
  Thresholds are set per device (defaults: monitor 1200 Pa, service 1500 Pa).
- **Rain sensor** — animated rain/dry indicator. **When rain is detected the device
  auto-switches OFF, and auto-resumes when it stops** — unless staff set a manual
  override. A manual ON/OFF always wins over rain; "Auto" returns control to the
  rain logic.
- **PM auto start/stop (setpoint)** — each MAAPS device has a PM2.5 and PM10
  setpoint. When enabled, the device **auto-starts when both PM2.5 and PM10 rise
  above their setpoints**, and **auto-stops when both fall below** (setpoint − band).
  A **hysteresis band** (default 10 µg/m³) separates the start and stop thresholds
  so the device doesn't rapidly cycle on/off when readings hover near the line.
- **Data transmission** ON/OFF and **GPS coordinates**.

**Power priority (highest wins):** manual override → rain (off) → PM setpoint →
default on. So the purifier runs when the air is dirty enough to need it — unless
it's raining or someone has flipped it off by hand.

Admin and Service can control power (ON / OFF / Auto), transmission, and simulate
rain from the Details panel. Clients see the panel read-only.

## Device data ingestion (MAAPS → server)

Each device gets a unique API key at creation (shown once; admins/service can
re-view it from the device **Details → View API key**). The device posts readings,
optionally including health telemetry:

```bash
curl -X POST https://your-host/api/ingest \
  -H "Content-Type: application/json" \
  -H "X-Device-Key: maaps_xxxxxxxxxxxxxxxxxxxxxxxx" \
  -d '{"device_id":"MAAPS-0012","pm25":42.5,"pm10":88.0,
       "p_inlet":950,"p_outlet":350,"raining":false}'
```

Fields `p_inlet`, `p_outlet`, `raining`, and `transmit` are optional (MAAPS only).
The response returns the computed AQI, CPCB category, and the device's **effective
power state** (`power_on`, `power_reason`) so the device firmware can honour rain
auto-off and any manual override:

```json
{ "ok": true, "device_id": "MAAPS-0012", "aqi": 88, "category": "Satisfactory",
  "power_on": true, "power_reason": "auto" }
```

On success the device is marked **online**, the reading is stored in history. A
device that has not reported for 30 minutes can be swept **offline**
(`POST /api/sweep`, admin/service; wire to a cron or a periodic call).

Readings are validated (PM 0–2000 µg/m³, pressure 0–100000 Pa); bad keys or values
are rejected. Staff overrides are applied via `POST /api/devices/:id/control`
(`power: on|off|auto`, `transmit`, `raining`, `p_inlet`, `p_outlet`, `dp_warn`,
`dp_crit`, `sp_enabled`, `sp25`, `sp10`, `sp_band`).

---

## Production deployment checklist

1. Set `NODE_ENV=production` and a unique 48-byte `JWT_SECRET`.
2. Run behind **HTTPS** (nginx/Caddy or a platform that terminates TLS). The app
   redirects HTTP→HTTPS and sets HSTS when `NODE_ENV=production`.
3. Change all seed passwords; create real client accounts via User Management.
4. Back up `data/aqi.db` (SQLite, WAL mode). For higher scale, migrate to Postgres.
5. Keep `.env` and `data/` out of version control (already in `.gitignore`).
6. Put the ingest endpoint behind the same TLS; rotate a device key by deleting
   and re-adding the device if it is ever exposed.

---

## API summary

| Method | Path                         | Who            | Purpose                          |
|--------|------------------------------|----------------|----------------------------------|
| POST   | `/api/login`                 | public         | Sign in (rate-limited)           |
| POST   | `/api/logout`                | any auth       | Sign out                         |
| GET    | `/api/me`                    | any auth       | Current session                  |
| GET    | `/api/sites`                 | any auth       | Sites (client-scoped)            |
| POST   | `/api/sites`                 | admin/service  | Add site                         |
| GET    | `/api/devices`               | any auth       | Devices + live AQI (scoped)      |
| POST   | `/api/devices`               | admin/service  | Add device (returns API key once)|
| POST   | `/api/devices/:id/control`   | admin/service  | Power/transmission/rain/pressure override |
| GET    | `/api/devices/:id/key`       | admin/service  | Re-view device key               |
| DELETE | `/api/devices/:id`           | admin/service  | Delete device                    |
| GET    | `/api/devices/:id/history`   | any auth       | Reading history (scoped)         |
| POST   | `/api/ingest`                | device key     | Device pushes a reading          |
| POST   | `/api/sweep`                 | admin/service  | Mark stale devices offline       |
| GET    | `/api/users`                 | admin          | List users                       |
| POST   | `/api/users`                 | admin          | Create user                      |
| POST   | `/api/users/:id/password`    | admin          | Reset password                   |
| DELETE | `/api/users/:id`             | admin          | Delete user                      |
| GET    | `/api/audit`                 | admin          | Audit log                        |

---

## Tests

```bash
node test.js
```

Covers authentication, wrong-password and role-mismatch rejection, client data
scoping, RBAC blocks, device-key non-leakage, tampered-token rejection, password
policy, device ingestion with key auth, out-of-range rejection, and security
headers.
