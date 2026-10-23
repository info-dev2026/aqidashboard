# Saaphzone AQI Database Layer (PostgreSQL)

This directory contains the database definition, schema migrations, seed data, and initialization tools for the Saaphzone AQI Monitoring Portal.

## Architecture & Schema Overview

- **`users`**: Administrative and client users with bcrypt password hashes, roles (`admin`, `service`, `client`), and organization scoping.
- **`sites`**: Monitoring locations assigned to projects and client organizations, with geolocation coordinates.
- **`devices`**: MAAPS and Basic PM ambient monitoring devices with unique device IDs, secret API keys for data ingestion, hardware statuses, pressure metrics, rain detection, and PM setpoint hysteresis controls.
- **`readings`**: High-throughput time-series telemetry records storing PM2.5, PM10, computed AQI, and timestamps.
- **`audit`**: Security audit log tracking user authentication, credential modifications, device registrations, and administrative operations.

## Quick Setup

### Option 1: Local PostgreSQL (Recommended if installed locally)

1. Make sure PostgreSQL service is running on `localhost:5432`.
2. Configure credentials in `backend/.env`:
   ```env
   PGHOST=localhost
   PGPORT=5432
   PGDATABASE=saaphzone_aqi
   PGUSER=postgres
   PGPASSWORD=your_postgres_password
   ```
3. Initialize the database schema and seed initial data:
   ```bash
   node database/init.js
   ```
   Or using psql:
   ```bash
   psql -U postgres -d saaphzone_aqi -f database/schema.sql
   psql -U postgres -d saaphzone_aqi -f database/seed.sql
   ```

### Option 2: Docker Compose

If using Docker:
```bash
cd database
docker-compose up -d
```
This automatically boots PostgreSQL on port 5432 and executes `schema.sql` and `seed.sql`.
