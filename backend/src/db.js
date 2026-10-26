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

const fs = require('fs');
const path = require('path');

// Auto-bootstrap schema and seed if database is uninitialized
(async () => {
  try {
    const res = await pool.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users'"
    );
    if (res.rows.length === 0) {
      console.log('PostgreSQL tables missing. Auto-bootstrapping schema and initial seed...');
      const schemaPaths = [
        path.resolve(__dirname, '..', '..', 'database', 'schema.sql'),
        path.resolve(__dirname, '..', 'database', 'schema.sql'),
        path.resolve(process.cwd(), 'database', 'schema.sql')
      ];
      const seedPaths = [
        path.resolve(__dirname, '..', '..', 'database', 'seed.sql'),
        path.resolve(__dirname, '..', 'database', 'seed.sql'),
        path.resolve(process.cwd(), 'database', 'seed.sql')
      ];

      const schemaFile = schemaPaths.find(p => fs.existsSync(p));
      const seedFile = seedPaths.find(p => fs.existsSync(p));

      if (schemaFile) {
        const schemaSql = fs.readFileSync(schemaFile, 'utf8');
        await pool.query(schemaSql);
        console.log('Schema applied successfully.');
      }
      if (seedFile) {
        const seedSql = fs.readFileSync(seedFile, 'utf8');
        await pool.query(seedSql);
        console.log('Initial seed data applied successfully.');
      }
    } else {
      // Auto-migrate sites table to ensure pass_hash and username exist if upgrading
      await pool.query('ALTER TABLE sites ADD COLUMN IF NOT EXISTS pass_hash TEXT');
      await pool.query('ALTER TABLE sites ADD COLUMN IF NOT EXISTS username VARCHAR(64)');
      await pool.query("UPDATE sites SET username = code WHERE username IS NULL OR username = ''");
      try {
        await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_sites_username ON sites(LOWER(username))');
      } catch (_) {}
    }
  } catch (err) {
    console.warn('Database initialization note:', err.message);
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
