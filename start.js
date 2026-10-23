/*
 * Saaphzone AQI Monitoring Portal — Unified Runner
 * Starts both Backend API (port 5000) and Frontend Client (port 3000)
 * © 2026 Saaphzone Technologies LLP. All rights reserved.
 */
'use strict';

const { spawn } = require('child_process');

console.log('====================================================');
console.log(' Starting Saaphzone AQI Portal (Full Stack)');
console.log(' Backend API:  http://localhost:5000');
console.log(' Frontend App: http://localhost:3000');
console.log(' Database:     PostgreSQL (saaphzone_aqi)');
console.log('====================================================\n');

const isDev = process.argv.includes('--dev');
const backendCmd = isDev ? 'dev' : 'start';
const frontendCmd = isDev ? 'dev' : 'start';

const backend = spawn('npm', ['--prefix', 'backend', 'run', backendCmd], {
  stdio: 'inherit',
  shell: true
});

const frontend = spawn('npm', ['--prefix', 'frontend', 'run', frontendCmd], {
  stdio: 'inherit',
  shell: true
});

function cleanup() {
  console.log('\nStopping Saaphzone AQI services...');
  if (backend) backend.kill();
  if (frontend) frontend.kill();
  process.exit();
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
