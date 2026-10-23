/*
 * Saaphzone AQI Monitoring Portal — MAAPS Ambient Air Network
 * Secure Node.js / Express backend
 * © 2026 Saaphzone Technologies LLP. All rights reserved.
 *
 * Unauthorized copying, distribution, or use of this software,
 * via any medium, is strictly prohibited and proprietary.
 */
'use strict';
require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');

const { db, audit } = require('./db');
const aqi = require('./aqi');
const H = require('./health');
const A = require('./auth');

const app = express();
const PROD = process.env.NODE_ENV === 'production';
app.set('trust proxy', 1);

/* ---------------- Security middleware ---------------- */
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://cdnjs.cloudflare.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com'],
      imgSrc: ["'self'", 'data:', 'https://*.tile.openstreetmap.org'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false,
  hsts: PROD ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false
}));
app.use(express.json({ limit: '64kb' }));
app.use(cookieParser());

// Force HTTPS in production (behind a proxy that sets x-forwarded-proto)
if (PROD) {
  app.use((req, res, next) => {
    if (req.secure || req.headers['x-forwarded-proto'] === 'https') return next();
    res.redirect(308, 'https://' + req.headers.host + req.url);
  });
}

/* ---------------- Rate limiters ---------------- */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
  standardHeaders: true, legacyHeaders: false
});
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false });
const ingestLimiter = rateLimit({ windowMs: 60 * 1000, max: 240, standardHeaders: true, legacyHeaders: false });
app.use('/api/', apiLimiter);

const ip = (req) => req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
const cookieOpts = { httpOnly: true, secure: PROD, sameSite: 'strict', maxAge: 2 * 60 * 60 * 1000 };

/* ================= AUTH ================= */
app.post('/api/login', loginLimiter, (req, res) => {
  const { username, password, role } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string')
    return res.status(400).json({ error: 'Username and password required' });
  const u = db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(username.trim());
  // Constant-ish failure path — verify even when user missing to reduce timing signal
  const ok = u ? A.verify(password, u.pass_hash) : A.verify(password, '$2a$12$......................................');
  if (!u || !ok || (role && u.role !== role)) {
    audit(username, 'login_fail', `role=${role}`, ip(req));
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = A.sign(u);
  res.cookie('szsession', token, cookieOpts);
  audit(u.username, 'login_ok', `role=${u.role}`, ip(req));
  res.json({ user: { username: u.username, role: u.role, name: u.name, client: u.client } });
});

app.post('/api/logout', A.authRequired, (req, res) => {
  audit(req.user.u, 'logout', null, ip(req));
  res.clearCookie('szsession', cookieOpts);
  res.json({ ok: true });
});

app.get('/api/me', A.authRequired, (req, res) => {
  res.json({ username: req.user.u, role: req.user.role, name: req.user.u, client: req.user.client });
});

/* ================= SITES ================= */
app.get('/api/sites', A.authRequired, (req, res) => {
  const scope = A.scopeClient(req);
  const rows = scope
    ? db.prepare('SELECT * FROM sites WHERE client=? ORDER BY project,name').all(scope)
    : db.prepare('SELECT * FROM sites ORDER BY project,name').all();
  res.json(rows);
});

app.post('/api/sites', A.authRequired, A.requireRole('admin', 'service'), (req, res) => {
  const { name, client, project, lat, lng } = req.body || {};
  if (!name || !client) return res.status(400).json({ error: 'Site name and client required' });
  const code = 'S' + Date.now().toString(36).toUpperCase();
  db.prepare('INSERT INTO sites (code,name,client,project,lat,lng) VALUES (?,?,?,?,?,?)')
    .run(code, name, client, project || 'General', num(lat), num(lng));
  audit(req.user.u, 'site_add', code, ip(req));
  res.status(201).json({ code });
});

/* ================= DEVICES ================= */
// Build the enriched device object with computed AQI + health/power state.
function enrichDevice(r) {
  const pw = H.effectivePower({
    power_manual: r.power_manual, raining: !!r.raining,
    pm25: r.pm25, pm10: r.pm10, sp25: r.sp25, sp10: r.sp10,
    sp_band: r.sp_band, sp_enabled: !!r.sp_enabled,
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
    power_on: pw.on,             // effective power state
    power_reason: pw.reason,     // 'manual' | 'rain' | 'setpoint' | 'auto'
    running,                     // truly running (on + online)
    pressure: press,             // { dp, level, label, color }
    aqi: r.status === 'online' ? aqi.computeAQI(r.pm25, r.pm10) : null
  };
}

app.get('/api/devices', A.authRequired, (req, res) => {
  const scope = A.scopeClient(req);
  const sql = `SELECT d.device_id,d.site_code,d.location,d.status,d.pm25,d.pm10,d.last_seen,d.installed,d.last_cal,
                      d.dev_type,d.power,d.power_manual,d.transmit,d.p_inlet,d.p_outlet,d.dp_warn,d.dp_crit,d.raining,
                      d.sp_enabled,d.sp25,d.sp10,d.sp_band,
                      s.name AS site_name,s.client,s.project,s.lat,s.lng
               FROM devices d JOIN sites s ON s.code=d.site_code`;
  const rows = scope
    ? db.prepare(sql + ' WHERE s.client=? ORDER BY d.device_id').all(scope)
    : db.prepare(sql + ' ORDER BY d.device_id').all();
  // API keys are NEVER sent to clients; only admin/service can retrieve them via a separate endpoint
  res.json(rows.map(enrichDevice));
});

app.post('/api/devices', A.authRequired, A.requireRole('admin', 'service'), (req, res) => {
  const { device_id, site_code, location, last_cal, dev_type, dp_warn, dp_crit,
          sp_enabled, sp25, sp10, sp_band } = req.body || {};
  if (!device_id || !site_code) return res.status(400).json({ error: 'Device ID and site required' });
  const site = db.prepare('SELECT code FROM sites WHERE code=?').get(site_code);
  if (!site) return res.status(400).json({ error: 'Unknown site' });
  const exists = db.prepare('SELECT 1 FROM devices WHERE device_id=?').get(device_id);
  if (exists) return res.status(409).json({ error: 'Device ID already exists' });
  const type = dev_type === 'basic' ? 'basic' : 'maaps';
  const apiKey = A.newApiKey();
  db.prepare(`INSERT INTO devices (device_id,site_code,location,api_key,last_cal,dev_type,dp_warn,dp_crit,sp_enabled,sp25,sp10,sp_band)
              VALUES (?,?,?,?,COALESCE(?,date('now')),?,COALESCE(?,1200),COALESCE(?,1500),?,COALESCE(?,60),COALESCE(?,100),COALESCE(?,10))`)
    .run(device_id, site_code, location || '', apiKey, last_cal || null, type, num(dp_warn), num(dp_crit),
         sp_enabled ? 1 : 0, num(sp25), num(sp10), num(sp_band));
  audit(req.user.u, 'device_add', `${device_id} (${type})`, ip(req));
  // Return the api_key ONCE at creation so it can be flashed to the device
  res.status(201).json({ device_id, api_key: apiKey });
});

// Staff control: override power (on/off/auto), transmission, rain, or manual sensor values.
app.post('/api/devices/:id/control', A.authRequired, A.requireRole('admin', 'service'), (req, res) => {
  const d = db.prepare('SELECT * FROM devices WHERE device_id=?').get(req.params.id);
  if (!d) return res.status(404).json({ error: 'Not found' });
  const { power, transmit, raining, p_inlet, p_outlet, dp_warn, dp_crit,
          sp_enabled, sp25, sp10, sp_band } = req.body || {};
  const sets = [], vals = [];
  const put = (col, v) => { sets.push(`${col}=?`); vals.push(v); };

  if (power !== undefined) {
    // power: 'on' | 'off' | 'auto'
    if (!['on', 'off', 'auto'].includes(power)) return res.status(400).json({ error: 'power must be on|off|auto' });
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
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });

  db.prepare(`UPDATE devices SET ${sets.join(',')} WHERE device_id=?`).run(...vals, req.params.id);
  audit(req.user.u, 'device_control', `${req.params.id}: ${JSON.stringify(req.body)}`, ip(req));
  const row = db.prepare(`SELECT d.*, s.name AS site_name, s.client, s.project, s.lat, s.lng
                          FROM devices d JOIN sites s ON s.code=d.site_code WHERE d.device_id=?`).get(req.params.id);
  res.json(enrichDevice(row));
});

app.get('/api/devices/:id/key', A.authRequired, A.requireRole('admin', 'service'), (req, res) => {
  const d = db.prepare('SELECT api_key FROM devices WHERE device_id=?').get(req.params.id);
  if (!d) return res.status(404).json({ error: 'Not found' });
  audit(req.user.u, 'device_key_view', req.params.id, ip(req));
  res.json({ device_id: req.params.id, api_key: d.api_key });
});

app.delete('/api/devices/:id', A.authRequired, A.requireRole('admin', 'service'), (req, res) => {
  const info = db.prepare('DELETE FROM devices WHERE device_id=?').run(req.params.id);
  audit(req.user.u, 'device_delete', req.params.id, ip(req));
  res.json({ deleted: info.changes });
});

/* ============ DEVICE INGESTION (MAAPS -> server) ============ */
// Devices authenticate with their own API key via header. No user session.
app.post('/api/ingest', ingestLimiter, (req, res) => {
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

  const device_id =
    req.body?.device_id ||
    req.body?.deviceId ||
    req.body?.id ||
    req.query?.device_id ||
    req.query?.deviceId ||
    req.query?.id;

  const { pm25, pm10, p_inlet, p_outlet, raining, transmit } = req.body || {};
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
        option_1_headers: 'Add header "X-Device-Key" with device API key',
        option_2_body: 'Or include "api_key" directly inside JSON body',
        example_body: {
          device_id: 'MAAPS-0012',
          api_key: 'maaps_5ffa73ec19b83a8432c61eddf9c7c1a926a40e6bdd4ad665',
          pm25: 45,
          pm10: 85
        }
      }
    });
  }
  const dev = db.prepare('SELECT * FROM devices WHERE device_id=?').get(device_id);
  if (!dev || dev.api_key !== key) return res.status(401).json({ error: 'Invalid device credentials' });
  const p25 = num(pm25), p10 = num(pm10);
  if (p25 == null || p10 == null || p25 < 0 || p10 < 0 || p25 > 2000 || p10 > 2000)
    return res.status(400).json({ error: 'pm25/pm10 out of range' });

  // Optional MAAPS telemetry — only applied if the device sends it and staff hasn't overridden.
  const pin = num(p_inlet), pout = num(p_outlet);
  if ((pin != null && (pin < 0 || pin > 100000)) || (pout != null && (pout < 0 || pout > 100000)))
    return res.status(400).json({ error: 'pressure out of range' });
  const rainVal = raining === undefined ? null : (raining ? 1 : 0);
  const txVal = transmit === undefined ? null : (transmit ? 1 : 0);

  const a = aqi.computeAQI(p25, p10);
  const tx = db.transaction(() => {
    const sets = ["pm25=?", "pm10=?", "status='online'", "last_seen=datetime('now')"];
    const vals = [p25, p10];
    if (pin != null)  { sets.push('p_inlet=?');  vals.push(pin); }
    if (pout != null) { sets.push('p_outlet=?'); vals.push(pout); }
    if (rainVal != null) { sets.push('raining=?'); vals.push(rainVal); }
    if (txVal != null)   { sets.push('transmit=?'); vals.push(txVal); }

    // Recompute effective power with the NEW reading (setpoint hysteresis uses prior power state).
    const pwNow = H.effectivePower({
      power_manual: dev.power_manual,
      raining: rainVal != null ? !!rainVal : !!dev.raining,
      pm25: p25, pm10: p10, sp25: dev.sp25, sp10: dev.sp10,
      sp_band: dev.sp_band, sp_enabled: !!dev.sp_enabled,
      currently_on: dev.power === undefined ? true : !!dev.power
    });
    sets.push('power=?'); vals.push(pwNow.on ? 1 : 0);   // persist so hysteresis has memory

    db.prepare(`UPDATE devices SET ${sets.join(',')} WHERE device_id=?`).run(...vals, device_id);
    db.prepare('INSERT INTO readings (device_id,pm25,pm10,aqi) VALUES (?,?,?,?)').run(device_id, p25, p10, a);
  });
  tx();

  // Tell the device its effective power state (so it can honour rain auto-off / setpoint / manual override).
  const fresh = db.prepare('SELECT * FROM devices WHERE device_id=?').get(device_id);
  const pw = H.effectivePower({
    power_manual: fresh.power_manual, raining: !!fresh.raining,
    pm25: fresh.pm25, pm10: fresh.pm10, sp25: fresh.sp25, sp10: fresh.sp10,
    sp_band: fresh.sp_band, sp_enabled: !!fresh.sp_enabled,
    currently_on: !!fresh.power
  });
  res.json({ ok: true, device_id, aqi: a, category: aqi.category(a).name, power_on: pw.on, power_reason: pw.reason });
});

/* history for a device */
app.get('/api/devices/:id/history', A.authRequired, (req, res) => {
  const scope = A.scopeClient(req);
  const dev = db.prepare(`SELECT d.device_id FROM devices d JOIN sites s ON s.code=d.site_code
                          WHERE d.device_id=? ${scope ? 'AND s.client=?' : ''}`)
    .get(...(scope ? [req.params.id, scope] : [req.params.id]));
  if (!dev) return res.status(404).json({ error: 'Not found' });
  const rows = db.prepare('SELECT pm25,pm10,aqi,ts FROM readings WHERE device_id=? ORDER BY ts DESC LIMIT 200')
    .all(req.params.id);
  res.json(rows);
});

/* ================= USERS (admin only) ================= */
app.get('/api/users', A.authRequired, A.requireRole('admin'), (req, res) => {
  res.json(db.prepare('SELECT id,username,role,name,client,active,created_at FROM users ORDER BY id').all());
});

app.post('/api/users', A.authRequired, A.requireRole('admin'), (req, res) => {
  const { username, password, role, name, client } = req.body || {};
  if (!username || !password || !role) return res.status(400).json({ error: 'username, password, role required' });
  if (!['admin', 'service', 'client'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (String(password).length < 8) return res.status(400).json({ error: 'Password must be 8+ characters' });
  const dup = db.prepare('SELECT 1 FROM users WHERE username=?').get(username);
  if (dup) return res.status(409).json({ error: 'Username exists' });
  db.prepare('INSERT INTO users (username,pass_hash,role,name,client) VALUES (?,?,?,?,?)')
    .run(username, A.hash(password), role, name || username, role === 'client' ? (client || username) : null);
  audit(req.user.u, 'user_add', `${username}/${role}`, ip(req));
  res.status(201).json({ ok: true });
});

app.post('/api/users/:id/password', A.authRequired, A.requireRole('admin'), (req, res) => {
  const { password } = req.body || {};
  if (!password || String(password).length < 8) return res.status(400).json({ error: 'Password must be 8+ characters' });
  const u = db.prepare('SELECT username FROM users WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE users SET pass_hash=? WHERE id=?').run(A.hash(password), req.params.id);
  audit(req.user.u, 'user_pwd_reset', u.username, ip(req));
  res.json({ ok: true });
});

app.delete('/api/users/:id', A.authRequired, A.requireRole('admin'), (req, res) => {
  const u = db.prepare('SELECT username FROM users WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  if (u.username === 'admin') return res.status(400).json({ error: 'Cannot delete the primary admin' });
  db.prepare('DELETE FROM users WHERE id=?').run(req.params.id);
  audit(req.user.u, 'user_delete', u.username, ip(req));
  res.json({ ok: true });
});

/* audit log (admin) */
app.get('/api/audit', A.authRequired, A.requireRole('admin'), (req, res) => {
  res.json(db.prepare('SELECT actor,action,detail,ip,ts FROM audit ORDER BY id DESC LIMIT 300').all());
});

/* mark stale devices offline (called by a cron or the client poll) */
app.post('/api/sweep', A.authRequired, A.requireRole('admin', 'service'), (req, res) => {
  const info = db.prepare(`UPDATE devices SET status='offline'
    WHERE status='online' AND (last_seen IS NULL OR last_seen < datetime('now','-30 minutes'))`).run();
  res.json({ marked_offline: info.changes });
});

/* ---------------- Static UI ---------------- */
app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html' }));

/* 404 + error handlers */
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Payload too large' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON' });
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

function num(v) { if (v === '' || v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null; }

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Saaphzone AQI Portal running on port ${PORT} (${PROD ? 'production' : 'development'})`);
    console.log('© 2026 Saaphzone Technologies LLP. All rights reserved.');
  });
}
module.exports = app;
