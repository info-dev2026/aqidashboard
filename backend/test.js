/*
 * Saaphzone AQI Monitoring Portal — Backend Integration Tests (PostgreSQL)
 * © 2026 Saaphzone Technologies LLP. All rights reserved.
 */
'use strict';

process.env.NODE_ENV = 'development';
const request = require('supertest');
const app = require('./src/server');
const { query, pool } = require('./src/db');

let pass = 0;
let fail = 0;
const chk = (name, cond) => {
  if (cond) {
    pass++;
    console.log('  PASS:', name);
  } else {
    fail++;
    console.log('  FAIL:', name);
  }
};

function cookieOf(res) {
  const sc = res.headers['set-cookie'] || [];
  return sc.map((c) => c.split(';')[0]).join('; ');
}

(async () => {
  try {
    console.log('Running Saaphzone AQI Backend integration tests on PostgreSQL...\n');

    // 0. Health check
    let r = await request(app).get('/api/health');
    chk('health check returns ok', r.status === 200 && r.body.status === 'ok');

    // 1. Admin login with seeded credentials
    const adminPw = process.env.SEED_ADMIN_PW || 'Sz9#vK!7mP@26%AdmX';
    r = await request(app).post('/api/login').send({ username: 'admin', password: adminPw, role: 'admin' });
    chk('admin login 200', r.status === 200);
    chk('token returned in json', typeof r.body.token === 'string');
    chk('session cookie set httpOnly', (r.headers['set-cookie'] || [])[0]?.toLowerCase().includes('httponly'));
    const adminCk = cookieOf(r);

    // 2. Wrong password
    r = await request(app).post('/api/login').send({ username: 'admin', password: 'WrongPassword123', role: 'admin' });
    chk('wrong password returns 401', r.status === 401);

    // 3. Role mismatch
    r = await request(app).post('/api/login').send({ username: 'admin', password: adminPw, role: 'client' });
    chk('role mismatch returns 401', r.status === 401);

    // 4. Client login + scope
    const clientPw = process.env.SEED_CLIENT_PW || 'ChangeMe#Client1';
    r = await request(app).post('/api/login').send({ username: 'escorts', password: clientPw, role: 'client' });
    chk('client login 200', r.status === 200);
    const escCk = cookieOf(r);

    r = await request(app).get('/api/devices').set('Cookie', escCk);
    const clients = [...new Set(r.body.map((d) => d.client))];
    chk('client sees only own client data', clients.length === 1 && clients[0] === 'Escorts Kubota Ltd');
    chk('no api_key leaked to client', !r.body.some((d) => d.api_key));

    // 5. RBAC: Client blocked from admin endpoints
    r = await request(app).get('/api/users').set('Cookie', escCk);
    chk('client blocked from /users (403)', r.status === 403);
    r = await request(app).post('/api/users').set('Cookie', escCk).send({ username: 'testuser', password: 'password123', role: 'client' });
    chk('client cannot create users (403)', r.status === 403);
    r = await request(app).delete('/api/users/1').set('Cookie', escCk);
    chk('client cannot delete users (403)', r.status === 403);

    // 6. Unauthenticated request
    r = await request(app).get('/api/devices');
    chk('no cookie -> 401', r.status === 401);

    // 7. Tampered token
    r = await request(app).get('/api/devices').set('Cookie', 'szsession=tampered.jwt.value');
    chk('tampered token -> 401', r.status === 401);

    // 8. Admin user management & protected primary admin
    r = await request(app).get('/api/users').set('Cookie', adminCk);
    chk('admin lists users', r.status === 200 && r.body.length >= 4);
    const adminRow = r.body.find((u) => u.username === 'admin');
    r = await request(app).delete('/api/users/' + adminRow.id).set('Cookie', adminCk);
    chk('cannot delete primary admin', r.status === 400);

    // 9. Weak password rejected
    r = await request(app).post('/api/users').set('Cookie', adminCk).send({ username: 'weakuser', password: 'short', role: 'client' });
    chk('weak password rejected', r.status === 400);

    // 10. Admin creates user, resets password, login works
    const existing = (await request(app).get('/api/users').set('Cookie', adminCk)).body.find((u) => u.username === 'heromoto');
    if (existing) {
      await request(app).delete('/api/users/' + existing.id).set('Cookie', adminCk);
    }
    r = await request(app).post('/api/users').set('Cookie', adminCk).send({
      username: 'heromoto',
      password: 'Hero#StrongPassword99',
      role: 'client',
      name: 'Hero MotoCorp',
      client: 'Hero MotoCorp Ltd'
    });
    chk('admin creates user (201)', r.status === 201);

    r = await request(app).get('/api/users').set('Cookie', adminCk);
    const hero = r.body.find((u) => u.username === 'heromoto');
    r = await request(app).post('/api/users/' + hero.id + '/password').set('Cookie', adminCk).send({ password: 'Hero#NewUpdatedPassword99' });
    chk('admin resets password', r.status === 200);

    r = await request(app).post('/api/login').send({ username: 'heromoto', password: 'Hero#NewUpdatedPassword99', role: 'client' });
    chk('new password login works', r.status === 200);

    // 11. Device telemetry ingestion with API key
    const adminDevs = await request(app).get('/api/devices').set('Cookie', adminCk);
    const dev = adminDevs.body[0];
    const keyRes = await request(app).get('/api/devices/' + dev.device_id + '/key').set('Cookie', adminCk);
    chk('admin can fetch device key', keyRes.status === 200 && keyRes.body.api_key.startsWith('maaps_'));
    const key = keyRes.body.api_key;

    r = await request(app).post('/api/ingest').set('X-Device-Key', key).send({
      device_id: dev.device_id,
      pm25: 55,
      pm10: 95
    });
    chk('valid ingest 200 with AQI', r.status === 200 && typeof r.body.aqi === 'number');

    r = await request(app).post('/api/ingest').set('X-Device-Key', 'maaps_invalid_key').send({
      device_id: dev.device_id,
      pm25: 55,
      pm10: 95
    });
    chk('bad device key -> 401', r.status === 401);

    r = await request(app).post('/api/ingest').set('X-Device-Key', key).send({
      device_id: dev.device_id,
      pm25: -5,
      pm10: 95
    });
    chk('out-of-range reading rejected', r.status === 400);

    // 12. History reflects ingest
    r = await request(app).get('/api/devices/' + dev.device_id + '/history').set('Cookie', adminCk);
    chk('history returns readings', r.status === 200 && r.body.length >= 1);

    // 13. Oversized body rejected
    try {
      r = await request(app).post('/api/login').set('Content-Type', 'application/json').send({
        username: 'a',
        password: 'x'.repeat(70000),
        role: 'admin'
      });
      chk('oversized payload rejected', r.status === 413 || r.status === 400);
    } catch {
      chk('oversized payload rejected', true);
    }

    // 14. Security headers present
    r = await request(app).get('/api/me').set('Cookie', adminCk);
    chk('CSP header present', !!r.headers['content-security-policy']);
    chk('no x-powered-by header', !r.headers['x-powered-by']);

    // 15. Public /api/sites works without authentication and doesn't leak pass_hash
    r = await request(app).get('/api/sites');
    chk('public /api/sites 200 without auth', r.status === 200 && Array.isArray(r.body) && r.body.length >= 3);
    chk('public /api/sites does not leak pass_hash', !r.body.some((s) => s.pass_hash));

    // 16. Admin creates site with manual password
    const testSiteCode = 'TEST_SITE_1';
    await query('DELETE FROM sites WHERE code = $1', [testSiteCode]);
    r = await request(app).post('/api/sites').set('Cookie', adminCk).send({
      code: testSiteCode,
      name: 'Test Industrial Site',
      client: 'Test Industries Ltd',
      project: 'Testing Network',
      password: 'Site#TestPassword2026',
      lat: 28.5,
      lng: 77.2
    });
    chk('admin creates site with manual password (201)', r.status === 201 && r.body.has_password === true);

    // 17. Update site password via /api/sites/:code/password
    r = await request(app).post(`/api/sites/${testSiteCode}/password`).set('Cookie', adminCk).send({
      password: 'Site#UpdatedPassword2026'
    });
    chk('admin updates site password (200)', r.status === 200 && r.body.ok === true);

    // 18. Login with site code + manual password
    r = await request(app).post('/api/login').send({
      username: testSiteCode,
      password: 'Site#UpdatedPassword2026',
      role: 'client'
    });
    chk('site login with manual password (200)', r.status === 200 && r.body.user.site_code === testSiteCode);
    const siteCk = cookieOf(r);

    // 19. Scoped site user sees only their site
    r = await request(app).get('/api/sites').set('Cookie', siteCk);
    chk('site user sees only their own site', r.status === 200 && r.body.length === 1 && r.body[0].code === testSiteCode);

    // Clean up test site
    await query('DELETE FROM sites WHERE code = $1', [testSiteCode]);

    console.log(`\nResults: ${pass} passed, ${fail} failed`);
  } catch (err) {
    console.error('Test execution error:', err);
    fail++;
  } finally {
    await pool.end();
    process.exit(fail ? 1 : 0);
  }
})();
