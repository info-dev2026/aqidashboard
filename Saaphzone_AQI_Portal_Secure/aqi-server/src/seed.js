/*
 * Seed initial data. Run once: npm run seed
 * © 2026 Saaphzone Technologies LLP. All rights reserved.
 */
'use strict';
require('dotenv').config();
const { db } = require('./db');
const A = require('./auth');
const aqi = require('./aqi');

const users = [
  ['admin',   process.env.SEED_ADMIN_PW   || 'ChangeMe#Admin1',   'admin',   'Dr. V. Pankaj',   null],
  ['service', process.env.SEED_SERVICE_PW || 'ChangeMe#Service1', 'service', 'Sh. Chandan',     null],
  ['escorts', process.env.SEED_CLIENT_PW  || 'ChangeMe#Client1',  'client',  'Escorts Kubota',  'Escorts Kubota Ltd'],
  ['santosh', process.env.SEED_CLIENT_PW  || 'ChangeMe#Client1',  'client',  'Santosh Medical', 'Santosh Medical College']
];
const sites = [
  ['S1', 'Faridabad Plant-1', 'Escorts Kubota Ltd',      'EKL Ambient Network', 28.41, 77.31],
  ['S2', 'Faridabad Plant-3', 'Escorts Kubota Ltd',      'EKL Ambient Network', 28.39, 77.29],
  ['S3', 'Ghaziabad Campus',  'Santosh Medical College', 'Campus Air Quality',  28.68, 77.44]
];
// [id, site, location, pm25, pm10, status, dev_type, p_inlet, p_outlet, raining, power_manual]
const devices = [
  ['MAAPS-0012', 'S1', 'Main Gate',        38, 72,  'online',  'maaps', 950,  350, 0, null],  // healthy
  ['MAAPS-0018', 'S1', 'Foundry Boundary', 61, 118, 'online',  'maaps', 1850, 200, 0, null],  // service required (clogged)
  ['MAAPS-0023', 'S2', 'Assembly Yard',    44, 88,  'online',  'maaps', 800,  300, 1, null],  // raining -> auto off
  ['BASIC-0007', 'S2', 'Perimeter PM',     52, 96,  'online',  'basic', 0,    0,   0, null],  // basic PM-only
  ['MAAPS-0031', 'S3', 'OPD Block Roof',   0,  0,   'offline', 'maaps', 0,    0,   0, null],  // offline
  ['MAAPS-0034', 'S3', 'Hostel Lawn',      29, 54,  'online',  'maaps', 1300, 400, 0, 'off']  // manually off, ΔP in watch band
];

const tx = db.transaction(() => {
  const uCount = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  if (uCount > 0) { console.log('Data already present — skipping seed.'); return; }

  const uStmt = db.prepare('INSERT INTO users (username,pass_hash,role,name,client) VALUES (?,?,?,?,?)');
  users.forEach(([un, pw, role, name, client]) => uStmt.run(un, A.hash(pw), role, name, client));

  const sStmt = db.prepare('INSERT INTO sites (code,name,client,project,lat,lng) VALUES (?,?,?,?,?,?)');
  sites.forEach(s => sStmt.run(...s));

  const dStmt = db.prepare(`INSERT INTO devices
    (device_id,site_code,location,api_key,status,pm25,pm10,last_seen,dev_type,p_inlet,p_outlet,raining,power_manual)
    VALUES (?,?,?,?,?,?,?,datetime('now'),?,?,?,?,?)`);
  devices.forEach(([id, sc, loc, p25, p10, st, type, pin, pout, rain, pman]) => {
    dStmt.run(id, sc, loc, A.newApiKey(), st, p25, p10, type, pin, pout, rain, pman);
    if (st === 'online')
      db.prepare('INSERT INTO readings (device_id,pm25,pm10,aqi) VALUES (?,?,?,?)')
        .run(id, p25, p10, aqi.computeAQI(p25, p10));
  });
  // Demo: enable PM auto start/stop on MAAPS-0012 (currently 38/72 -> below setpoint 60/100 -> idle)
  db.prepare("UPDATE devices SET sp_enabled=1, sp25=60, sp10=100, sp_band=10, power=0 WHERE device_id='MAAPS-0012'").run();
  console.log('Seeded users, sites, devices.');
  console.log('Device API keys (store securely, shown once):');
  db.prepare('SELECT device_id,api_key FROM devices').all().forEach(d => console.log('  ', d.device_id, d.api_key));
});
tx();
