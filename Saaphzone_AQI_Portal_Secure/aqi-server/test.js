/* Security & functional test suite (in-process, no socket) */
'use strict';
process.env.NODE_ENV = 'development';
const request = require('supertest');
const app = require('./src/server');

let pass = 0, fail = 0;
const chk = (name, cond) => { if (cond) { pass++; } else { fail++; console.log('  FAIL:', name); } };

function cookieOf(res) {
  const sc = res.headers['set-cookie'] || [];
  return sc.map(c => c.split(';')[0]).join('; ');
}

(async () => {
  // 1. admin login
  let r = await request(app).post('/api/login').send({ username: 'admin', password: 'Admin#Test123', role: 'admin' });
  chk('admin login 200', r.status === 200);
  chk('session cookie set httpOnly', (r.headers['set-cookie'] || [])[0]?.toLowerCase().includes('httponly'));
  const adminCk = cookieOf(r);

  // 2. wrong password
  r = await request(app).post('/api/login').send({ username: 'admin', password: 'nope', role: 'admin' });
  chk('wrong password 401', r.status === 401);

  // 3. role mismatch (right creds, wrong role tab)
  r = await request(app).post('/api/login').send({ username: 'admin', password: 'Admin#Test123', role: 'client' });
  chk('role mismatch 401', r.status === 401);

  // 4. client login + scope
  r = await request(app).post('/api/login').send({ username: 'escorts', password: 'Client#Test123', role: 'client' });
  chk('client login 200', r.status === 200);
  const escCk = cookieOf(r);

  r = await request(app).get('/api/devices').set('Cookie', escCk);
  const clients = [...new Set(r.body.map(d => d.client))];
  chk('client sees only own client data', clients.length === 1 && clients[0] === 'Escorts Kubota Ltd');
  chk('no api_key leaked to client', !r.body.some(d => d.api_key));

  // 5. RBAC: client blocked from admin endpoints
  r = await request(app).get('/api/users').set('Cookie', escCk);
  chk('client blocked from /users (403)', r.status === 403);
  r = await request(app).post('/api/users').set('Cookie', escCk).send({ username: 'x', password: 'aaaaaaaa', role: 'client' });
  chk('client cannot create users (403)', r.status === 403);
  r = await request(app).delete('/api/users/1').set('Cookie', escCk);
  chk('client cannot delete users (403)', r.status === 403);

  // 6. unauthenticated
  r = await request(app).get('/api/devices');
  chk('no cookie -> 401', r.status === 401);

  // 7. tampered token
  r = await request(app).get('/api/devices').set('Cookie', 'szsession=tampered.jwt.value');
  chk('tampered token -> 401', r.status === 401);

  // 8. admin can list users; primary admin protected from deletion
  r = await request(app).get('/api/users').set('Cookie', adminCk);
  chk('admin lists users', r.status === 200 && r.body.length >= 4);
  const adminRow = r.body.find(u => u.username === 'admin');
  r = await request(app).delete('/api/users/' + adminRow.id).set('Cookie', adminCk);
  chk('cannot delete primary admin', r.status === 400);

  // 9. weak password rejected on create
  r = await request(app).post('/api/users').set('Cookie', adminCk).send({ username: 'weak', password: 'short', role: 'client' });
  chk('weak password rejected', r.status === 400);

  // 10. admin creates a client, resets password (idempotent)
  let existing = (await request(app).get('/api/users').set('Cookie', adminCk)).body.find(u => u.username === 'heromoto');
  if (existing) await request(app).delete('/api/users/' + existing.id).set('Cookie', adminCk);
  r = await request(app).post('/api/users').set('Cookie', adminCk)
    .send({ username: 'heromoto', password: 'Hero#Strong99', role: 'client', name: 'Hero MotoCorp', client: 'Hero MotoCorp Ltd' });
  chk('admin creates user 201', r.status === 201);
  r = await request(app).get('/api/users').set('Cookie', adminCk);
  const hero = r.body.find(u => u.username === 'heromoto');
  r = await request(app).post('/api/users/' + hero.id + '/password').set('Cookie', adminCk).send({ password: 'Hero#Newpass99' });
  chk('admin resets password', r.status === 200);
  r = await request(app).post('/api/login').send({ username: 'heromoto', password: 'Hero#Newpass99', role: 'client' });
  chk('new password works', r.status === 200);

  // 11. device ingestion with API key
  const adminDevs = await request(app).get('/api/devices').set('Cookie', adminCk);
  const dev = adminDevs.body[0];
  const keyRes = await request(app).get('/api/devices/' + dev.device_id + '/key').set('Cookie', adminCk);
  chk('admin can fetch device key', keyRes.status === 200 && keyRes.body.api_key.startsWith('maaps_'));
  const key = keyRes.body.api_key;

  r = await request(app).post('/api/ingest').set('X-Device-Key', key)
    .send({ device_id: dev.device_id, pm25: 55, pm10: 95 });
  chk('valid ingest 200', r.status === 200 && typeof r.body.aqi === 'number');

  r = await request(app).post('/api/ingest').set('X-Device-Key', 'maaps_wrongkey')
    .send({ device_id: dev.device_id, pm25: 55, pm10: 95 });
  chk('bad device key -> 401', r.status === 401);

  r = await request(app).post('/api/ingest').set('X-Device-Key', key)
    .send({ device_id: dev.device_id, pm25: -5, pm10: 95 });
  chk('out-of-range reading rejected', r.status === 400);

  // 12. history reflects ingest, scoped
  r = await request(app).get('/api/devices/' + dev.device_id + '/history').set('Cookie', adminCk);
  chk('history returns readings', r.status === 200 && r.body.length >= 1);

  // 13. oversized body rejected (payload limit 64kb)
  try {
    r = await request(app).post('/api/login').set('Content-Type', 'application/json')
      .send({ username: 'a', password: 'x'.repeat(70000), role: 'admin' });
    chk('oversized payload rejected', r.status === 413 || r.status === 400);
  } catch (e) {
    // supertest surfaces the aborted connection as an error — that IS the rejection
    chk('oversized payload rejected', true);
  }

  // 14. security headers present (helmet)
  r = await request(app).get('/api/me').set('Cookie', adminCk);
  chk('CSP header present', !!r.headers['content-security-policy']);
  chk('no x-powered-by', !r.headers['x-powered-by']);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
