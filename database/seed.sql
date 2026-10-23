-- Saaphzone AQI Monitoring Portal — Seed Data (PostgreSQL)
-- © 2026 Saaphzone Technologies LLP. All rights reserved.

BEGIN;

-- 1. Insert Initial Users
-- Passwords:
-- admin:   Sz9#vK!7mP@26%AdmX
-- service: Sv8!wL#4qR&26*EngY
-- escorts: ChangeMe#Client1
-- santosh: ChangeMe#Client1
INSERT INTO users (username, pass_hash, role, name, client) VALUES
('admin',   '$2a$12$X.wbrtbso/qDnhZzNFv.5Oaj9EHeI1bjCL/E7i9f/GqB6z3/jnl.6', 'admin',   'Dr. V. Pankaj',   NULL),
('service', '$2a$12$V.eidKOiXY9tqE7cVBKtGOcGVw1DK/Gg2t2hUNU5y/Ks76/wI9oW2', 'service', 'Sh. Chandan',     NULL),
('escorts', '$2a$12$aMHwUKxyBzXZ6h3sYv0eGOLjf3tCwrxAGRZutZtkKFdt9WwpdKQCm', 'client',  'Escorts Kubota',  'Escorts Kubota Ltd'),
('santosh', '$2a$12$aMHwUKxyBzXZ6h3sYv0eGOLjf3tCwrxAGRZutZtkKFdt9WwpdKQCm', 'client',  'Santosh Medical', 'Santosh Medical College')
ON CONFLICT (username) DO UPDATE SET pass_hash = EXCLUDED.pass_hash;

-- 2. Insert Initial Monitoring Sites
-- Site passwords:
-- S1: Site#Faridabad1
-- S2: Site#Faridabad3
-- S3: Site#Ghaziabad3
INSERT INTO sites (code, name, client, project, lat, lng, pass_hash) VALUES
('S1', 'Faridabad Plant-1', 'Escorts Kubota Ltd',      'EKL Ambient Network', 28.41, 77.31, '$2a$12$3gBktSdD6zUs1J7XPpN9CepnYNNksAjMF9xBg8ToPmrBTIjcJA6gS'),
('S2', 'Faridabad Plant-3', 'Escorts Kubota Ltd',      'EKL Ambient Network', 28.39, 77.29, '$2a$12$yW5I8QfjTospehbnzeptje0ZxIKap2N3s1xOn.eULYIF9TRa0Y192'),
('S3', 'Ghaziabad Campus',  'Santosh Medical College', 'Campus Air Quality',  28.68, 77.44, '$2a$12$NG4tUX/ZFsmx1b4gB9SlH./i0YezX0Vx0s56RM0kalpQ4cDv.wTJa')
ON CONFLICT (code) DO UPDATE SET pass_hash = EXCLUDED.pass_hash;

-- 3. Insert Initial Devices
INSERT INTO devices
(device_id, site_code, location, api_key, status, pm25, pm10, last_seen, dev_type, p_inlet, p_outlet, raining, power_manual, sp_enabled, sp25, sp10, sp_band, power)
VALUES
('MAAPS-0012', 'S1', 'Main Gate',        'maaps_8a7d1b3e9f0c2a4e6d8b0c2e4a6f8b0d2e4a6c8e0b2d4f6a', 'online',  38, 72,  CURRENT_TIMESTAMP, 'maaps', 950,  350, 0, NULL,  1, 60, 100, 10, 0),
('MAAPS-0018', 'S1', 'Foundry Boundary', 'maaps_3c5e7a9b1d3f5a7c9e1b3d5f7a9c1e3b5d7f9a1c3e5b7d9f', 'online',  61, 118, CURRENT_TIMESTAMP, 'maaps', 1850, 200, 0, NULL,  0, 60, 100, 10, 1),
('MAAPS-0023', 'S2', 'Assembly Yard',    'maaps_2b4d6f8a0c2e4a6c8e0b2d4f6a8c0e2b4d6f8a0c2e4a6c8e', 'online',  44, 88,  CURRENT_TIMESTAMP, 'maaps', 800,  300, 1, NULL,  0, 60, 100, 10, 0),
('BASIC-0007', 'S2', 'Perimeter PM',     'maaps_1a3c5e7b9d1f3a5c7e9b1d3f5a7c9e1b3d5f7a9c1e3b5d7f', 'online',  52, 96,  CURRENT_TIMESTAMP, 'basic', 0,    0,   0, NULL,  0, 60, 100, 10, 1),
('MAAPS-0031', 'S3', 'OPD Block Roof',   'maaps_9f1e3d5c7b9a1f3e5d7c9b1a3f5e7d9c1b3a5f7e9d1c3b5a', 'offline', 0,  0,   CURRENT_TIMESTAMP, 'maaps', 0,    0,   0, NULL,  0, 60, 100, 10, 1),
('MAAPS-0034', 'S3', 'Hostel Lawn',      'maaps_7e9d1c3b5a7f9e1d3c5b7a9f1e3d5c7b9a1f3e5d7c9b1a3f', 'online',  29, 54,  CURRENT_TIMESTAMP, 'maaps', 1300, 400, 0, 'off', 0, 60, 100, 10, 0)
ON CONFLICT (device_id) DO NOTHING;

-- 4. Insert Initial Telemetry Readings
INSERT INTO readings (device_id, pm25, pm10, aqi, ts) VALUES
('MAAPS-0012', 38, 72,  72,  CURRENT_TIMESTAMP - INTERVAL '15 minutes'),
('MAAPS-0018', 61, 118, 118, CURRENT_TIMESTAMP - INTERVAL '15 minutes'),
('MAAPS-0023', 44, 88,  88,  CURRENT_TIMESTAMP - INTERVAL '15 minutes'),
('BASIC-0007', 52, 96,  96,  CURRENT_TIMESTAMP - INTERVAL '15 minutes'),
('MAAPS-0034', 29, 54,  54,  CURRENT_TIMESTAMP - INTERVAL '15 minutes');

COMMIT;
