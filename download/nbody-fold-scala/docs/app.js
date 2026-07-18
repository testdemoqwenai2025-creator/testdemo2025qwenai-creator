// ============================================================================
// app.js — DOM wiring, fetch shim, LIVE backend health checker, canvas
// ============================================================================
// Phase 12+13 deliverable (static GitHub Pages demo with dynamic backend
// support).
//
// Mode detection (Phase 13):
//   - If URL contains ?backend=<URL>  → DYNAMIC MODE: fetch shim forwards
//     every /api/* call to <URL>/api/* via real fetch(). The header badge
//     pings <URL>/api/health every 5s and shows UP/DOWN + latency + version
//     + region + uptimeSec + requestCount.
//   - Otherwise → STATIC MODE: fetch shim routes through in-page middleware
//     chain → IndexedDB. The header badge shows "DEMO MODE (in-browser)"
//     with no health pings (no server to ping).
// ============================================================================

(function () {
  'use strict';

  const MW = window.NBodyMiddleware;
  const R  = window.NBodyRoutes;

  // ── Mode detection ───────────────────────────────────────────────────────
  const urlParams = new URLSearchParams(window.location.search);
  const DYNAMIC_BACKEND = (urlParams.get('backend') || '').replace(/\/+$/, '');
  const IS_DYNAMIC = DYNAMIC_BACKEND.length > 0;

  document.getElementById('backend-url').textContent =
    IS_DYNAMIC ? DYNAMIC_BACKEND : '(in-page IndexedDB)';
  document.getElementById('mode-label').textContent =
    IS_DYNAMIC ? 'DYNAMIC' : 'STATIC';

  // ── Build the in-page middleware chain (only used in STATIC mode) ────────
  let _chain = null;
  async function ensureChain() {
    if (_chain) return _chain;
    await window.NBodyDB.open();
    const routes = R.makeRoutes(window.NBodyDB, {
      version: '1.0.0-static',
      region:  'browser',
      startedAt: window.NBodyDB._startedAt || Date.now()
    });
    window.NBodyDB._startedAt = window.NBodyDB._startedAt || Date.now();
    const auditSink = async (row) => {
      await window.NBodyDB.insertAudit(row);
      appendAuditLog(row);
    };
    _chain = MW.buildChain(routes, { auditSink });
    return _chain;
  }

  // ── fetch() shim — intercepts /api/* calls ──────────────────────────────
  // In DYNAMIC mode: forward to the real backend via _origFetch.
  // In STATIC mode: route through the in-page middleware chain.
  const _origFetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const url = (typeof input === 'string') ? input : input.url;
    const method = (init && init.method) || (input && input.method) || 'GET';

    // Only intercept /api/* (everything else falls through)
    if (!url || !url.startsWith('/api/')) {
      return _origFetch(input, init);
    }

    if (IS_DYNAMIC) {
      // DYNAMIC MODE — forward to real backend
      const targetUrl = DYNAMIC_BACKEND + url;
      const headers = {};
      if (init && init.headers) {
        if (init.headers instanceof Headers) {
          init.headers.forEach((v, k) => { headers[k] = v; });
        } else {
          Object.assign(headers, init.headers);
        }
      }
      // Ensure X-Api-Key is set (demo key for the public deployment)
      if (!headers['X-Api-Key'] && !headers['x-api-key']) {
        headers['X-Api-Key'] = window.NBODY_API_KEY || 'demo';
      }
      const t0 = performance.now();
      try {
        const res = await _origFetch(targetUrl, { ...init, headers });
        const ms = Math.round(performance.now() - t0);
        appendAuditLog({ method, path: url, status: res.status, ms, meta: '(dynamic)' });
        return res;
      } catch (e) {
        appendAuditLog({ method, path: url, status: 0, ms: 0, meta: 'network_error: ' + e.message });
        throw e;
      }
    }

    // STATIC MODE — route through the in-page chain
    const chain = await ensureChain();
    const body = (init && init.body) || null;
    const headers = {};
    if (init && init.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((v, k) => { headers[k] = v; });
      } else {
        Object.assign(headers, init.headers);
      }
    }
    const req = MW.makeRequest(method, url, headers, body);
    const res = await chain(req);
    return new Response(res.body, {
      status: res.status,
      headers: res.headers
    });
  };

  // ── LIVE BACKEND HEALTH CHECKER (Phase 13) ───────────────────────────────
  //
  // The user pointed out that a static CI badge image (which just shows
  // "tests passed X minutes ago") is much less useful than a LIVE indicator
  // that pings /api/health and shows whether the backend is up RIGHT NOW.
  //
  // - DYNAMIC MODE: ping <backend>/api/health every 5s, show UP/DOWN with
  //   latency, version, region, uptime, request count.
  // - STATIC MODE: show "DEMO MODE (in-browser)" — no health pings needed
  //   because there's no server. But we still poll /api/health through the
  //   in-page chain to keep the count accurate.
  const HEALTH_POLL_MS = 5000;
  const badge = document.getElementById('health-badge');
  const badgeLabel = badge.querySelector('.label');
  const badgeMeta  = badge.querySelector('.meta');

  function setBadge(state, label, meta) {
    badge.className = 'health-badge ' + state;
    badgeLabel.textContent = label;
    badgeMeta.textContent  = meta || '';
  }

  async function pingHealth() {
    const t0 = performance.now();
    try {
      const res = await _origFetch('/api/health', {
        headers: { 'X-Api-Key': window.NBODY_API_KEY || 'demo' }
      });
      const ms = Math.round(performance.now() - t0);
      if (!res.ok) {
        setBadge('down', 'DOWN · HTTP ' + res.status, ms + 'ms');
        return;
      }
      const j = await res.json();
      if (IS_DYNAMIC) {
        setBadge('up',
          'UP · ' + ms + 'ms',
          'v' + j.version + ' · ' + j.region + ' · up ' + j.uptimeSec + 's · req#' + j.requestCount
        );
      } else {
        setBadge('demo',
          'DEMO MODE (in-browser)',
          'N=' + (j.systems || 0) + ' systems · req#' + j.requestCount
        );
      }
    } catch (e) {
      if (IS_DYNAMIC) {
        setBadge('down', 'DOWN · unreachable', '');
      } else {
        setBadge('down', 'STATIC INIT FAILED', e.message);
      }
    }
  }

  async function startHealthPoll() {
    // In STATIC mode, ensure the chain is initialized first
    if (!IS_DYNAMIC) {
      try { await ensureChain(); } catch (e) { /* surfaced by ping */ }
    }
    pingHealth();
    setInterval(pingHealth, HEALTH_POLL_MS);
  }

  // ── Audit log panel ──────────────────────────────────────────────────────
  const auditEl = document.getElementById('audit-log');
  const auditLines = [];
  function appendAuditLog(row) {
    const ts = new Date().toISOString().slice(11, 23);
    const meta = row.meta ? ' ' + row.meta : '';
    auditLines.unshift(
      ts + '  ' + (row.method || '?').padEnd(6) + ' ' +
      String(row.status).padEnd(4) + ' ' + (row.ms || 0) + 'ms  ' +
      (row.path || '?') + meta
    );
    if (auditLines.length > 200) auditLines.length = 200;
    auditEl.textContent = auditLines.join('\n');
  }

  // ── System list ──────────────────────────────────────────────────────────
  async function refreshSystems() {
    try {
      const res = await fetch('/api/systems');
      const j = await res.json();
      const tbody = document.querySelector('#systems-table tbody');
      tbody.innerHTML = '';
      for (const s of (j.systems || [])) {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td>' + s.id + '</td>' +
                       '<td>' + escapeHtml(s.name) + '</td>' +
                       '<td>' + s.bodies + '</td>' +
                       '<td>' + s.steps + '</td>' +
                       '<td>—</td>' +
                       '<td><button data-id="' + s.id + '" class="load">load</button> ' +
                       '<button data-id="' + s.id + '" class="delete">delete</button></td>';
        tbody.appendChild(tr);
      }
      tbody.querySelectorAll('button.load').forEach(b => {
        b.addEventListener('click', () => {
          document.getElementById('step-id').value = b.dataset.id;
          loadTrajectories(parseInt(b.dataset.id, 10));
        });
      });
      tbody.querySelectorAll('button.delete').forEach(b => {
        b.addEventListener('click', async () => {
          await fetch('/api/systems/' + b.dataset.id, { method: 'DELETE' });
          refreshSystems();
        });
      });
    } catch (e) {
      appendAuditLog({ method: 'GET', path: '/api/systems', status: 0, ms: 0, meta: 'error: ' + e.message });
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // ── Create system ────────────────────────────────────────────────────────
  async function createSystem() {
    const preset = document.getElementById('preset').value;
    const dt = parseFloat(document.getElementById('dt').value);
    const softening = parseFloat(document.getElementById('softening').value);
    const name = document.getElementById('sysname').value;
    const P = window.NBodyPhysics;
    let bodies;
    if (preset === 'twoBody')      bodies = P.twoBodyCircular({ m: 1e-3 });
    else if (preset === 'plummer32')  bodies = P.plummerSphere(32, 1);
    else if (preset === 'plummer128') bodies = P.plummerSphere(128, 1);
    else if (preset === 'lattice27')  bodies = P.lattice(27, 1.0);
    else bodies = P.twoBodyCircular();
    const res = await fetch('/api/systems', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': 'demo' },
      body: JSON.stringify({ name, dt, softening, bodies })
    });
    const j = await res.json();
    if (j.id) {
      document.getElementById('step-id').value = j.id;
      refreshSystems();
    } else {
      alert('Create failed: ' + JSON.stringify(j));
    }
  }

  // ── Step system ──────────────────────────────────────────────────────────
  async function stepSystem() {
    const id = parseInt(document.getElementById('step-id').value, 10);
    const steps = parseInt(document.getElementById('step-count').value, 10);
    const sampleEvery = parseInt(document.getElementById('step-sample').value, 10);
    if (!id) { alert('Pick a system id first'); return; }
    const res = await fetch('/api/systems/' + id + '/step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': 'demo' },
      body: JSON.stringify({ steps, sampleEvery })
    });
    const j = await res.json();
    if (j.drift !== undefined) {
      appendAuditLog({ method: 'POST', path: '/api/systems/' + id + '/step', status: 200, ms: 0,
                       meta: 'drift=' + j.drift.toExponential(3) });
    }
    refreshSystems();
    loadTrajectories(id);
  }

  // ── Load trajectories + render canvas ───────────────────────────────────
  async function loadTrajectories(id) {
    const res = await fetch('/api/systems/' + id + '/trajectories');
    const j = await res.json();
    renderTrajectory(j.trajectories || []);
    renderEnergy(j.trajectories || []);
  }

  function renderTrajectory(rows) {
    const c = document.getElementById('traj-canvas');
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#010409';
    ctx.fillRect(0, 0, c.width, c.height);
    if (rows.length === 0) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const r of rows) {
      if (r.x < minX) minX = r.x; if (r.x > maxX) maxX = r.x;
      if (r.y < minY) minY = r.y; if (r.y > maxY) maxY = r.y;
    }
    const rangeX = Math.max(1e-9, maxX - minX);
    const rangeY = Math.max(1e-9, maxY - minY);
    const pad = 20;
    const sx = (c.width - 2 * pad) / rangeX;
    const sy = (c.height - 2 * pad) / rangeY;
    const s = Math.min(sx, sy);
    const ox = pad - minX * s + (c.width - 2 * pad - rangeX * s) / 2;
    const oy = pad + maxY * s + (c.height - 2 * pad - rangeY * s) / 2;
    ctx.strokeStyle = '#58a6ff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < rows.length; i++) {
      const px = rows[i].x * s + ox;
      const py = oy - rows[i].y * s;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
    // Mark start/end
    ctx.fillStyle = '#3fb950';
    const f = rows[0];
    ctx.beginPath();
    ctx.arc(f.x * s + ox, oy - f.y * s, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f85149';
    const l = rows[rows.length - 1];
    ctx.beginPath();
    ctx.arc(l.x * s + ox, oy - l.y * s, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  function renderEnergy(rows) {
    const c = document.getElementById('energy-canvas');
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#010409';
    ctx.fillRect(0, 0, c.width, c.height);
    if (rows.length < 2) return;
    let e0 = rows[0].energy;
    const drifts = rows.map(r => e0 === 0 ? Math.abs(r.energy) : Math.abs(r.energy - e0) / Math.abs(e0));
    const maxD = Math.max(1e-12, ...drifts);
    const pad = 16;
    ctx.strokeStyle = '#d29922';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < drifts.length; i++) {
      const px = pad + (i / (drifts.length - 1)) * (c.width - 2 * pad);
      const py = c.height - pad - (Math.log10(Math.max(1e-15, drifts[i])) / Math.log10(maxD)) * (c.height - 2 * pad);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
    // Label
    ctx.fillStyle = '#8b949e';
    ctx.font = '11px monospace';
    ctx.fillText('log10(rel drift)  max=' + maxD.toExponential(2), pad, 14);
  }

  // ── Wire up ──────────────────────────────────────────────────────────────
  document.getElementById('create').addEventListener('click', createSystem);
  document.getElementById('step-run').addEventListener('click', stepSystem);
  document.getElementById('refresh').addEventListener('click', refreshSystems);

  // Initial state
  refreshSystems();
  startHealthPoll();
})();
