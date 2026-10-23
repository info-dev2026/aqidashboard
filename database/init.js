/*
 * Saaphzone AQI Monitoring Portal — Database Initializer
 * © 2026 Saaphzone Technologies LLP. All rights reserved.
 */
'use strict';

const path = require('path');
const fs = require('fs');
let pg;
try {
  pg = require('pg');
} catch (e) {
  pg = require(path.join(__dirname, '..', 'backend', 'node_modules', 'pg'));
}
const { Client, Pool } = pg;

try {
  require('dotenv').config({ path: path.join(__dirname, '..', 'backend', '.env') });
} catch (e) {
  require(path.join(__dirname, '..', 'backend', 'node_modules', 'dotenv')).config({ path: path.join(__dirname, '..', 'backend', '.env') });
}

const DB_NAME = process.env.PGDATABASE || 'saaphzone_aqi';
const DB_USER = process.env.PGUSER || 'postgres';
const DB_PASSWORD = process.env.PGPASSWORD || '';
const DB_HOST = process.env.PGHOST || 'localhost';
const DB_PORT = parseInt(process.env.PGPORT || '5432', 10);

async function initDatabase() {
  console.log(`Connecting to PostgreSQL at ${DB_HOST}:${DB_PORT} as ${DB_USER}...`);

  // Step 1: Ensure target database exists
  const rootClient = new Client({
    user: DB_USER,
    password: DB_PASSWORD,
    host: DB_HOST,
    port: DB_PORT,
    database: 'postgres'
  });

  try {
    await rootClient.connect();
    const checkDb = await rootClient.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [DB_NAME]
    );

    if (checkDb.rows.length === 0) {
      console.log(`Database "${DB_NAME}" does not exist. Creating...`);
      await rootClient.query(`CREATE DATABASE "${DB_NAME}"`);
      console.log(`Database "${DB_NAME}" created successfully.`);
    } else {
      console.log(`Database "${DB_NAME}" already exists.`);
    }
  } catch (err) {
    console.error('Warning during database check/creation:', err.message);
  } finally {
    await rootClient.end();
  }

  // Step 2: Connect to target database and apply schema
  console.log(`Applying schema to database "${DB_NAME}"...`);
  const pool = new Pool({
    user: DB_USER,
    password: DB_PASSWORD,
    host: DB_HOST,
    port: DB_PORT,
    database: DB_NAME
  });

  try {
    const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await pool.query(schemaSql);
    console.log('PostgreSQL schema applied successfully.');

    // Step 3: Run seed logic
    const { seed } = require('./seed');
    await seed(pool);
    console.log('Database initialization complete!');
  } catch (err) {
    console.error('Error applying schema or seed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  initDatabase();
}

module.exports = { initDatabase };
