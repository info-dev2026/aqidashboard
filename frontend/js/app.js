/*
 * Saaphzone AQI Monitoring Portal — Main Application Controller
 * © 2026 Saaphzone Technologies LLP. All rights reserved.
 */

'use strict';

const $ = (s) => document.querySelector(s);
const el = (tag, className, innerHTML) => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (innerHTML != null) e.innerHTML = innerHTML;
  return e;
};

function toast(msg, isError) {
  const t = el('div', 'toast' + (isError ? ' err' : ''), msg);
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), 3400);
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}

function avg(arr) {
  return arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
}

function siteByCode(code) {
  return STATE.sites.find((s) => s.code === code);
}

const STATE = {
  session: null,
  sites: [],
  devices: [],
  curView: 'dash'
};

const NAV = {
  admin: [
    ['dash', '◉', 'Dashboard'],
    ['map', '◍', 'Live Map'],
    ['sites', '▤', 'Projects & Sites'],
    ['devices', '◈', 'Devices'],
    ['users', '◐', 'User Management'],
    ['data', '▦', 'Live Data'],
    ['audit', '📜', 'Audit Log']
  ],
  service: [
    ['dash', '◉', 'Dashboard'],
    ['map', '◍', 'Live Map'],
    ['sites', '▤', 'Projects & Sites'],
    ['devices', '◈', 'Devices'],
    ['data', '▦', 'Live Data']
  ],
  client: [
    ['dash', '◉', 'Dashboard'],
    ['map', '◍', 'Live Map'],
    ['sites', '▤', 'My Sites'],
    ['data', '▦', 'Live Data']
  ]
};

/* ===== LOGIN CONTROLLER ===== */
let selRole = 'client';

document.querySelectorAll('.role-tab').forEach((t) => {
  t.onclick = () => {
    document.querySelectorAll('.role-tab').forEach((x) => x.classList.remove('on'));
    t.classList.add('on');
    selRole = t.dataset.r;
    $('#uL').textContent = selRole === 'client' ? 'Client ID' : 'User ID';
  };
});

$('#gateBtn').onclick = login;
$('#p').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') login();
});

async function login() {
  const username = $('#u').value.trim();
  const password = $('#p').value;
  $('#gateErr').textContent = '';

  if (!username || !password) {
    $('#gateErr').textContent = 'Please enter both username and password';
    return;
  }

  $('#gateBtn').disabled = true;
  $('#gateBtn').textContent = 'Signing in…';

  try {
    const res = await API.post('/login', { username, password, role: selRole });
    if (res.token) {
      API.setToken(res.token);
    }
    STATE.session = res.user;
    $('#gate').style.display = 'none';
    $('#app').classList.add('on');
    buildNav();
    await refresh();
    go('dash');
    toast(`Welcome, ${STATE.session.name}`);
  } catch (err) {
    $('#gateErr').textContent = err.message || 'Login failed';
  } finally {
    $('#gateBtn').disabled = false;
    $('#gateBtn').textContent = 'Sign in';
  }
}

$('#logoutBtn').onclick = async () => {
  try {
    await API.post('/logout');
  } catch (e) {
    // Ignore network error on logout
  }
  API.setToken(null);
  STATE.session = null;
  $('#app').classList.remove('on');
  $('#gate').style.display = 'flex';
  $('#u').value = '';
  $('#p').value = '';
};

$('#menuBtn').onclick = () => $('#sidebar').classList.toggle('open');

/* ===== DATA SYNC ===== */
async function refresh() {
  try {
    const [sites, devices] = await Promise.all([
      API.get('/sites'),
      API.get('/devices')
    ]);
    STATE.sites = sites || [];
    STATE.devices = devices || [];
  } catch (err) {
    console.error('Refresh error:', err);
  }
}

function buildNav() {
  const s = STATE.session;
  if (!s) return;
  $('#sbRole').innerHTML = `<b>${esc(s.name)}</b>${s.role[0].toUpperCase() + s.role.slice(1)}${s.client ? ' · ' + esc(s.client) : ''}`;
  const nav = $('#sbNav');
  nav.innerHTML = '';
  const items = NAV[s.role] || NAV.client;
  items.forEach(([k, ic, label]) => {
    const item = el('div', 'nav-i', `<span class="ic">${ic}</span>${label}`);
    item.dataset.k = k;
    item.onclick = () => {
      go(k);
      $('#sidebar').classList.remove('open');
    };
    nav.appendChild(item);
  });
}

function setActive(k) {
  document.querySelectorAll('.nav-i').forEach((n) => n.classList.toggle('on', n.dataset.k === k));
}

function onlineDevs() {
  return STATE.devices.filter((d) => d.status === 'online');
}

/* ===== ROUTER ===== */
let chartRef = null;
let mapRef = null;

async function go(k) {
  STATE.curView = k;
  setActive(k);
  const titles = {
    dash: 'Dashboard',
    map: 'Live Map',
    sites: STATE.session && STATE.session.role === 'client' ? 'My Sites' : 'Projects & Sites',
    devices: 'Devices',
    users: 'User Management',
    data: 'Live Data',
    audit: 'Security Audit Log'
  };
  $('#tbTitle').textContent = titles[k] || 'Dashboard';
  const c = $('#content');
  c.innerHTML = '<div class="empty">Loading data from PostgreSQL…</div>';

  if (chartRef) {
    chartRef.destroy();
    chartRef = null;
  }
  if (mapRef) {
    mapRef.remove();
    mapRef = null;
  }

  try {
    if (k !== 'users' && k !== 'audit') {
      await refresh();
    }
    c.innerHTML = '';
    const views = {
      dash: renderDash,
      map: renderMap,
      sites: renderSites,
      devices: renderDevices,
      users: renderUsers,
      data: renderData,
      audit: renderAudit
    };
    if (views[k]) {
      await views[k](c);
    }
  } catch (err) {
    c.innerHTML = '';
    c.appendChild(el('div', 'empty', 'Error loading view: ' + esc(err.message)));
  }
}

/* ===== MODAL CONTROLLER ===== */
function openModal(title, bodyHtml, onSave, saveBtnText = 'Save') {
  const bg = el('div', 'modal-bg');
  const box = el('div', 'modal-box');
  box.innerHTML = `
    <div class="modal-h">
      <h3>${esc(title)}</h3>
      <button class="modal-close">&times;</button>
    </div>
    <div class="modal-body">${bodyHtml}</div>
    <div class="modal-foot">
      <button class="btn btn-ghost btn-sm" id="mCancel">Cancel</button>
      <button class="btn btn-primary btn-sm" id="mSave">${esc(saveBtnText)}</button>
    </div>
  `;
  bg.appendChild(box);
  document.body.appendChild(bg);

  const close = () => bg.remove();
  box.querySelector('.modal-close').onclick = close;
  box.querySelector('#mCancel').onclick = close;
  box.querySelector('#mSave').onclick = async () => {
    if (onSave) {
      const ok = await onSave(bg);
      if (ok !== false) close();
    } else {
      close();
    }
  };
  bg.onclick = (e) => {
    if (e.target === bg) close();
  };
  return bg;
}

/* ===== VIEW: DASHBOARD ===== */
function renderDash(c) {
  const devs = STATE.devices;
  const online = onlineDevs();
  const pm25 = avg(online.map((d) => d.pm25));
  const pm10 = avg(online.map((d) => d.pm10));
  const aqi = computeAQI(pm25, pm10);
  const cat = aqiCat(aqi);

  const hero = el('div', 'aqi-hero');
  hero.innerHTML = `
    <div class="aqi-dial" style="background:linear-gradient(160deg, ${cat.color}, ${shade(cat.color, -22)})">
      <div class="num">${online.length ? aqi : '—'}</div>
      <div class="cat">${online.length ? cat.name : 'Offline'}</div>
      <div class="lbl">Network AQI</div>
    </div>
    <div class="aqi-info">
      <h3>Network Air Quality — Live Average</h3>
      <div class="loc">${STATE.sites.length} site(s) configured · ${online.length} of ${devs.length} devices online</div>
      <div class="poll-grid">
        <div class="poll" style="border-left-color:${aqiCat(subIndex(pm25, BP_PM25)).color}">
          <div class="p-n">PM 2.5</div>
          <div class="p-v">${online.length ? pm25 : '—'}</div>
          <div class="p-u">µg/m³ · live avg</div>
        </div>
        <div class="poll" style="border-left-color:${aqiCat(subIndex(pm10, BP_PM10)).color}">
          <div class="p-n">PM 10</div>
          <div class="p-v">${online.length ? pm10 : '—'}</div>
          <div class="p-u">µg/m³ · live avg</div>
        </div>
      </div>
      <div class="legend">
        ${AQI_CATS.map((x) => `<span><i style="background:${x.color}"></i>${x.name}</span>`).join('')}
      </div>
    </div>
  `;
  c.appendChild(hero);

  const kp = el('div', 'kpis');
  const projectsCount = [...new Set(STATE.sites.map((s) => s.project))].length;
  [
    ['Projects', projectsCount, '', '#073859'],
    ['Monitoring Sites', STATE.sites.length, '', '#14adcd'],
    ['MAAPS Devices', devs.length, '', '#0d5a86'],
    ['Devices Online', online.length, `/ ${devs.length}`, '#009966']
  ].forEach(([lab, val, un, col]) => {
    kp.appendChild(
      el(
        'div',
        'kpi',
        `<div class="accent" style="background:${col}"></div>
         <div class="lab">${lab}</div>
         <div class="val">${val} <span class="un">${un}</span></div>`
      )
    );
  });
  c.appendChild(kp);

  const card = el('div', 'card');
  card.innerHTML = '<div class="card-h"><h3>Site AQI Overview</h3></div>';
  const grid = el('div', 'site-grid');

  if (!STATE.sites.length) {
    grid.innerHTML = '<div class="empty">No sites available.</div>';
  } else {
    STATE.sites.forEach((s) => {
      const sd = STATE.devices.filter((d) => d.site_code === s.code && d.status === 'online');
      const p25 = avg(sd.map((d) => d.pm25));
      const p10 = avg(sd.map((d) => d.pm10));
      const sa = sd.length ? computeAQI(p25, p10) : 0;
      const sc = sd.length ? aqiCat(sa) : { name: 'Offline', color: '#888888' };

      const cardEl = el('div', 'site-card');
      cardEl.innerHTML = `
        <div class="site-band" style="background:${sc.color}"></div>
        <div class="site-body">
          <h4>${esc(s.name)}</h4>
          <div class="cl">${esc(s.client)} · ${esc(s.project)}</div>
          <div class="site-metrics">
            <div class="m">
              <div class="mv" style="color:${sc.color}">${sd.length ? sa : '—'}</div>
              <div class="ml">AQI · ${sc.name}</div>
            </div>
            <div class="m">
              <div class="mv">${sd.length ? p25 : '—'}</div>
              <div class="ml">PM2.5</div>
            </div>
            <div class="m">
              <div class="mv">${sd.length ? p10 : '—'}</div>
              <div class="ml">PM10</div>
            </div>
          </div>
        </div>
        <div class="site-foot">
          <span>${STATE.devices.filter((d) => d.site_code === s.code).length} device(s)</span>
          <span>${sd.length} online</span>
        </div>
      `;
      cardEl.onclick = () => go('sites');
      grid.appendChild(cardEl);
    });
  }
  card.appendChild(grid);
  c.appendChild(card);
}

/* ===== VIEW: SITES ===== */
function renderSites(c) {
  const canEdit = STATE.session.role !== 'client';
  const card = el('div', 'card');
  card.innerHTML = `
    <div class="card-h">
      <h3>Projects &amp; Monitoring Sites</h3>
      ${canEdit ? '<button class="btn btn-primary btn-sm" id="addSite">+ Add Site</button>' : ''}
    </div>
  `;

  const projects = [...new Set(STATE.sites.map((s) => s.project))];
  if (!projects.length) {
    card.appendChild(el('div', 'empty', 'No sites assigned yet.'));
  }

  projects.forEach((pr) => {
    card.appendChild(el('div', 'section-title', esc(pr)));
    const grid = el('div', 'site-grid');
    STATE.sites
      .filter((s) => s.project === pr)
      .forEach((s) => {
        const devs = STATE.devices.filter((d) => d.site_code === s.code);
        const on = devs.filter((d) => d.status === 'online');
        const sa = on.length ? computeAQI(avg(on.map((d) => d.pm25)), avg(on.map((d) => d.pm10))) : 0;
        const sc = on.length ? aqiCat(sa) : { name: 'Offline', color: '#888888' };

        const cardEl = el('div', 'site-card');
        cardEl.innerHTML = `
          <div class="site-band" style="background:${sc.color}"></div>
          <div class="site-body">
            <h4>${esc(s.name)}</h4>
            <div class="cl">${esc(s.client)}</div>
            <div class="site-metrics">
              <div class="m"><div class="mv" style="color:${sc.color}">${on.length ? sa : '—'}</div><div class="ml">AQI</div></div>
              <div class="m"><div class="mv">${devs.length}</div><div class="ml">Devices</div></div>
              <div class="m"><div class="mv">${on.length}</div><div class="ml">Online</div></div>
            </div>
          </div>
          <div class="site-foot">
            <span>📍 ${s.lat != null ? s.lat : '—'}, ${s.lng != null ? s.lng : '—'}</span>
            ${canEdit ? `<button class="btn btn-ghost btn-sm" data-add="${esc(s.code)}">+ Device</button>` : ''}
          </div>
        `;
        grid.appendChild(cardEl);
        if (canEdit) {
          cardEl.querySelector('[data-add]').onclick = (e) => {
            e.stopPropagation();
            deviceModal(s.code);
          };
        }
        cardEl.onclick = () => go('devices');
      });
    card.appendChild(grid);
  });

  c.appendChild(card);
  if (canEdit) {
    $('#addSite').onclick = () => siteModal();
  }
}

/* ===== VIEW: DEVICES ===== */
function renderDevices(c) {
  const canEdit = STATE.session.role !== 'client';
  const card = el('div', 'card');
  card.innerHTML = `
    <div class="card-h">
      <h3>Monitoring Devices</h3>
      ${canEdit ? '<button class="btn btn-primary btn-sm" id="addDev">+ Add Device</button>' : ''}
    </div>
  `;

  const tbl = el('table');
  tbl.innerHTML = `
    <thead>
      <tr>
        <th>Device ID</th>
        <th>Type</th>
        <th>Site</th>
        <th>PM2.5</th>
        <th>PM10</th>
        <th>AQI</th>
        <th>Power</th>
        <th>Health</th>
        <th>Actions</th>
      </tr>
    </thead>
  `;
  const tb = el('tbody');

  STATE.devices.forEach((d) => {
    const on = d.status === 'online';
    const a = on ? computeAQI(d.pm25, d.pm10) : '—';
    const ca = on ? aqiCat(a) : { color: '#999999' };
    const isMaaps = d.dev_type === 'maaps';
    const pOn = d.power_on && on;
    const pwLabel = !on
      ? 'Offline'
      : d.power_on
      ? d.power_reason === 'setpoint'
        ? 'ON (auto)'
        : 'ON'
      : d.power_reason === 'rain'
      ? 'Auto-off (rain)'
      : d.power_reason === 'setpoint'
      ? 'Auto-off (clean air)'
      : 'OFF';
    const pwColor = !on ? '#8a8a8a' : d.power_on ? '#12c46a' : '#cc0033';
    const svc = isMaaps && d.pressure ? d.pressure : null;

    const tr = el('tr');
    tr.innerHTML = `
      <td>
        <b>${esc(d.device_id)}</b>
        <div style="font-size:11.5px;color:var(--muted)">${esc(d.location || '')}</div>
      </td>
      <td><span class="dtype-pill">${isMaaps ? 'MAAPS' : 'Basic PM'}</span></td>
      <td>${esc(d.site_name)}</td>
      <td>${on ? d.pm25 : '—'}</td>
      <td>${on ? d.pm10 : '—'}</td>
      <td><span class="tag" style="background:${ca.color}22;color:${shade(ca.color, -30)}">${a}</span></td>
      <td>
        <span class="plight ${pOn ? 'on' : 'off'}" style="width:11px;height:11px;box-shadow:none;vertical-align:middle"></span>
        <span style="color:${pwColor};font-weight:700;font-size:12.5px">${pwLabel}</span>
      </td>
      <td>
        ${
          isMaaps
            ? svc
              ? `<span class="svc-chip" style="background:${svc.color}22;color:${shade(svc.color, -25)}">
                   <span class="dev-status" style="background:${svc.color};margin:0"></span>
                   ${svc.level === 'green' ? 'Healthy' : svc.level === 'amber' ? 'Monitor' : svc.level === 'red' ? 'Service req.' : '—'}
                 </span>`
              : '—'
            : '<span style="color:var(--muted);font-size:12px">n/a</span>'
        }
      </td>
      <td style="white-space:nowrap">
        <button class="btn btn-ghost btn-sm" data-view="${esc(d.device_id)}">Details</button>
        ${canEdit ? ` <button class="btn btn-danger btn-sm" data-del="${esc(d.device_id)}">Del</button>` : ''}
      </td>
    `;
    tb.appendChild(tr);

    tr.querySelector('[data-view]').onclick = () => deviceDetail(d.device_id);
    if (canEdit) {
      const del = tr.querySelector('[data-del]');
      if (del) {
        del.onclick = async () => {
          if (confirm(`Delete device ${d.device_id}?`)) {
            try {
              await API.del('/devices/' + encodeURIComponent(d.device_id));
              toast('Device deleted');
              go('devices');
            } catch (err) {
              toast(err.message, true);
            }
          }
        };
      }
    }
  });

  tbl.appendChild(tb);
  card.appendChild(tbl);
  if (!STATE.devices.length) {
    card.appendChild(el('div', 'empty', 'No devices found.'));
  }
  c.appendChild(card);
  if (canEdit) {
    $('#addDev').onclick = () => deviceModal();
  }
}

/* ===== DEVICE DETAIL MODAL ===== */
function deviceDetail(id) {
  const d = STATE.devices.find((x) => x.device_id === id);
  if (!d) return;

  const canEdit = STATE.session.role !== 'client';
  const on = d.status === 'online';
  const isMaaps = d.dev_type === 'maaps';
  const a = on ? computeAQI(d.pm25, d.pm10) : null;
  const ca = on ? aqiCat(a) : { color: '#999999', name: 'Offline' };
  const pOn = d.power_on && on;
  const press = d.pressure || { level: 'idle', dp: 0, color: '#8a8a8a', label: '—' };
  const dpPct = Math.max(0, Math.min(1, press.dp / 2000));

  let body = `
    <div class="badge-line">
      <span class="dtype-pill">${isMaaps ? 'MAAPS Ambient Air Device' : 'Basic PM Sensor'}</span>
      <span class="mini-tag" style="background:${ca.color}22;color:${shade(ca.color, -25)}">AQI ${on ? a : '—'} · ${ca.name}</span>
      <span class="mini-tag" style="background:#eef4f8;color:#073859">${esc(d.site_name)} · ${esc(d.location || '')}</span>
    </div>
    <div class="health-grid">
      <div class="hcard">
        <h5>PM 2.5</h5>
        <div class="hval" style="color:${aqiCat(subIndex(d.pm25, BP_PM25)).color}">${on ? d.pm25 : '—'}</div>
        <div class="hsub">µg/m³</div>
      </div>
      <div class="hcard">
        <h5>PM 10</h5>
        <div class="hval" style="color:${aqiCat(subIndex(d.pm10, BP_PM10)).color}">${on ? d.pm10 : '—'}</div>
        <div class="hsub">µg/m³</div>
      </div>
  `;

  if (isMaaps) {
    body += `
      <div class="hcard">
        <h5>Device Fan</h5>
        <div class="fan ${pOn ? 'spin' : 'stop'}" id="fanEl">${fanSVG()}</div>
        <div class="pw-row">
          <span class="plight ${pOn ? 'on' : 'off'} ${!on ? '' : pOn ? '' : 'blink'}"></span>
          ${pOn ? 'Running' : d.power_reason === 'rain' ? 'Stopped · Rain' : d.power_reason === 'setpoint' ? 'Stopped · Clean air' : on ? 'Stopped' : 'Offline'}
        </div>
      </div>
      <div class="hcard">
        <h5>Auto Start/Stop</h5>
        <div style="font-size:26px">${d.sp_enabled ? (pOn ? '⤴️' : '⤵️') : '⏸️'}</div>
        <div class="hsub">${d.sp_enabled ? `Setpoint PM2.5 &gt; ${d.sp25} &amp; PM10 &gt; ${d.sp10}` : 'Setpoint disabled'}</div>
        ${d.sp_enabled ? `<span class="mini-tag" style="background:${pOn ? '#e3f9ef' : '#eef4f8'};color:${pOn ? '#009966' : '#073859'}">${d.power_reason === 'setpoint' ? (pOn ? 'Running — air above setpoint' : 'Idle — air below setpoint') : 'Overridden'}</span>` : ''}
      </div>
      <div class="hcard">
        <h5>Rain Sensor</h5>
        ${rainBox(!!d.raining)}
        <div class="hsub">${d.raining ? 'Raining — device auto-off' : 'Dry'}</div>
      </div>
      <div class="hcard">
        <h5>Filter Pressure ΔP</h5>
        ${gaugeSVG(dpPct, press.color)}
        <div class="gauge-val" style="color:${press.color}">${press.dp} Pa</div>
        <span class="svc-chip" style="background:${press.color}22;color:${shade(press.color, -25)}">
          <span class="dev-status" style="background:${press.color};margin:0"></span>
          ${press.level === 'green' ? 'Healthy' : press.level === 'amber' ? 'Monitor' : press.level === 'red' ? 'Service required' : 'Idle'}
        </span>
        <div class="hsub">In ${d.p_inlet || 0} · Out ${d.p_outlet || 0} Pa</div>
      </div>
      <div class="hcard">
        <h5>Data Transmission</h5>
        <div style="font-size:30px">${d.transmit ? '📡' : '🚫'}</div>
        <div class="pw-row">
          <span class="plight ${d.transmit ? 'on' : 'off'}"></span>
          ${d.transmit ? 'Transmitting' : 'Paused'}
        </div>
      </div>
      <div class="hcard">
        <h5>Location</h5>
        <div style="font-size:26px">📍</div>
        <div class="hsub">${d.lat != null ? d.lat : '—'}, ${d.lng != null ? d.lng : '—'}</div>
      </div>
    `;
  }
  body += `</div>`;

  if (isMaaps && canEdit) {
    body += `
      <div style="margin-top:18px;border-top:1px solid var(--line);padding-top:14px">
        <div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:9px">Controls (Admin / Service)</div>
        <div class="toggle-row">
          <button class="btn btn-sm ${d.power_reason === 'manual' && d.power_on ? 'btn-primary' : 'btn-ghost'}" data-pw="on">Power ON</button>
          <button class="btn btn-sm ${d.power_reason === 'manual' && !d.power_on ? 'btn-danger' : 'btn-ghost'}" data-pw="off">Power OFF</button>
          <button class="btn btn-sm ${d.power_reason !== 'manual' ? 'btn-primary' : 'btn-ghost'}" data-pw="auto">Auto (rain + setpoint)</button>
        </div>
        <div class="toggle-row">
          <button class="btn btn-sm ${d.transmit ? 'btn-primary' : 'btn-ghost'}" data-tx="1">Transmission ON</button>
          <button class="btn btn-sm ${!d.transmit ? 'btn-danger' : 'btn-ghost'}" data-tx="0">Transmission OFF</button>
          <button class="btn btn-sm btn-ghost" data-rain="toggle">Simulate rain: ${d.raining ? 'Stop' : 'Start'}</button>
        </div>
        <div style="margin-top:12px;background:#f6f9fb;border:1px solid var(--line);border-radius:10px;padding:14px">
          <div class="toggle-row" style="margin:0 0 10px;align-items:center">
            <span style="font-weight:700;font-size:13px">PM Auto Start/Stop Hysteresis</span>
            <button class="btn btn-sm ${d.sp_enabled ? 'btn-primary' : 'btn-ghost'}" data-sp="on">Enabled</button>
            <button class="btn btn-sm ${!d.sp_enabled ? 'btn-danger' : 'btn-ghost'}" data-sp="off">Disabled</button>
          </div>
          <div class="grid2">
            <div class="fg" style="margin:0"><label>PM2.5 setpoint (µg/m³)</label><input id="spm25" value="${d.sp25}"></div>
            <div class="fg" style="margin:0"><label>PM10 setpoint (µg/m³)</label><input id="spm10" value="${d.sp10}"></div>
          </div>
          <button class="btn btn-sm btn-primary" data-spsave style="margin-top:10px">Save Setpoints</button>
          <div class="hsub" style="text-align:left;margin-top:8px">Hysteresis: Device auto-starts when <b>both</b> PM2.5 &amp; PM10 rise above setpoint, and stops when both fall below (setpoint − 10).</div>
        </div>
        <div class="toggle-row" style="margin-top:12px">
          <button class="btn btn-sm btn-ghost" data-key="${esc(id)}">View API Key</button>
        </div>
      </div>
    `;
  } else if (canEdit) {
    body += `
      <div style="margin-top:18px;border-top:1px solid var(--line);padding-top:14px">
        <div class="toggle-row"><button class="btn btn-sm btn-ghost" data-key="${esc(id)}">View API Key</button></div>
      </div>
    `;
  }

  const bg = openModal('Device — ' + esc(d.device_id), body, () => true, 'Close');
  const kb = bg.querySelector('[data-key]');
  if (kb) {
    kb.onclick = () => {
      bg.remove();
      showKey(id);
    };
  }

  if (isMaaps && canEdit) {
    const send = async (payload) => {
      try {
        const r = await API.post('/devices/' + encodeURIComponent(id) + '/control', payload);
        const i = STATE.devices.findIndex((x) => x.device_id === id);
        if (i >= 0) STATE.devices[i] = r;
        toast('Device settings updated');
        bg.remove();
        deviceDetail(id);
      } catch (err) {
        toast(err.message, true);
      }
    };

    bg.querySelectorAll('[data-pw]').forEach((b) => (b.onclick = () => send({ power: b.dataset.pw })));
    bg.querySelectorAll('[data-tx]').forEach((b) => (b.onclick = () => send({ transmit: b.dataset.tx === '1' })));
    const rb = bg.querySelector('[data-rain]');
    if (rb) rb.onclick = () => send({ raining: !d.raining });
    bg.querySelectorAll('[data-sp]').forEach((b) => (b.onclick = () => send({ sp_enabled: b.dataset.sp === 'on' })));
    const spSave = bg.querySelector('[data-spsave]');
    if (spSave) {
      spSave.onclick = () =>
        send({
          sp_enabled: true,
          sp25: bg.querySelector('#spm25').value,
          sp10: bg.querySelector('#spm10').value
        });
    }
  }
}

async function showKey(id) {
  try {
    const r = await API.get('/devices/' + encodeURIComponent(id) + '/key');
    const backendUrl = window.APP_CONFIG.API_BASE_URL || '/api';
    openModal(
      'Device API Key — ' + esc(id),
      `<p style="color:var(--muted);margin-bottom:14px">This key authenticates the MAAPS hardware when it POSTs telemetry readings. Flash it securely into the device.</p>
       <div class="fg"><label>X-Device-Key</label><input value="${esc(r.api_key)}" readonly onclick="this.select()"></div>
       <div class="fg"><label>Ingestion Endpoint</label><input value="POST ${backendUrl}/ingest" readonly onclick="this.select()"></div>`,
      () => true,
      'Close'
    );
  } catch (err) {
    toast(err.message, true);
  }
}

/* ===== VIEW: LIVE DATA ===== */
function renderData(c) {
  const devs = onlineDevs();
  const bar = el('div', 'card');
  bar.innerHTML = `
    <div class="card-h">
      <h3>Live PM Readings by Device</h3>
      <span class="chip" style="background:#e3f4fa;color:var(--green-l)">Live Telemetry</span>
    </div>
    <canvas id="pmChart" height="110"></canvas>
  `;
  c.appendChild(bar);

  const tc = el('div', 'card');
  tc.innerHTML = '<div class="card-h"><h3>Latest Reported Telemetry</h3></div>';
  const tbl = el('table');
  tbl.innerHTML = `
    <thead>
      <tr>
        <th>Device</th>
        <th>Site</th>
        <th>PM2.5</th>
        <th>PM10</th>
        <th>AQI</th>
        <th>Category</th>
        <th>Last Seen</th>
      </tr>
    </thead>
  `;
  const tb = el('tbody');
  devs.forEach((d) => {
    const a = computeAQI(d.pm25, d.pm10);
    const ca = aqiCat(a);
    const tr = el('tr');
    tr.innerHTML = `
      <td><b>${esc(d.device_id)}</b></td>
      <td>${esc(d.site_name)}</td>
      <td>${d.pm25}</td>
      <td>${d.pm10}</td>
      <td><span class="tag" style="background:${ca.color}22;color:${shade(ca.color, -30)}">${a}</span></td>
      <td>${ca.name}</td>
      <td>${d.last_seen ? new Date(d.last_seen).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
    `;
    tb.appendChild(tr);
  });
  tbl.appendChild(tb);
  tc.appendChild(tbl);
  if (!devs.length) {
    tc.appendChild(el('div', 'empty', 'No online devices currently reporting telemetry.'));
  }
  c.appendChild(tc);

  if (devs.length && window.Chart) {
    chartRef = new Chart($('#pmChart'), {
      type: 'bar',
      data: {
        labels: devs.map((d) => d.device_id),
        datasets: [
          { label: 'PM2.5', data: devs.map((d) => d.pm25), backgroundColor: '#073859', borderRadius: 5 },
          { label: 'PM10', data: devs.map((d) => d.pm10), backgroundColor: '#14adcd', borderRadius: 5 }
        ]
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'top' } },
        scales: { y: { beginAtZero: true, title: { display: true, text: 'µg/m³' } } }
      }
    });
  }
}

/* ===== VIEW: LIVE MAP ===== */
function renderMap(c) {
  const devs = STATE.devices.filter((d) => {
    const s = siteByCode(d.site_code);
    return s && s.lat != null && s.lng != null;
  });
  const online = devs.filter((d) => d.status === 'online').length;

  const bar = el('div', 'card');
  bar.innerHTML = `
    <div class="card-h">
      <h3>MAAPS Ambient Air Monitoring Locations</h3>
      <div class="row" style="gap:8px">
        <span class="chip" style="background:#e3f9ef;color:#009966">
          <span class="dev-status" style="background:#009966"></span>${online} Online
        </span>
        <span class="chip" style="background:#fdecec;color:#cc0033">
          <span class="dev-status" style="background:#cc0033"></span>${devs.length - online} Offline
        </span>
      </div>
    </div>
    <div id="map" style="height:540px;border-radius:12px;overflow:hidden;border:1px solid var(--line)"></div>
  `;
  c.appendChild(bar);

  if (!window.L) return;

  const validCoords = devs.map((d) => {
    const s = siteByCode(d.site_code);
    return [s.lat, s.lng];
  });
  const center = validCoords.length ? validCoords[0] : [28.6139, 77.209];

  mapRef = L.map('map').setView(center, 10);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors · Saaphzone Technologies'
  }).addTo(mapRef);

  devs.forEach((d) => {
    const s = siteByCode(d.site_code);
    const on = d.status === 'online';
    const a = on ? computeAQI(d.pm25, d.pm10) : null;
    const ca = on ? aqiCat(a) : { color: '#8a8a8a', name: 'Offline' };

    const icon = L.divIcon({
      className: 'custom-pin',
      html: `<div style="background:${ca.color};width:34px;height:34px;border-radius:50%;color:#fff;font-weight:800;font-size:12px;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 10px rgba(0,0,0,.35);border:2px solid #fff">${on ? a : '—'}</div>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17]
    });

    const m = L.marker([s.lat, s.lng], { icon }).addTo(mapRef);
    m.bindPopup(`
      <div style="font-family:inherit;min-width:180px">
        <h4 style="margin:0 0 4px;font-size:14px">${esc(d.device_id)}</h4>
        <div style="font-size:12px;color:#555;margin-bottom:8px">${esc(s.name)} · ${esc(d.location || '')}</div>
        <div style="display:flex;justify-content:space-between;margin-bottom:4px">
          <span>AQI:</span> <b style="color:${ca.color}">${on ? a + ' (' + ca.name + ')' : 'Offline'}</b>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:12px">
          <span>PM2.5: ${on ? d.pm25 : '—'}</span>
          <span>PM10: ${on ? d.pm10 : '—'}</span>
        </div>
      </div>
    `);
  });

  if (validCoords.length > 1) {
    mapRef.fitBounds(L.latLngBounds(validCoords).pad(0.2));
  }
}

/* ===== VIEW: USERS (Admin) ===== */
async function renderUsers(c) {
  if (STATE.session.role !== 'admin') {
    c.appendChild(el('div', 'empty', 'Access restricted to Administrator.'));
    return;
  }

  const users = await API.get('/users');
  const card = el('div', 'card');
  card.innerHTML = `
    <div class="card-h">
      <h3>User Management</h3>
      <button class="btn btn-primary btn-sm" id="addUser">+ Add User</button>
    </div>
  `;

  const tbl = el('table');
  tbl.innerHTML = `
    <thead>
      <tr>
        <th>User ID</th>
        <th>Full Name</th>
        <th>Role</th>
        <th>Client / Scope</th>
        <th>Created</th>
        <th>Actions</th>
      </tr>
    </thead>
  `;
  const tb = el('tbody');

  users.forEach((u) => {
    const tr = el('tr');
    tr.innerHTML = `
      <td><b>${esc(u.username)}</b></td>
      <td>${esc(u.name)}</td>
      <td><span class="tag ${u.role === 'admin' ? 'tag-cal' : u.role === 'service' ? 'tag-on' : 'tag-off'}">${u.role}</span></td>
      <td>${esc(u.client || '— all sites —')}</td>
      <td>${u.created_at ? new Date(u.created_at).toLocaleDateString('en-IN') : '—'}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-ghost btn-sm" data-pw="${u.id}">Reset Password</button>
        ${u.username !== 'admin' ? ` <button class="btn btn-danger btn-sm" data-del="${u.id}">Delete</button>` : ''}
      </td>
    `;
    tb.appendChild(tr);

    tr.querySelector('[data-pw]').onclick = () => pwModal(u);
    const del = tr.querySelector('[data-del]');
    if (del) {
      del.onclick = async () => {
        if (confirm(`Delete user "${u.username}"?`)) {
          try {
            await API.del('/users/' + u.id);
            toast('User deleted');
            go('users');
          } catch (err) {
            toast(err.message, true);
          }
        }
      };
    }
  });

  tbl.appendChild(tb);
  card.appendChild(tbl);
  c.appendChild(card);
  $('#addUser').onclick = () => userModal();
}

/* ===== VIEW: AUDIT LOG (Admin) ===== */
async function renderAudit(c) {
  if (STATE.session.role !== 'admin') {
    c.appendChild(el('div', 'empty', 'Access restricted to Administrator.'));
    return;
  }

  const logs = await API.get('/audit');
  const card = el('div', 'card');
  card.innerHTML = '<div class="card-h"><h3>Security Audit Log</h3></div>';

  const tbl = el('table');
  tbl.innerHTML = `
    <thead>
      <tr>
        <th>Actor</th>
        <th>Action</th>
        <th>Details</th>
        <th>IP Address</th>
        <th>Timestamp</th>
      </tr>
    </thead>
  `;
  const tb = el('tbody');

  logs.forEach((log) => {
    const tr = el('tr');
    tr.innerHTML = `
      <td><b>${esc(log.actor || 'System')}</b></td>
      <td><span class="tag tag-cal">${esc(log.action)}</span></td>
      <td><code style="font-size:12px">${esc(log.detail || '—')}</code></td>
      <td>${esc(log.ip || '—')}</td>
      <td>${log.ts ? new Date(log.ts).toLocaleString('en-IN') : '—'}</td>
    `;
    tb.appendChild(tr);
  });

  tbl.appendChild(tb);
  card.appendChild(tbl);
  if (!logs.length) {
    card.appendChild(el('div', 'empty', 'No audit logs recorded yet.'));
  }
  c.appendChild(card);
}

/* ===== MODAL BUILDERS ===== */
function siteModal() {
  const body = `
    <div class="fg"><label>Site Name</label><input id="mSname" placeholder="e.g. Plant-4 Boundary"></div>
    <div class="fg"><label>Client Organisation</label><input id="mSclient" placeholder="e.g. Escorts Kubota Ltd"></div>
    <div class="fg"><label>Project Name</label><input id="mSproject" placeholder="e.g. Ambient Air Network"></div>
    <div class="grid2">
      <div class="fg"><label>Latitude</label><input id="mSlat" placeholder="e.g. 28.41"></div>
      <div class="fg"><label>Longitude</label><input id="mSlng" placeholder="e.g. 77.31"></div>
    </div>
  `;
  openModal('Add Monitoring Site', body, async (bg) => {
    const name = bg.querySelector('#mSname').value.trim();
    const client = bg.querySelector('#mSclient').value.trim();
    const project = bg.querySelector('#mSproject').value.trim();
    const lat = bg.querySelector('#mSlat').value.trim();
    const lng = bg.querySelector('#mSlng').value.trim();

    if (!name || !client) {
      toast('Site name and client are required', true);
      return false;
    }
    try {
      await API.post('/sites', { name, client, project, lat, lng });
      toast('Site created');
      go('sites');
    } catch (err) {
      toast(err.message, true);
      return false;
    }
  }, 'Create Site');
}

function deviceModal(defaultSiteCode) {
  const siteOptions = STATE.sites.map((s) => `<option value="${esc(s.code)}" ${s.code === defaultSiteCode ? 'selected' : ''}>${esc(s.name)} (${esc(s.client)})</option>`).join('');
  const body = `
    <div class="type-switcher">
      <div class="type-opt sel" data-type="maaps">
        <b>MAAPS Device</b>
        <span>Full ambient unit with fan, pressure, rain &amp; control</span>
      </div>
      <div class="type-opt" data-type="basic">
        <b>Basic PM Sensor</b>
        <span>PM2.5 / PM10 optical sensor only</span>
      </div>
    </div>
    <div class="fg"><label>Device ID</label><input id="mId" value="MAAPS-"></div>
    <div class="fg"><label>Site</label><select id="mSite">${siteOptions}</select></div>
    <div class="fg"><label>Location description</label><input id="mLoc" placeholder="e.g. Main Gate Rooftop"></div>
    <div id="maapsFields">
      <div class="grid2">
        <div class="fg"><label>ΔP Monitor threshold (Pa)</label><input id="mDpWarn" value="1200"></div>
        <div class="fg"><label>ΔP Service threshold (Pa)</label><input id="mDpCrit" value="1500"></div>
      </div>
    </div>
  `;
  const bg = openModal('Add Monitoring Device', body, async (modal) => {
    const device_id = modal.querySelector('#mId').value.trim();
    const site_code = modal.querySelector('#mSite').value;
    const location = modal.querySelector('#mLoc').value.trim();
    const dev_type = modal.querySelector('.type-opt.sel').dataset.type;
    const dp_warn = modal.querySelector('#mDpWarn')?.value;
    const dp_crit = modal.querySelector('#mDpCrit')?.value;

    if (!device_id || !site_code) {
      toast('Device ID and Site are required', true);
      return false;
    }
    try {
      const res = await API.post('/devices', { device_id, site_code, location, dev_type, dp_warn, dp_crit });
      toast('Device registered');
      const backendUrl = window.APP_CONFIG.API_BASE_URL || '/api';
      openModal(
        'Device Registered — Flash API Key',
        `<p style="color:var(--muted);margin-bottom:12px">Store this key now — it authenticates ${esc(device_id)} when sending telemetry readings.</p>
         <div class="fg"><label>X-Device-Key</label><input value="${esc(res.api_key)}" readonly onclick="this.select()"></div>
         <div class="fg"><label>Ingestion Endpoint</label><input value="POST ${backendUrl}/ingest" readonly onclick="this.select()"></div>`,
        () => {
          go('devices');
          return true;
        },
        'Done'
      );
    } catch (err) {
      toast(err.message, true);
      return false;
    }
  }, 'Add Device');

  bg.querySelectorAll('.type-opt').forEach((o) => {
    o.onclick = () => {
      bg.querySelectorAll('.type-opt').forEach((x) => x.classList.remove('sel'));
      o.classList.add('sel');
      const t = o.dataset.type;
      bg.querySelector('#maapsFields').style.display = t === 'maaps' ? 'block' : 'none';
      const idf = bg.querySelector('#mId');
      if (t === 'basic' && idf.value.startsWith('MAAPS-')) idf.value = 'BASIC-';
      if (t === 'maaps' && idf.value.startsWith('BASIC-')) idf.value = 'MAAPS-';
    };
  });
}

function userModal() {
  const clients = [...new Set(STATE.sites.map((s) => s.client))];
  const body = `
    <div class="grid2">
      <div class="fg"><label>User ID</label><input id="mUid" placeholder="e.g. heromoto"></div>
      <div class="fg"><label>Full Name</label><input id="mUname" placeholder="e.g. Hero MotoCorp Admin"></div>
    </div>
    <div class="grid2">
      <div class="fg">
        <label>Role</label>
        <select id="mRole" onchange="document.getElementById('clientWrap').style.display=this.value==='client'?'block':'none'">
          <option value="client">Client</option>
          <option value="service">Service</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      <div class="fg"><label>Password (min 8 chars)</label><input id="mUpass" type="password" placeholder="Set password"></div>
    </div>
    <div class="fg" id="clientWrap">
      <label>Client Organisation</label>
      <input id="mUclient" list="clientList" placeholder="e.g. Hero MotoCorp Ltd">
      <datalist id="clientList">${clients.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
    </div>
  `;
  openModal('Add User Account', body, async (bg) => {
    const username = bg.querySelector('#mUid').value.trim();
    const role = bg.querySelector('#mRole').value;
    const password = bg.querySelector('#mUpass').value;
    const name = bg.querySelector('#mUname').value.trim();
    const client = role === 'client' ? bg.querySelector('#mUclient').value.trim() : null;

    if (!username || !password) {
      toast('User ID and password required', true);
      return false;
    }
    if (password.length < 8) {
      toast('Password must be 8+ characters', true);
      return false;
    }
    try {
      await API.post('/users', { username, password, role, name: name || username, client });
      toast('User created');
      go('users');
    } catch (err) {
      toast(err.message, true);
      return false;
    }
  }, 'Create User');
}

function pwModal(u) {
  const body = `
    <p style="color:var(--muted);margin-bottom:14px">Reset password for <b>${esc(u.username)}</b> (${esc(u.name)}).</p>
    <div class="fg"><label>New Password (min 8 characters)</label><input id="mNewPw" type="password" placeholder="Enter new password"></div>
  `;
  openModal('Change Password', body, async (bg) => {
    const p = bg.querySelector('#mNewPw').value;
    if (!p || p.length < 8) {
      toast('Password must be 8+ characters', true);
      return false;
    }
    try {
      await API.post('/users/' + u.id + '/password', { password: p });
      toast('Password updated for ' + u.username);
    } catch (err) {
      toast(err.message, true);
      return false;
    }
  }, 'Update Password');
}

/* ===== CLOCK & BACKGROUND POLL ===== */
setInterval(() => {
  const clockEl = $('#clock');
  if (clockEl) {
    clockEl.textContent = new Date().toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  }
}, 1000);

setInterval(async () => {
  if (STATE.session && STATE.curView !== 'users' && STATE.curView !== 'audit') {
    await refresh();
    // Refresh only data charts if on Live Data view
    if (STATE.curView === 'data' && chartRef) {
      const devs = onlineDevs();
      chartRef.data.labels = devs.map((d) => d.device_id);
      chartRef.data.datasets[0].data = devs.map((d) => d.pm25);
      chartRef.data.datasets[1].data = devs.map((d) => d.pm10);
      chartRef.update();
    }
  }
}, 20000);

/* ===== AUTO-RESTORE ACTIVE SESSION ===== */
(async () => {
  try {
    const me = await API.get('/me');
    if (me && me.role) {
      STATE.session = { username: me.username, role: me.role, name: me.name || me.username, client: me.client };
      $('#gate').style.display = 'none';
      $('#app').classList.add('on');
      buildNav();
      await refresh();
      go('dash');
    }
  } catch (e) {
    // Session not active, show login screen
  }
})();
