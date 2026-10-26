/*
 * Saaphzone AQI Monitoring Portal — Database Seeder (PostgreSQL)
 * © 2026 Saaphzone Technologies LLP. All rights reserved.
 */
'use strict';

const path = require('path');
const crypto = require('crypto');
let bcrypt;
try {
  bcrypt = require('bcryptjs');
} catch (e) {
  bcrypt = require(path.join(__dirname, '..', 'backend', 'node_modules', 'bcryptjs'));
}

let pg;
try {
  pg = require('pg');
} catch (e) {
  pg = require(path.join(__dirname, '..', 'backend', 'node_modules', 'pg'));
}
const { Pool } = pg;

try {
  require('dotenv').config({ path: path.join(__dirname, '..', 'backend', '.env') });
} catch (e) {
  require(path.join(__dirname, '..', 'backend', 'node_modules', 'dotenv')).config({ path: path.join(__dirname, '..', 'backend', '.env') });
}

const hash = (pw) => bcrypt.hashSync(pw, 12);
const newApiKey = () => 'maaps_' + crypto.randomBytes(24).toString('hex');

// CPCB Sub-index calculation
const BP_PM25 = [[0,30,0,50],[31,60,51,100],[61,90,101,200],[91,120,201,300],[121,250,301,400],[251,500,401,500]];
const BP_PM10 = [[0,50,0,50],[51,100,51,100],[101,250,101,200],[251,350,201,300],[351,430,301,400],[431,600,401,500]];
function subIndex(c, bp) {
  for (const [Cl, Ch, Il, Ih] of bp) {
    if (c >= Cl && c <= Ch) return Math.round((Ih - Il) / (Ch - Cl) * (c - Cl) + Il);
  }
  return 500;
}
function computeAQI(pm25, pm10) {
  return Math.max(subIndex(pm25, BP_PM25), subIndex(pm10, BP_PM10));
}

const users = [
  ['admin',   process.env.SEED_ADMIN_PW   || 'Sz9#vK!7mP@26%AdmX', 'admin',   'Dr. V. Pankaj',   null],
  ['service', process.env.SEED_SERVICE_PW || 'Sv8!wL#4qR&26*EngY', 'service', 'Sh. Chandan',     null],
  ['escorts', process.env.SEED_CLIENT_PW  || 'ChangeMe#Client1',   'client',  'Escorts Kubota',  'Escorts Kubota Ltd'],
  ['santosh', process.env.SEED_CLIENT_PW  || 'ChangeMe#Client1',   'client',  'Santosh Medical', 'Santosh Medical College']
];

const sites = [
  ['S1', process.env.SEED_SITE_USER_S1 || 'S1', 'Faridabad Plant-1', 'Escorts Kubota Ltd',      'EKL Ambient Network', 28.41, 77.31, process.env.SEED_SITE_PW_S1 || 'Site#Faridabad1'],
  ['S2', process.env.SEED_SITE_USER_S2 || 'S2', 'Faridabad Plant-3', 'Escorts Kubota Ltd',      'EKL Ambient Network', 28.39, 77.29, process.env.SEED_SITE_PW_S2 || 'Site#Faridabad3'],
  ['S3', process.env.SEED_SITE_USER_S3 || 'S3', 'Ghaziabad Campus',  'Santosh Medical College', 'Campus Air Quality',  28.68, 77.44, process.env.SEED_SITE_PW_S3 || 'Site#Ghaziabad3']
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

async function seed(poolInstance) {
  const pool = poolInstance || new Pool({
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || '',
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432', 10),
    database: process.env.PGDATABASE || 'saaphzone_aqi'
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const uCountRes = await client.query('SELECT COUNT(*) AS c FROM users');
    if (parseInt(uCountRes.rows[0].c, 10) > 0) {
      console.log('Data already present in database — skipping seed.');
      await client.query('COMMIT');
      return;
    }

    console.log('Seeding initial users...');
    for (const [un, pw, role, name, clientOrg] of users) {
      await client.query(
        'INSERT INTO users (username, pass_hash, role, name, client) VALUES ($1, $2, $3, $4, $5)',
        [un, hash(pw), role, name, clientOrg]
      );
    }

    console.log('Seeding monitoring sites...');
    for (const [code, username, name, clientOrg, project, lat, lng, sitePw] of sites) {
      await client.query(
        'INSERT INTO sites (code, username, name, client, project, lat, lng, pass_hash) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [code, username || code, name, clientOrg, project, lat, lng, sitePw ? hash(sitePw) : null]
      );
    }

    console.log('Seeding devices & initial readings...');
    const createdKeys = [];
    for (const [id, sc, loc, p25, p10, st, type, pin, pout, rain, pman] of devices) {
      const apiKey = newApiKey();
      createdKeys.push({ id, apiKey });
      await client.query(
        `INSERT INTO devices
          (device_id, site_code, location, api_key, status, pm25, pm10, last_seen, dev_type, p_inlet, p_outlet, raining, power_manual)
         VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, $8, $9, $10, $11, $12)`,
        [id, sc, loc, apiKey, st, p25, p10, type, pin, pout, rain, pman]
      );

      if (st === 'online') {
        const aqi = computeAQI(p25, p10);
        await client.query(
          'INSERT INTO readings (device_id, pm25, pm10, aqi, ts) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)',
          [id, p25, p10, aqi]
        );
      }
    }

    // Set demo hysteresis setpoint on MAAPS-0012
    await client.query(
      `UPDATE devices SET sp_enabled=1, sp25=60, sp10=100, sp_band=10, power=0 WHERE device_id='MAAPS-0012'`
    );

    await client.query('COMMIT');
    console.log('Successfully seeded users, sites, devices, and initial readings in PostgreSQL.');
    console.log('Device API Keys (generated once):');
    createdKeys.forEach(k => console.log(`  ${k.id}: ${k.apiKey}`));
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error during database seeding:', err);
    throw err;
  } finally {
    client.release();
    if (!poolInstance) {
      await pool.end();
    }
  }
}

if (require.main === module) {
  seed();
}

module.exports = { seed };
