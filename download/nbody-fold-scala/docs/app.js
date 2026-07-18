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
  async function createSystem(presetOverride) {
    const preset = presetOverride || document.getElementById('preset').value;
    const dt = parseFloat(document.getElementById('dt').value);
    const softening = parseFloat(document.getElementById('softening').value);
    const name = document.getElementById('sysname').value;
    const P = window.NBodyPhysics;
    let bodies;
    if (preset === 'twoBody')           bodies = P.twoBodyCircular({ m: 1e-3 });
    else if (preset === 'solarSystem')      bodies = P.solarSystem();
    else if (preset === 'figure8')          bodies = P.figure8();
    else if (preset === 'binaryWithPlanet') bodies = P.binaryWithPlanet();
    else if (preset === 'plummer32')        bodies = P.plummerSphere(32, 1);
    else if (preset === 'plummer128')       bodies = P.plummerSphere(128, 1);
    else if (preset === 'lattice27')        bodies = P.lattice(27, 1.0);
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
    return j.id;
  }

  // ── Step system ──────────────────────────────────────────────────────────
  async function stepSystem() {
    const id = parseInt(document.getElementById('step-id').value, 10);
    const steps = parseInt(document.getElementById('step-count').value, 10);
    const sampleEvery = parseInt(document.getElementById('step-sample').value, 10);
    if (!id) { alert('Pick a system id first'); return; }
    // Phase 14: in dynamic mode, open the live stream BEFORE the POST so
    // we receive samples as they're computed server-side.
    if (IS_DYNAMIC) openLiveStream(id);
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
  // Phase 14: 2D/3D toggle. 3D mode uses Viz3D.Renderer with mouse-drag
  // rotation + auto-rotate + perspective projection + star field. 2D mode
  // is the original XY projection (preserved for users who want it).
  // Phase 15: uses /api/systems/:id/trajectories/all (grouped-by-body shape)
  // so every body's path is rendered, not just body 0.
  let _viz3dRenderer = null;
  let _currentTrajectory = [];          // flat array (body 0 only, for 2D + energy chart)
  let _currentTrajectoriesByBody = [];  // Phase 15: [{bodyId, samples}] for multi-body 3D
  let _currentBodies = [];
  let _is3DMode = false;
  let _animationStop = null;

  async function loadTrajectories(id) {
    // Phase 15: try the multi-body endpoint first; fall back to flat if missing.
    let byBody = null;
    try {
      const resAll = await fetch('/api/systems/' + id + '/trajectories/all');
      if (resAll.ok) {
        const jAll = await resAll.json();
        byBody = jAll.byBody || [];
      }
    } catch (_) { /* fall back below */ }

    if (byBody && byBody.length > 0) {
      _currentTrajectoriesByBody = byBody;
      // For backwards-compat with the 2D + energy renderers (which expect a
      // flat array of samples), use body 0's samples as the representative.
      _currentTrajectory = (byBody[0] && byBody[0].samples) || [];
    } else {
      // Legacy fallback: flat array
      const res = await fetch('/api/systems/' + id + '/trajectories');
      const j = await res.json();
      _currentTrajectory = j.trajectories || [];
      _currentTrajectoriesByBody = [{ bodyId: 0, samples: _currentTrajectory }];
    }

    // Also fetch the current body positions for the 3D renderer's "current state" dots
    try {
      const sysRes = await fetch('/api/systems/' + id);
      const sysJ = await sysRes.json();
      _currentBodies = (sysJ.bodies || []).map(b => ({ x: b.x, y: b.y, z: b.z, mass: b.mass }));
    } catch (_) { _currentBodies = []; }
    renderTrajectory(_currentTrajectoriesByBody);
    renderEnergy(_currentTrajectory);
  }

  function renderTrajectory(rows) {
    if (_is3DMode) {
      renderTrajectory3D(rows);
    } else {
      renderTrajectory2D(rows);
    }
  }

  function renderTrajectory2D(input) {
    // Stop any 3D animation loop
    if (_animationStop) { _animationStop(); _animationStop = null; }
    const c = document.getElementById('traj-canvas');
    const ctx = c.getContext('2d');
    // Phase 14: pure black background per user feedback
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, c.width, c.height);

    // Phase 15: accept either flat array (single body) or grouped-by-body.
    // Normalize to [{bodyId, samples}] for multi-body color-coding.
    let byBody;
    if (Array.isArray(input) && input.length > 0 && Array.isArray(input[0].samples)) {
      byBody = input;
    } else {
      byBody = [{ bodyId: 0, samples: Array.isArray(input) ? input : [] }];
    }

    // Auto-scale to fit ALL bodies' bounding box (so all trails are visible)
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let hasAny = false;
    for (const g of byBody) {
      for (const r of g.samples) {
        if (r.x < minX) minX = r.x; if (r.x > maxX) maxX = r.x;
        if (r.y < minY) minY = r.y; if (r.y > maxY) maxY = r.y;
        hasAny = true;
      }
    }
    if (!hasAny) return;
    const rangeX = Math.max(1e-9, maxX - minX);
    const rangeY = Math.max(1e-9, maxY - minY);
    const pad = 20;
    const sx = (c.width - 2 * pad) / rangeX;
    const sy = (c.height - 2 * pad) / rangeY;
    const s = Math.min(sx, sy);
    const ox = pad - minX * s + (c.width - 2 * pad - rangeX * s) / 2;
    const oy = pad + maxY * s + (c.height - 2 * pad - rangeY * s) / 2;

    // Draw each body's trajectory in its own color (matching the 3D engine's wheel)
    for (const g of byBody) {
      const rows = g.samples;
      if (rows.length < 1) continue;
      const hue = (g.bodyId * 137.508) % 360;
      ctx.strokeStyle = 'hsl(' + hue + ',80%,60%)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < rows.length; i++) {
        const px = rows[i].x * s + ox;
        const py = oy - rows[i].y * s;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
      // Mark current position with a glowing dot
      const last = rows[rows.length - 1];
      const px = last.x * s + ox;
      const py = oy - last.y * s;
      const grad = ctx.createRadialGradient(px, py, 0, px, py, 8);
      grad.addColorStop(0, 'hsla(' + hue + ',80%,60%,0.9)');
      grad.addColorStop(1, 'hsla(' + hue + ',80%,60%,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(px, py, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(px, py, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function renderTrajectory3D(input) {
    const c = document.getElementById('traj-canvas');
    if (!_viz3dRenderer) {
      _viz3dRenderer = new window.Viz3D.Renderer(c);
    }
    _viz3dRenderer.setTrajectory(input || _currentTrajectoriesByBody);
    _viz3dRenderer.setBodies(_currentBodies);
    _viz3dRenderer.setAutoRotate(true);
    // Start the animation loop (returns a stop function)
    if (!_animationStop) {
      _animationStop = _viz3dRenderer.startAnimationLoop();
    }
  }

  function setVizMode(mode3D) {
    _is3DMode = !!mode3D;
    document.getElementById('viz-2d').classList.toggle('active', !_is3DMode);
    document.getElementById('viz-3d').classList.toggle('active',  _is3DMode);
    document.getElementById('viz-hint').textContent = _is3DMode
      ? '3D perspective view. Drag to rotate · wheel to zoom · auto-rotates when idle. URL hash stores camera angle (shareable).'
      : '2D projection (XY plane). Click 3D for a rotatable perspective view.';
    // Re-render with the new mode using the current data
    if (_currentTrajectoriesByBody.length > 0 || _currentBodies.length > 0) {
      renderTrajectory(_currentTrajectoriesByBody);
    } else {
      // Empty render just to flip the canvas to the right bg
      renderTrajectory([]);
    }
  }

  function renderEnergy(rows) {
    const c = document.getElementById('energy-canvas');
    const ctx = c.getContext('2d');
    // Phase 14: pure black
    ctx.fillStyle = '#000000';
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

  // ── WebSocket live streaming (Phase 14) ─────────────────────────────────
  // When the user clicks "Run", in DYNAMIC mode we ALSO open a WebSocket to
  // /api/systems/:id/stream so we can render trajectory samples live as the
  // integrator computes them (instead of waiting for the full POST /step to
  // finish).
  let _ws = null;
  function openLiveStream(id) {
    if (!IS_DYNAMIC) return;  // static mode has no server to stream from
    if (!window.WebSocket) return;
    if (_ws) { try { _ws.close(); } catch (_) {} _ws = null; }
    const wsUrl = DYNAMIC_BACKEND.replace(/^http/, 'ws') + '/api/systems/' + id + '/stream';
    try {
      _ws = new WebSocket(wsUrl);
      _ws.onopen = () => appendAuditLog({ method: 'WS', path: '/api/systems/' + id + '/stream', status: 101, ms: 0, meta: 'connected' });
      _ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'sample' && msg.samples) {
            // Phase 15: msg.samples is an array of {bodyId, x,y,z,vx,vy,vz}.
            // Append each body's sample to its trajectory in _currentTrajectoriesByBody.
            for (const s of msg.samples) {
              let group = _currentTrajectoriesByBody.find(g => g.bodyId === s.bodyId);
              if (!group) {
                group = { bodyId: s.bodyId, samples: [] };
                _currentTrajectoriesByBody.push(group);
              }
              group.samples.push({
                step: msg.step,
                x: s.x, y: s.y, z: s.z,
                vx: s.vx, vy: s.vy, vz: s.vz,
                energy: msg.energy
              });
              if (group.samples.length > 500) group.samples.shift();
            }
            // Body 0's trajectory is used as the representative for the energy chart
            _currentTrajectory = _currentTrajectoriesByBody[0]
              ? _currentTrajectoriesByBody[0].samples : [];
            renderTrajectory(_currentTrajectoriesByBody);
            renderEnergy(_currentTrajectory);
          } else if (msg.type === 'start') {
            // Clear stale trajectory state when a new step run begins
            _currentTrajectoriesByBody = [];
            _currentTrajectory = [];
          } else if (msg.type === 'done') {
            appendAuditLog({ method: 'WS', path: '/api/systems/' + id + '/stream', status: 200, ms: 0,
                             meta: 'done drift=' + (msg.drift || 0).toExponential(3) });
          }
        } catch (_) {}
      };
      _ws.onerror = () => appendAuditLog({ method: 'WS', path: '/api/systems/' + id + '/stream', status: 0, ms: 0, meta: 'error' });
      _ws.onclose = () => { _ws = null; };
    } catch (e) {
      appendAuditLog({ method: 'WS', path: '/api/systems/' + id + '/stream', status: 0, ms: 0, meta: 'open_failed' });
    }
  }

  // ── Phase 15: Scenario library ──────────────────────────────────────────
  // One-click presets: create system + run 300 steps + load + switch to 3D.
  // Scenario-specific step counts + sample intervals tuned per scenario.
  const SCENARIO_PARAMS = {
    solarSystem:      { name: 'solar-system',     dt: 0.005, softening: 0.001, steps: 1500, sampleEvery: 10 },
    figure8:          { name: 'figure-8',         dt: 0.001, softening: 0.0,   steps: 6326, sampleEvery: 20 },  // T ≈ 6.3259
    binaryWithPlanet: { name: 'binary-planet',    dt: 0.005, softening: 0.001, steps: 2000, sampleEvery: 10 },
    twoBody:          { name: 'two-body',         dt: 0.01,  softening: 0.001, steps: 500,  sampleEvery: 5  },
    plummer32:        { name: 'plummer-32',       dt: 0.01,  softening: 0.05,  steps: 500,  sampleEvery: 10 },
    lattice27:        { name: 'lattice-27',       dt: 0.01,  softening: 0.05,  steps: 300,  sampleEvery: 10 }
  };

  async function runScenario(scenarioKey) {
    const params = SCENARIO_PARAMS[scenarioKey];
    if (!params) return;
    // Set the button into "running" state to give visual feedback
    const btn = document.querySelector('.scenario-btn[data-scenario="' + scenarioKey + '"]');
    if (btn) btn.classList.add('running');
    // Update the IC form to match (so the user sees what ran)
    document.getElementById('preset').value = scenarioKey;
    document.getElementById('dt').value = params.dt;
    document.getElementById('softening').value = params.softening;
    document.getElementById('sysname').value = params.name;
    document.getElementById('step-count').value = params.steps;
    document.getElementById('step-sample').value = params.sampleEvery;
    try {
      const id = await createSystem(scenarioKey);
      if (!id) throw new Error('create failed');
      // Open live stream BEFORE step (dynamic mode only) so samples arrive in real time
      if (IS_DYNAMIC) openLiveStream(id);
      // Auto-switch to 3D for scenarios that benefit from depth (all except twoBody)
      setVizMode(scenarioKey !== 'twoBody');
      // Run the integrator
      const res = await fetch('/api/systems/' + id + '/step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': 'demo' },
        body: JSON.stringify({ steps: params.steps, sampleEvery: params.sampleEvery })
      });
      const j = await res.json();
      if (j.drift !== undefined) {
        appendAuditLog({ method: 'POST', path: '/api/systems/' + id + '/step', status: 200, ms: 0,
                         meta: 'drift=' + j.drift.toExponential(3) + ' (' + scenarioKey + ')' });
      }
      refreshSystems();
      await loadTrajectories(id);
    } catch (e) {
      appendAuditLog({ method: 'SCENARIO', path: '/' + scenarioKey, status: 0, ms: 0,
                       meta: 'error: ' + e.message });
    } finally {
      if (btn) btn.classList.remove('running');
    }
  }

  // ── Wire up ──────────────────────────────────────────────────────────────
  document.getElementById('create').addEventListener('click', () => createSystem());
  document.getElementById('step-run').addEventListener('click', stepSystem);
  document.getElementById('refresh').addEventListener('click', refreshSystems);
  document.getElementById('viz-2d').addEventListener('click', () => setVizMode(false));
  document.getElementById('viz-3d').addEventListener('click', () => setVizMode(true));
  document.getElementById('viz-reset').addEventListener('click', () => {
    if (_viz3dRenderer) {
      _viz3dRenderer.resetCamera();
      appendAuditLog({ method: 'UI', path: '/viz/reset', status: 200, ms: 0, meta: 'camera reset' });
    }
  });
  document.getElementById('viz-share').addEventListener('click', async () => {
    try {
      const url = window.location.href;  // includes the #cam= hash
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
        appendAuditLog({ method: 'UI', path: '/viz/share', status: 200, ms: 0, meta: 'link copied' });
      } else {
        // Fallback: select the URL bar
        const ta = document.createElement('textarea');
        ta.value = url; document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); document.body.removeChild(ta);
        appendAuditLog({ method: 'UI', path: '/viz/share', status: 200, ms: 0, meta: 'link copied (fallback)' });
      }
    } catch (e) {
      appendAuditLog({ method: 'UI', path: '/viz/share', status: 0, ms: 0, meta: 'failed: ' + e.message });
    }
  });
  document.querySelectorAll('.scenario-btn').forEach(btn => {
    btn.addEventListener('click', () => runScenario(btn.dataset.scenario));
  });

  // Initial state
  refreshSystems();
  startHealthPoll();
  // Initial empty canvas paint so the canvas doesn't show the browser default
  renderTrajectory([]);

  // ── Phase 15: auto-run on first load ─────────────────────────────────────
  // The user explicitly asked to be able to "click on it and observe the
  // changes" — so on first page load we auto-run the Figure-8 scenario,
  // which is the most visually striking (three equal masses chasing each
  // other around the figure-8 curve). Skip auto-run if URL has ?noAuto=1
  // (useful for benchmarks / CI).
  const noAuto = urlParams.get('noAuto') === '1';
  if (!noAuto) {
    // Wait briefly so the health poll fires first + the UI is settled
    setTimeout(() => { runScenario('figure8'); }, 600);
  }
})();
