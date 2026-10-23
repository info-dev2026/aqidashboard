-- Saaphzone AQI Monitoring Portal — PostgreSQL Schema
-- © 2026 Saaphzone Technologies LLP. All rights reserved.

-- Drop tables in reverse order of dependency if rebuilding
DROP TABLE IF EXISTS audit CASCADE;
DROP TABLE IF EXISTS readings CASCADE;
DROP TABLE IF EXISTS devices CASCADE;
DROP TABLE IF EXISTS sites CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- 1. Users Table
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(64) UNIQUE NOT NULL,
    pass_hash TEXT NOT NULL,
    role VARCHAR(32) NOT NULL CHECK (role IN ('admin', 'service', 'client')),
    name VARCHAR(128) NOT NULL,
    client VARCHAR(128),
    active SMALLINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_client ON users(client);

-- 2. Monitoring Sites Table
CREATE TABLE sites (
    id SERIAL PRIMARY KEY,
    code VARCHAR(32) UNIQUE NOT NULL,
    name VARCHAR(128) NOT NULL,
    client VARCHAR(128) NOT NULL,
    project VARCHAR(128) NOT NULL,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_sites_client ON sites(client);
CREATE INDEX idx_sites_project ON sites(project);

-- 3. Monitoring Devices Table
CREATE TABLE devices (
    id SERIAL PRIMARY KEY,
    device_id VARCHAR(64) UNIQUE NOT NULL,
    site_code VARCHAR(32) NOT NULL REFERENCES sites(code) ON DELETE CASCADE,
    location VARCHAR(255),
    api_key VARCHAR(128) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'offline',
    pm25 DOUBLE PRECISION DEFAULT 0,
    pm10 DOUBLE PRECISION DEFAULT 0,
    last_seen TIMESTAMPTZ,
    installed DATE NOT NULL DEFAULT CURRENT_DATE,
    last_cal DATE NOT NULL DEFAULT CURRENT_DATE,
    dev_type VARCHAR(32) NOT NULL DEFAULT 'maaps',
    power SMALLINT NOT NULL DEFAULT 1,
    power_manual VARCHAR(16),
    transmit SMALLINT NOT NULL DEFAULT 1,
    p_inlet DOUBLE PRECISION DEFAULT 0,
    p_outlet DOUBLE PRECISION DEFAULT 0,
    dp_warn DOUBLE PRECISION DEFAULT 1200,
    dp_crit DOUBLE PRECISION DEFAULT 1500,
    raining SMALLINT NOT NULL DEFAULT 0,
    sp_enabled SMALLINT NOT NULL DEFAULT 0,
    sp25 DOUBLE PRECISION DEFAULT 60,
    sp10 DOUBLE PRECISION DEFAULT 100,
    sp_band DOUBLE PRECISION DEFAULT 10
);

CREATE INDEX idx_devices_site_code ON devices(site_code);
CREATE INDEX idx_devices_status ON devices(status);

-- 4. Historical Readings Table
CREATE TABLE readings (
    id BIGSERIAL PRIMARY KEY,
    device_id VARCHAR(64) NOT NULL,
    pm25 DOUBLE PRECISION NOT NULL,
    pm10 DOUBLE PRECISION NOT NULL,
    aqi INTEGER NOT NULL,
    ts TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_readings_dev_ts ON readings(device_id, ts DESC);

-- 5. Audit Log Table
CREATE TABLE audit (
    id BIGSERIAL PRIMARY KEY,
    actor VARCHAR(64),
    action VARCHAR(64) NOT NULL,
    detail TEXT,
    ip VARCHAR(64),
    ts TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_actor ON audit(actor);
CREATE INDEX idx_audit_ts ON audit(ts DESC);
