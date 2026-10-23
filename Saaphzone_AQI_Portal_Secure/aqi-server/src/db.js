/*
 * Saaphzone AQI Monitoring Portal — Database layer
 * © 2026 Saaphzone Technologies LLP. All rights reserved.
 */
'use strict';
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'aqi.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  pass_hash     TEXT NOT NULL,
  role          TEXT NOT NULL CHECK(role IN ('admin','service','client')),
  name          TEXT NOT NULL,
  client        TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sites (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  client        TEXT NOT NULL,
  project       TEXT NOT NULL,
  lat           REAL,
  lng           REAL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS devices (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id     TEXT UNIQUE NOT NULL,
  site_code     TEXT NOT NULL,
  location      TEXT,
  api_key       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'offline',
  pm25          REAL DEFAULT 0,
  pm10          REAL DEFAULT 0,
  last_seen     TEXT,
  installed     TEXT NOT NULL DEFAULT (date('now')),
  last_cal      TEXT NOT NULL DEFAULT (date('now')),
  -- device type: 'basic' (PM only) or 'maaps' (full ambient air device)
  dev_type      TEXT NOT NULL DEFAULT 'maaps',
  -- MAAPS health & control fields
  power         INTEGER NOT NULL DEFAULT 1,   -- 1=ON, 0=OFF (effective state)
  power_manual  TEXT,                          -- 'on' | 'off' | NULL (staff override; NULL=auto)
  transmit      INTEGER NOT NULL DEFAULT 1,   -- data transmission ON/OFF
  p_inlet       REAL DEFAULT 0,               -- inlet pressure (Pa)
  p_outlet      REAL DEFAULT 0,               -- outlet pressure (Pa)
  dp_warn       REAL DEFAULT 1200,            -- ΔP amber threshold (Pa)
  dp_crit       REAL DEFAULT 1500,            -- ΔP red / service threshold (Pa)
  raining       INTEGER NOT NULL DEFAULT 0,   -- rain sensor: 1=raining
  sp_enabled    INTEGER NOT NULL DEFAULT 0,   -- PM setpoint auto start/stop enabled
  sp25          REAL DEFAULT 60,              -- PM2.5 setpoint (µg/m³)
  sp10          REAL DEFAULT 100,             -- PM10 setpoint (µg/m³)
  sp_band       REAL DEFAULT 10,              -- hysteresis band (µg/m³)
  FOREIGN KEY (site_code) REFERENCES sites(code) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS readings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id     TEXT NOT NULL,
  pm25          REAL NOT NULL,
  pm10          REAL NOT NULL,
  aqi           INTEGER NOT NULL,
  ts            TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_readings_dev_ts ON readings(device_id, ts);

CREATE TABLE IF NOT EXISTS audit (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  actor         TEXT,
  action        TEXT NOT NULL,
  detail        TEXT,
  ip            TEXT,
  ts            TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// ---- Lightweight migration: add new device columns if upgrading an old DB ----
const devCols = db.prepare("PRAGMA table_info(devices)").all().map(c => c.name);
const addCol = (name, ddl) => { if (!devCols.includes(name)) db.exec(`ALTER TABLE devices ADD COLUMN ${ddl}`); };
addCol('dev_type',     "dev_type TEXT NOT NULL DEFAULT 'maaps'");
addCol('power',        "power INTEGER NOT NULL DEFAULT 1");
addCol('power_manual', "power_manual TEXT");
addCol('transmit',     "transmit INTEGER NOT NULL DEFAULT 1");
addCol('p_inlet',      "p_inlet REAL DEFAULT 0");
addCol('p_outlet',     "p_outlet REAL DEFAULT 0");
addCol('dp_warn',      "dp_warn REAL DEFAULT 1200");
addCol('dp_crit',      "dp_crit REAL DEFAULT 1500");
addCol('raining',      "raining INTEGER NOT NULL DEFAULT 0");
addCol('sp_enabled',   "sp_enabled INTEGER NOT NULL DEFAULT 0");
addCol('sp25',         "sp25 REAL DEFAULT 60");
addCol('sp10',         "sp10 REAL DEFAULT 100");
addCol('sp_band',      "sp_band REAL DEFAULT 10");

function audit(actor, action, detail, ip) {
  db.prepare('INSERT INTO audit (actor,action,detail,ip) VALUES (?,?,?,?)')
    .run(actor || null, action, detail || null, ip || null);
}

module.exports = { db, audit };
