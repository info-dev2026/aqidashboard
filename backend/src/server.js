/*
 * Saaphzone AQI Monitoring Portal — MAAPS Ambient Air Network
 * Secure Node.js / Express backend with PostgreSQL
 * © 2026 Saaphzone Technologies LLP. All rights reserved.
 */
'use strict';

require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');

const { query, getClient, audit } = require('./db');
const aqi = require('./aqi');
const H = require('./health');
const A = require('./auth');

const app = express();
const PROD = process.env.NODE_ENV === 'production';
app.set('trust proxy', 1);

/* ---------------- CORS Configuration ---------------- */
const allowedOrigins = (
  process.env.CORS_ORIGIN ||
  'http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173'
)
  .split(',')
  .map((s) => s.trim());

app.use(
  cors({
    origin: (origin, callback) => {
      if (
        !origin ||
        allowedOrigins.includes(origin) ||
        origin.startsWith('http://localhost:') ||
        origin.startsWith('http://127.0.0.1:') ||
        !PROD
      ) {
        callback(null, true);
      } else {
        callback(null, true);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-Key']
  })
);

/* ---------------- Security Middleware ---------------- */
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://cdnjs.cloudflare.com'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com'],
        imgSrc: ["'self'", 'data:', 'https://*.tile.openstreetmap.org'],
        connectSrc: ["'self'", '*'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"]
      }
    },
    crossOriginEmbedderPolicy: false,
    hsts: PROD ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false
  })
);

app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: true, limit: '64kb' }));
app.use(cookieParser());

// Force HTTPS in production
if (PROD) {
  app.use((req, res, next) => {
    if (req.secure || req.headers['x-forwarded-proto'] === 'https') return next();
    res.redirect(308, 'https://' + req.headers.host + req.url);
  });
}

/* ---------------- Rate Limiters ---------------- */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false
});

const ingestLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 240,
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api/', apiLimiter);

const ip = (req) => req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
const cookieOpts = {
  httpOnly: true,
  secure: PROD,
  sameSite: PROD ? 'none' : 'lax',
  maxAge: 2 * 60 * 60 * 1000
};

function num(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Build the enriched device object with computed AQI + health/power state.
function enrichDevice(r) {
  const pw = H.effectivePower({
    power_manual: r.power_manual,
    raining: !!r.raining,
    pm25: r.pm25,
    pm10: r.pm10,
    sp25: r.sp25,
    sp10: r.sp10,
    sp_band: r.sp_band,
    sp_enabled: !!r.sp_enabled,
    currently_on: r.power === undefined ? true : !!r.power
  });
  const running = pw.on && r.status === 'online';
  const press = H.pressureStatus(r.p_inlet, r.p_outlet, r.dp_warn, r.dp_crit, running);
  return {
    ...r,
    dev_type: r.dev_type || 'maaps',
    transmit: !!r.transmit,
    raining: !!r.raining,
    sp_enabled: !!r.sp_enabled,
    power_on: pw.on,
    power_reason: pw.reason,
    running,
    pressure: press,
    aqi: r.status === 'online' ? aqi.computeAQI(r.pm25, r.pm10) : null
  };
}

/* ================= HEALTH CHECK ================= */
app.get('/api/health', async (req, res) => {
  try {
    await query('SELECT 1');
    res.json({ status: 'ok', database: 'postgresql', timestamp: new Date() });
  } catch (err) {
    res.status(503).json({ status: 'error', database: 'unreachable', message: err.message });
  }
});

/* ================= AUTH ================= */
app.post('/api/login', loginLimiter, async (req, res) => {
  const { username, password, role } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Username and password required' });
  }

  try {
    const userResult = await query(
      'SELECT * FROM users WHERE username = $1 AND active = 1',
      [username.trim()]
    );
    const u = userResult.rows[0];

    // Constant-ish failure path to mitigate timing attacks
    const ok = u
      ? A.verify(password, u.pass_hash)
      : A.verify(password, '$2a$12$......................................');

    if (!u || !ok || (role && u.role !== role)) {
      await audit(username, 'login_fail', `role=${role}`, ip(req));
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = A.sign(u);
    res.cookie('szsession', token, cookieOpts);
    await audit(u.username, 'login_ok', `role=${u.role}`, ip(req));
    res.json({
      token,
      user: { username: u.username, role: u.role, name: u.name, client: u.client }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Authentication service error' });
  }
});

app.post('/api/logout', A.authRequired, async (req, res) => {
  await audit(req.user.u, 'logout', null, ip(req));
  res.clearCookie('szsession', cookieOpts);
  res.json({ ok: true });
});

app.get('/api/me', A.authRequired, (req, res) => {
  res.json({ username: req.user.u, role: req.user.role, name: req.user.u, client: req.user.client });
});

/* ================= SITES ================= */
app.get('/api/sites', A.authRequired, async (req, res) => {
  try {
    const scope = A.scopeClient(req);
    const sql = scope
      ? 'SELECT * FROM sites WHERE client = $1 ORDER BY project, name'
      : 'SELECT * FROM sites ORDER BY project, name';
    const params = scope ? [scope] : [];
    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Fetch sites error:', err);
    res.status(500).json({ error: 'Failed to fetch sites' });
  }
});

app.post('/api/sites', A.authRequired, A.requireRole('admin', 'service'), async (req, res) => {
  const { name, client, project, lat, lng } = req.body || {};
  if (!name || !client) {
    return res.status(400).json({ error: 'Site name and client required' });
  }

  const code = 'S' + Date.now().toString(36).toUpperCase();
  try {
    await query(
      'INSERT INTO sites (code, name, client, project, lat, lng) VALUES ($1, $2, $3, $4, $5, $6)',
      [code, name, client, project || 'General', num(lat), num(lng)]
    );
    await audit(req.user.u, 'site_add', code, ip(req));
    res.status(201).json({ code });
  } catch (err) {
    console.error('Create site error:', err);
    res.status(500).json({ error: 'Failed to create site' });
  }
});

/* ================= DEVICES ================= */
app.get('/api/devices', A.authRequired, async (req, res) => {
  try {
    const scope = A.scopeClient(req);
    const sql = `SELECT d.device_id, d.site_code, d.location, d.status, d.pm25, d.pm10, d.last_seen, d.installed, d.last_cal,
                        d.dev_type, d.power, d.power_manual, d.transmit, d.p_inlet, d.p_outlet, d.dp_warn, d.dp_crit, d.raining,
                        d.sp_enabled, d.sp25, d.sp10, d.sp_band,
                        s.name AS site_name, s.client, s.project, s.lat, s.lng
                 FROM devices d JOIN sites s ON s.code = d.site_code`;
    const finalSql = scope ? `${sql} WHERE s.client = $1 ORDER BY d.device_id` : `${sql} ORDER BY d.device_id`;
    const params = scope ? [scope] : [];
    const result = await query(finalSql, params);
    res.json(result.rows.map(enrichDevice));
  } catch (err) {
    console.error('Fetch devices error:', err);
    res.status(500).json({ error: 'Failed to fetch devices' });
  }
});

app.post('/api/devices', A.authRequired, A.requireRole('admin', 'service'), async (req, res) => {
  const {
    device_id, site_code, location, last_cal, dev_type, dp_warn, dp_crit,
    sp_enabled, sp25, sp10, sp_band
  } = req.body || {};

  if (!device_id || !site_code) {
    return res.status(400).json({ error: 'Device ID and site required' });
  }

  try {
    const siteCheck = await query('SELECT code FROM sites WHERE code = $1', [site_code]);
    if (siteCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Unknown site' });
    }

    const existsCheck = await query('SELECT 1 FROM devices WHERE device_id = $1', [device_id]);
    if (existsCheck.rows.length > 0) {
      return res.status(409).json({ error: 'Device ID already exists' });
    }

    const type = dev_type === 'basic' ? 'basic' : 'maaps';
    const apiKey = A.newApiKey();

    await query(
      `INSERT INTO devices (
         device_id, site_code, location, api_key, last_cal, dev_type,
         dp_warn, dp_crit, sp_enabled, sp25, sp10, sp_band
       ) VALUES (
         $1, $2, $3, $4, COALESCE($5, CURRENT_DATE), $6,
         COALESCE($7, 1200), COALESCE($8, 1500), $9, COALESCE($10, 60), COALESCE($11, 100), COALESCE($12, 10)
       )`,
      [
        device_id, site_code, location || '', apiKey, last_cal || null, type,
        num(dp_warn), num(dp_crit), sp_enabled ? 1 : 0, num(sp25), num(sp10), num(sp_band)
      ]
    );

    await audit(req.user.u, 'device_add', `${device_id} (${type})`, ip(req));
    res.status(201).json({ device_id, api_key: apiKey });
  } catch (err) {
    console.error('Create device error:', err);
    res.status(500).json({ error: 'Failed to create device' });
  }
});

app.post('/api/devices/:id/control', A.authRequired, A.requireRole('admin', 'service'), async (req, res) => {
  const deviceId = req.params.id;
  try {
    const devRes = await query('SELECT * FROM devices WHERE device_id = $1', [deviceId]);
    if (devRes.rows.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }

    const {
      power, transmit, raining, p_inlet, p_outlet, dp_warn, dp_crit,
      sp_enabled, sp25, sp10, sp_band
    } = req.body || {};

    const sets = [];
    const vals = [];
    let idx = 1;

    const put = (col, v) => {
      sets.push(`${col} = $${idx++}`);
      vals.push(v);
    };

    if (power !== undefined) {
      if (!['on', 'off', 'auto'].includes(power)) {
        return res.status(400).json({ error: 'power must be on|off|auto' });
      }
      put('power_manual', power === 'auto' ? null : power);
    }
    if (transmit !== undefined) put('transmit', transmit ? 1 : 0);
    if (raining !== undefined) put('raining', raining ? 1 : 0);
    if (p_inlet !== undefined && num(p_inlet) != null) put('p_inlet', num(p_inlet));
    if (p_outlet !== undefined && num(p_outlet) != null) put('p_outlet', num(p_outlet));
    if (dp_warn !== undefined && num(dp_warn) != null) put('dp_warn', num(dp_warn));
    if (dp_crit !== undefined && num(dp_crit) != null) put('dp_crit', num(dp_crit));
    if (sp_enabled !== undefined) put('sp_enabled', sp_enabled ? 1 : 0);
    if (sp25 !== undefined && num(sp25) != null) put('sp25', num(sp25));
    if (sp10 !== undefined && num(sp10) != null) put('sp10', num(sp10));
    if (sp_band !== undefined && num(sp_band) != null) put('sp_band', num(sp_band));

    if (sets.length === 0) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    vals.push(deviceId);
    await query(`UPDATE devices SET ${sets.join(', ')} WHERE device_id = $${idx}`, vals);
    await audit(req.user.u, 'device_control', `${deviceId}: ${JSON.stringify(req.body)}`, ip(req));

    const updated = await query(
      `SELECT d.*, s.name AS site_name, s.client, s.project, s.lat, s.lng
       FROM devices d JOIN sites s ON s.code = d.site_code WHERE d.device_id = $1`,
      [deviceId]
    );

    res.json(enrichDevice(updated.rows[0]));
  } catch (err) {
    console.error('Device control error:', err);
    res.status(500).json({ error: 'Failed to update device control settings' });
  }
});

app.get('/api/devices/:id/key', A.authRequired, A.requireRole('admin', 'service'), async (req, res) => {
  try {
    const dev = await query('SELECT api_key FROM devices WHERE device_id = $1', [req.params.id]);
    if (dev.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    await audit(req.user.u, 'device_key_view', req.params.id, ip(req));
    res.json({ device_id: req.params.id, api_key: dev.rows[0].api_key });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch device key' });
  }
});

app.delete('/api/devices/:id', A.authRequired, A.requireRole('admin', 'service'), async (req, res) => {
  try {
    const result = await query('DELETE FROM devices WHERE device_id = $1', [req.params.id]);
    await audit(req.user.u, 'device_delete', req.params.id, ip(req));
    res.json({ deleted: result.rowCount });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete device' });
  }
});

/* ============ DEVICE INGESTION ============ */
app.post('/api/ingest', ingestLimiter, async (req, res) => {
  // Support key in headers (X-Device-Key or Authorization Bearer), in body (api_key or key), or query param
  const key =
    req.headers['x-device-key'] ||
    req.headers['x_device_key'] ||
    (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '') ||
    req.body?.api_key ||
    req.body?.key ||
    req.body?.device_key ||
    req.body?.['x-device-key'] ||
    req.query?.api_key ||
    req.query?.key ||
    req.query?.device_key;

  // Support device_id in body or query param
  const device_id =
    req.body?.device_id ||
    req.body?.deviceId ||
    req.body?.id ||
    req.query?.device_id ||
    req.query?.deviceId ||
    req.query?.id;

  const pm25 = req.body?.pm25 ?? req.query?.pm25;
  const pm10 = req.body?.pm10 ?? req.query?.pm10;
  const p_inlet = req.body?.p_inlet ?? req.body?.pInlet ?? req.query?.p_inlet;
  const p_outlet = req.body?.p_outlet ?? req.body?.pOutlet ?? req.query?.p_outlet;
  const raining = req.body?.raining ?? req.query?.raining;
  const transmit = req.body?.transmit ?? req.query?.transmit;

  if (!key || !device_id) {
    return res.status(400).json({
      error: 'device_id and X-Device-Key required',
      diagnostics: {
        device_id_received: device_id || null,
        has_device_key: !!key,
        content_type_header: req.headers['content-type'] || 'not set',
        body_keys_received: req.body ? Object.keys(req.body) : []
      },
      instructions: {
        option_1_headers: 'Add header "X-Device-Key" with value of device API key',
        option_2_body: 'Or include "api_key" directly inside JSON body',
        body_format: 'Ensure Postman Body is set to "raw" -> "JSON" with {"device_id": "MAAPS-0012", "pm25": 45, "pm10": 85}'
      }
    });
  }

  try {
    const devRes = await query('SELECT * FROM devices WHERE device_id = $1', [device_id]);
    const dev = devRes.rows[0];

    if (!dev || dev.api_key !== key) {
      return res.status(401).json({ error: 'Invalid device credentials' });
    }

    const p25 = num(pm25);
    const p10 = num(pm10);
    if (p25 == null || p10 == null || p25 < 0 || p10 < 0 || p25 > 2000 || p10 > 2000) {
      return res.status(400).json({ error: 'pm25/pm10 out of range' });
    }

    const pin = num(p_inlet);
    const pout = num(p_outlet);
    if ((pin != null && (pin < 0 || pin > 100000)) || (pout != null && (pout < 0 || pout > 100000))) {
      return res.status(400).json({ error: 'pressure out of range' });
    }

    const rainVal = raining === undefined ? null : raining ? 1 : 0;
    const txVal = transmit === undefined ? null : transmit ? 1 : 0;
    const a = aqi.computeAQI(p25, p10);

    const client = await getClient();
    try {
      await client.query('BEGIN');

      const sets = ["pm25 = $1", "pm10 = $2", "status = 'online'", "last_seen = CURRENT_TIMESTAMP"];
      const vals = [p25, p10];
      let idx = 3;

      if (pin != null) { sets.push(`p_inlet = $${idx++}`); vals.push(pin); }
      if (pout != null) { sets.push(`p_outlet = $${idx++}`); vals.push(pout); }
      if (rainVal != null) { sets.push(`raining = $${idx++}`); vals.push(rainVal); }
      if (txVal != null) { sets.push(`transmit = $${idx++}`); vals.push(txVal); }

      const pwNow = H.effectivePower({
        power_manual: dev.power_manual,
        raining: rainVal != null ? !!rainVal : !!dev.raining,
        pm25: p25,
        pm10: p10,
        sp25: dev.sp25,
        sp10: dev.sp10,
        sp_band: dev.sp_band,
        sp_enabled: !!dev.sp_enabled,
        currently_on: dev.power === undefined ? true : !!dev.power
      });

      sets.push(`power = $${idx++}`);
      vals.push(pwNow.on ? 1 : 0);
      vals.push(device_id);

      await client.query(`UPDATE devices SET ${sets.join(', ')} WHERE device_id = $${idx}`, vals);
      await client.query(
        'INSERT INTO readings (device_id, pm25, pm10, aqi, ts) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)',
        [device_id, p25, p10, a]
      );

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    const freshRes = await query('SELECT * FROM devices WHERE device_id = $1', [device_id]);
    const fresh = freshRes.rows[0];
    const pw = H.effectivePower({
      power_manual: fresh.power_manual,
      raining: !!fresh.raining,
      pm25: fresh.pm25,
      pm10: fresh.pm10,
      sp25: fresh.sp25,
      sp10: fresh.sp10,
      sp_band: fresh.sp_band,
      sp_enabled: !!fresh.sp_enabled,
      currently_on: !!fresh.power
    });

    res.json({
      ok: true,
      device_id,
      aqi: a,
      category: aqi.category(a).name,
      power_on: pw.on,
      power_reason: pw.reason
    });
  } catch (err) {
    console.error('Ingest error:', err);
    res.status(500).json({ error: 'Ingestion failed' });
  }
});

/* History for a device */
app.get('/api/devices/:id/history', A.authRequired, async (req, res) => {
  try {
    const scope = A.scopeClient(req);
    const sql = `SELECT d.device_id FROM devices d JOIN sites s ON s.code = d.site_code
                 WHERE d.device_id = $1 ${scope ? 'AND s.client = $2' : ''}`;
    const params = scope ? [req.params.id, scope] : [req.params.id];
    const devRes = await query(sql, params);

    if (devRes.rows.length === 0) return res.status(404).json({ error: 'Not found' });

    const rows = await query(
      'SELECT pm25, pm10, aqi, ts FROM readings WHERE device_id = $1 ORDER BY ts DESC LIMIT 200',
      [req.params.id]
    );
    res.json(rows.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch device history' });
  }
});

/* ================= USERS (Admin Only) ================= */
app.get('/api/users', A.authRequired, A.requireRole('admin'), async (req, res) => {
  try {
    const result = await query(
      'SELECT id, username, role, name, client, active, created_at FROM users ORDER BY id'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

app.post('/api/users', A.authRequired, A.requireRole('admin'), async (req, res) => {
  const { username, password, role, name, client } = req.body || {};
  if (!username || !password || !role) {
    return res.status(400).json({ error: 'username, password, role required' });
  }
  if (!['admin', 'service', 'client'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  if (String(password).length < 8) {
    return res.status(400).json({ error: 'Password must be 8+ characters' });
  }

  try {
    const dup = await query('SELECT 1 FROM users WHERE username = $1', [username]);
    if (dup.rows.length > 0) return res.status(409).json({ error: 'Username exists' });

    await query(
      'INSERT INTO users (username, pass_hash, role, name, client) VALUES ($1, $2, $3, $4, $5)',
      [username, A.hash(password), role, name || username, role === 'client' ? client || username : null]
    );

    await audit(req.user.u, 'user_add', `${username}/${role}`, ip(req));
    res.status(201).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create user' });
  }
});

app.post('/api/users/:id/password', A.authRequired, A.requireRole('admin'), async (req, res) => {
  const { password } = req.body || {};
  if (!password || String(password).length < 8) {
    return res.status(400).json({ error: 'Password must be 8+ characters' });
  }

  try {
    const userRes = await query('SELECT username FROM users WHERE id = $1', [req.params.id]);
    if (userRes.rows.length === 0) return res.status(404).json({ error: 'Not found' });

    await query('UPDATE users SET pass_hash = $1 WHERE id = $2', [A.hash(password), req.params.id]);
    await audit(req.user.u, 'user_pwd_reset', userRes.rows[0].username, ip(req));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

app.delete('/api/users/:id', A.authRequired, A.requireRole('admin'), async (req, res) => {
  try {
    const userRes = await query('SELECT username FROM users WHERE id = $1', [req.params.id]);
    if (userRes.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    if (userRes.rows[0].username === 'admin') {
      return res.status(400).json({ error: 'Cannot delete the primary admin' });
    }

    await query('DELETE FROM users WHERE id = $1', [req.params.id]);
    await audit(req.user.u, 'user_delete', userRes.rows[0].username, ip(req));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

/* Audit Log (Admin) */
app.get('/api/audit', A.authRequired, A.requireRole('admin'), async (req, res) => {
  try {
    const rows = await query('SELECT actor, action, detail, ip, ts FROM audit ORDER BY id DESC LIMIT 300');
    res.json(rows.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch audit log' });
  }
});

/* Mark stale devices offline */
app.post('/api/sweep', A.authRequired, A.requireRole('admin', 'service'), async (req, res) => {
  try {
    const result = await query(
      `UPDATE devices SET status = 'offline'
       WHERE status = 'online' AND (last_seen IS NULL OR last_seen < NOW() - INTERVAL '30 minutes')`
    );
    res.json({ marked_offline: result.rowCount });
  } catch (err) {
    res.status(500).json({ error: 'Sweep operation failed' });
  }
});

/* 404 + Error Handlers */
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Payload too large' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON' });
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

const PORT = process.env.PORT || 5000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Saaphzone AQI Backend running on port ${PORT} (${PROD ? 'production' : 'development'})`);
    console.log('PostgreSQL database backend connected.');
    console.log('© 2026 Saaphzone Technologies LLP. All rights reserved.');
  });
}

module.exports = app;
