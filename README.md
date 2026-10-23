# Saaphzone AQI Monitoring Portal — 3-Tier Architecture

© 2026 **Saaphzone Technologies LLP**. All rights reserved.
Proprietary and confidential.

A secure, enterprise-grade, 3-tier monitoring system for ambient air quality (PM2.5, PM10, AQI) with MAAPS hardware telemetry, filter differential pressure monitoring, rain detection, hysteresis setpoint controls, and role-based access control (Admin, Service, Client).

---

## 🏛️ Architecture Overview

The system is cleanly separated into three independent layers:

```
AQI Dashboard/
├── database/            # Database Tier (PostgreSQL)
│   ├── schema.sql       # Full DDL schema (users, sites, devices, readings, audit)
│   ├── seed.sql         # Seed data SQL
│   ├── seed.js          # Node.js seeder with bcrypt hashing
│   ├── init.js          # One-step database initializer
│   ├── docker-compose.yml # Containerized PostgreSQL definition
│   └── README.md        # Database documentation
│
├── backend/             # Application Tier (Node.js / Express API)
│   ├── src/
│   │   ├── db.js        # PostgreSQL connection pool & queries
│   │   ├── auth.js      # JWT signing/verification, bcrypt hashing, RBAC & client scoping
│   │   ├── aqi.js       # CPCB India AQI calculation engine
│   │   ├── health.js    # MAAPS telemetry, fan & differential pressure evaluation
│   │   └── server.js    # Express REST API with CORS, Helmet, and rate limiting
│   ├── test.js          # Automated integration test suite (28 tests)
│   ├── .env.example     # Environment template
│   ├── .env             # Active environment settings
│   ├── Dockerfile       # Container definition
│   └── package.json     # Backend dependencies (pg, express, bcryptjs, etc.)
│
├── frontend/            # Presentation Tier (Modular Client SPA)
│   ├── index.html       # Semantic HTML5 layout
│   ├── css/
│   │   └── style.css    # Modern UI design system with animations & dark sidebar
│   ├── js/
│   │   ├── config.js    # Configurable backend API endpoint (default: http://localhost:5000/api)
│   │   ├── api.js       # Unified HTTP fetch client with Bearer token & cookie credentials
│   │   ├── aqi.js       # Client AQI sub-index calculator
│   │   ├── health.js    # Hardware SVG widgets (rotating fan, pressure gauge, rain box)
│   │   └── app.js       # Main UI controller, Leaflet map, Chart.js trends, modals
│   ├── server.js        # Zero-dependency static dev server (port 3000)
│   ├── Dockerfile       # Container definition
│   └── package.json     # Frontend scripts
│
├── docker-compose.yml   # Full stack orchestration (PostgreSQL + Backend + Frontend)
└── package.json         # Root scripts (npm run backend:dev, npm run frontend:dev, etc.)
```

---

## 🚀 Quick Start Guide

### Prerequisites
- **Node.js** 18+ (tested on Node 22 / 24)
- **PostgreSQL** 14+ running locally (or Docker)

---

### Step 1: Database Setup (PostgreSQL)

Ensure PostgreSQL service is running on `localhost:5432`.

To initialize the database schema and seed default data automatically, run:
```bash
node database/init.js
```
Or from root:
```bash
npm run db:init
```

This will:
1. Connect to PostgreSQL and create the database `saaphzone_aqi` if not already present.
2. Apply the table schemas (`users`, `sites`, `devices`, `readings`, `audit`).
3. Seed the default administrative accounts, client organisations, monitoring sites, and MAAPS devices with encrypted password hashes.

---

### Step 2: Start the Backend API

```bash
cd backend
npm install
npm start
```
*Backend runs at:* **`http://localhost:5000`**

Health check endpoint:
```
GET http://localhost:5000/api/health
```

Run automated backend tests:
```bash
npm test
```
*(All 28 integration tests execute against the PostgreSQL database).*

---

### Step 3: Start the Frontend Client

In a separate terminal:
```bash
cd frontend
npm start
```
*Frontend runs at:* **`http://localhost:3000`**

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🌐 Production Endpoints

- **Primary Dashboard URL:** [https://aqidashboard-welx.onrender.com](https://aqidashboard-welx.onrender.com)
- **Monitoring Sites Endpoint:** [https://aqidashboard-welx.onrender.com/api/sites](https://aqidashboard-welx.onrender.com/api/sites)

---

## 🔑 Default Seed Credentials & Site Passwords

| Role / Type | Username / Code | Default Password | Access Scope |
| :--- | :--- | :--- | :--- |
| **Admin** | `admin` | `Sz9#vK!7mP@26%AdmX` | Full administrative control, user management, audit logs |
| **Service** | `service` | `Sv8!wL#4qR&26*EngY` | Hardware controls, sites & device registration, telemetry |
| **Client** | `escorts` | `ChangeMe#Client1` | Scoped read-only access to Escorts Kubota Ltd |
| **Client** | `santosh` | `ChangeMe#Client1` | Scoped read-only access to Santosh Medical College |
| **Site S1** | `S1` | `Site#Faridabad1` | Direct site login: Faridabad Plant-1 |
| **Site S2** | `S2` | `Site#Faridabad3` | Direct site login: Faridabad Plant-3 |
| **Site S3** | `S3` | `Site#Ghaziabad3` | Direct site login: Ghaziabad Campus |

> **Manual Site Passwords:** Administrators and Service engineers can manually create or reset passwords for each site via the **Projects &amp; Sites** panel (`🔑 Password` button on each site card) or during site creation. Site users can log in directly using the Site Code and site password under the **Client** login tab.

---

## 🔒 Security Highlights

- **Bcrypt Password Encryption (Cost 12)**: Passwords never stored in plaintext.
- **JWT Authentication in HTTP-Only Cookies & Authorization Headers**: Immune to JavaScript token theft.
- **Server-Side Data Scoping**: Client users physically cannot query or access another client's sites or telemetry; filters are enforced in SQL on the server.
- **Hardware API Key Authentication**: Each ambient sensor authenticates via unique `X-Device-Key` header; keys are never exposed to client users.
- **Defense in Depth**: Helmet CSP, HSTS, rate limiters (login, general API, and high-frequency ingest), and parameterised SQL queries against SQL injection.

---

## 🐳 Running with Docker Compose (Optional)

To spin up all three layers together in Docker:
```bash
docker-compose up -d --build
```
- PostgreSQL: `localhost:5432`
- Backend API: `http://localhost:5000`
- Frontend UI: `http://localhost:3000`
