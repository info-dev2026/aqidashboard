/*
 * Saaphzone AQI Monitoring Portal — Database Layer (PostgreSQL)
 * © 2026 Saaphzone Technologies LLP. All rights reserved.
 */
'use strict';

const { Pool } = require('pg');
require('dotenv').config();

const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl:
        process.env.DATABASE_URL.includes('render.com') ||
        process.env.NODE_ENV === 'production'
          ? { rejectUnauthorized: false }
          : false
    }
  : {
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || '',
      host: process.env.PGHOST || 'localhost',
      port: parseInt(process.env.PGPORT || '5432', 10),
      database: process.env.PGDATABASE || 'saaphzone_aqi',
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    };

const pool = new Pool(poolConfig);

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client:', err);
});

// Auto-migrate sites table to ensure pass_hash exists
(async () => {
  try {
    await pool.query('ALTER TABLE sites ADD COLUMN IF NOT EXISTS pass_hash TEXT');
  } catch (err) {
    // Table may not exist yet during initial boot/seed
  }
})();

async function query(text, params) {
  return pool.query(text, params);
}

async function getClient() {
  return pool.connect();
}

async function audit(actor, action, detail, ip) {
  try {
    await pool.query(
      'INSERT INTO audit (actor, action, detail, ip, ts) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)',
      [actor || null, action, detail || null, ip || null]
    );
  } catch (err) {
    console.error('Failed to write audit log:', err.message);
  }
}

module.exports = {
  pool,
  query,
  getClient,
  audit
};
