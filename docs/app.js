/* ============================================================================
 * app.js — Frontend wiring for the nbody-fold-scala static demo
 * ============================================================================
 * Wires the DOM elements in index.html to the route handlers in routes.js
 * via window.fetch() — but with a shim that intercepts /api/* calls and
 * routes them through the middleware chain → dispatcher → IndexedDB.
 *
 * This proves the full-stack round-trip:
 *
 *   UI button click
 *     → fetch('/api/...', { method, body })
 *       → fetch shim
 *         → middleware chain (error → log → auth → json → cors → dispatch)
 *           → route handler
 *             → IndexedDB store (DB tier)
 *           ← row(s) inserted/queried
 *         ← synthetic Response
 *       ← parsed JSON
 *     → render canvas / health stats / audit log
 *
 * Every step is observable in the Audit Log panel — exactly as it would be
 * against the real Scala/Next.js backend.
 * ========================================================================== */

// ── fetch() shim ───────────────────────────────────────────────────────────
// Intercept /api/* calls and route them through one of two paths:
//
//   1. DYNAMIC MODE (?backend=https://...): forward to a real remote backend
//      (e.g. Vercel-hosted Next.js + Neon Postgres). Cross-user persistence.
//
//   2. STATIC MODE (default): route through the in-page middleware chain →
//      IndexedDB. Single-user, browser-local persistence.
//
// The mode is selected by the ?backend=<URL> query param. The same static
// page works identically in both modes — only the data tier changes.
const DYNAMIC_BACKEND = new URLSearchParams(window.location.search).get('backend');
const IS_DYNAMIC_MODE = !!DYNAMIC_BACKEND;

const _originalFetch = window.fetch;
window.fetch = async function (input, init = {}) {
  const url = typeof input === 'string' ? input : input.url;
  const method = (init.method || 'GET').toUpperCase();
  const headers = {};
  if (init.headers) {
    if (init.headers instanceof Headers) {
      init.headers.forEach((v, k) => headers[k] = v);
    } else if (Array.isArray(init.headers)) {
      for (const [k, v] of init.headers) headers[k] = v;
    } else {
      Object.assign(headers, init.headers);
    }
  }

  // Only intercept /api/* — let everything else (static assets) hit the network
  if (!url.startsWith('/api/')) {
    return _originalFetch.call(window, input, init);
  }

  // ── Dynamic mode: forward to the real backend ─────────────────────────
  if (IS_DYNAMIC_MODE) {
    // Rewrite "/api/..." → "<backend>/api/..."
    let fullUrl;
    if (url.startsWith('http://') || url.startsWith('https://')) {
      fullUrl = url;  // already absolute
    } else {
      const base = DYNAMIC_BACKEND.replace(/\/+$/, '');
      fullUrl = base + (url.startsWith('/') ? url : '/' + url);
    }
    // Use the original fetch — hits the real network
    const res = await _originalFetch.call(window, fullUrl, init);
    // Emit a synthetic audit event so the UI panel still shows the request
    const ts = Date.now();
    const startMs = performance.now();
    window.dispatchEvent(new CustomEvent('nbody:audit', {
      detail: {
        ts,
        method,
        path: url.split('?')[0],
        status: res.status,
        latencyMs: Math.round(performance.now() - startMs),
        ipHash: 'remote',
        apiKey: headers['x-api-key'] ? '****' + (headers['x-api-key'] || '').slice(-4) : '',
      }
    }));
    return res;
  }

  // ── Static mode: in-page middleware chain → IndexedDB ─────────────────
  const req = window.NBodyMW.makeRequest(method, url, init.body || null, headers);
  const res = await window.NBodyRoutes.fullChain(req);

  // Return a fetch-compatible Response object
  return {
    ok: res.ok,
    status: res.status,
    headers: new Map(Object.entries(res.headers)),
    async json() { return JSON.parse(res.body); },
    async text() { return res.body; },
  };
};

// ── DOM helpers ────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const log = (msg, cls) => {
  const el = $('log');
  const d = document.createElement('div');
  d.className = 'entry ' + (cls || '');
  d.innerHTML = `<span class="ts">${new Date().toISOString().substr(11, 8)}</span><span class="path">${escapeHtml(msg)}</span>`;
  el.insertBefore(d, el.firstChild);
  while (el.children.length > 80) el.removeChild(el.lastChild);
};
const show = (id, txt) => { $(id).textContent = txt; };
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
}[c]));

function showResp(obj) {
  $('resp').textContent = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
}

// ── Audit panel: listen for middleware-emitted events ─────────────────────
window.addEventListener('nbody:audit', (ev) => {
  const { ts, method, path, status, latencyMs, ipHash, apiKey } = ev.detail;
  const cls = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'ok';
  const el = $('log');
  const d = document.createElement('div');
  d.className = 'entry ' + cls;
  d.innerHTML =
    `<span class="ts">${new Date(ts).toISOString().substr(11, 8)}</span>` +
    `<span class="method">${method}</span>` +
    `<span class="path">${escapeHtml(path)}</span>` +
    `<span class="status">${status}</span>` +
    `<span class="latency">${latencyMs}ms</span>` +
    `<span class="ip">${ipHash.substr(0, 8)}</span>` +
    (apiKey ? `<span class="key">${escapeHtml(apiKey)}</span>` : '');
  el.insertBefore(d, el.firstChild);
  while (el.children.length > 80) el.removeChild(el.lastChild);
});

// ── Health polling ─────────────────────────────────────────────────────────
async function pollHealth() {
  try {
    const r = await fetch('/api/health', { method: 'GET' });
    const j = await r.json();
    show('uptime', j.uptimeSec + 's');
    show('sys-count', j.systems);
    show('body-count', j.bodies);
    show('snap-count', j.snapshots);
    show('audit-count', j.auditRows);
    show('mw-chain', j.middlewareChain.length + ' layers');
  } catch (e) {
    log('health poll failed: ' + e.message, 'error');
  }
}
setInterval(pollHealth, 4000);

// ── Generator → bodies JSON sync ───────────────────────────────────────────
function regenerateBodies() {
  const gen = $('generator').value;
  if (gen === 'custom') return;
  const n = parseInt($('n').value, 10) || 8;
  const seed = parseInt($('seed').value, 10) || 0;
  try {
    const bodies = window.NBodyPhysics.generateInitialConditions(gen, n, seed);
    // Render in the same shape the textarea expects
    const normalized = bodies.map(b => ({
      mass: b.mass,
      pos: b.pos.map(v => Math.round(v * 1000) / 1000),
      vel: b.vel.map(v => Math.round(v * 1000) / 1000),
    }));
    $('bodies').value = JSON.stringify(normalized, null, 2);
    log(`regenerated ${normalized.length} bodies via ${gen} (seed=${seed})`, 'ok');
  } catch (e) {
    log('regenerate failed: ' + e.message, 'error');
  }
}

// ── Create system ──────────────────────────────────────────────────────────
async function createSystem() {
  const name = $('name').value.trim();
  const dt = parseFloat($('dt').value);
  const softening = parseFloat($('softening').value);
  const generator = $('generator').value;
  const n = parseInt($('n').value, 10);
  const seed = parseInt($('seed').value, 10);
  let bodies;
  try {
    bodies = JSON.parse($('bodies').value);
  } catch (e) {
    showResp({ error: 'Invalid JSON in Bodies textarea', message: e.message });
    log('create failed: invalid JSON', 'error');
    return;
  }
  const apiKey = $('apikey').value;
  const r = await fetch('/api/simulations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({ name, dt, softening, bodies, generator, n, seed }),
  });
  const j = await r.json();
  showResp(j);
  if (r.status === 201) {
    $('sysid').value = j.id;
    log(`created system id=${j.id} bodies=${j.bodies} E0=${j.energy0.toExponential(4)}`, 'ok');
    await pollHealth();
    await renderTrajectory(j.id);
  } else {
    log(`create failed: ${r.status} ${j.error || ''}`, 'error');
  }
}

// ── Step simulation ────────────────────────────────────────────────────────
async function stepSystem() {
  const id = $('sysid').value;
  const steps = parseInt($('steps').value, 10);
  const sample = parseInt($('sample').value, 10);
  const apiKey = $('apikey').value;
  const r = await fetch(`/api/simulations/${id}/step`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({ steps, sampleEvery: sample }),
  });
  const j = await r.json();
  showResp(j);
  if (r.status === 200) {
    log(`stepped id=${id} → step=${j.step} drift=${j.drift.toExponential(4)}`, 'ok');
    await pollHealth();
    await renderTrajectory(id);
  } else {
    log(`step failed: ${r.status} ${j.error || ''}`, 'error');
  }
}

// ── Delete system ──────────────────────────────────────────────────────────
async function deleteSystem() {
  const id = $('sysid').value;
  const apiKey = $('apikey').value;
  const r = await fetch(`/api/simulations/${id}`, {
    method: 'DELETE',
    headers: { 'x-api-key': apiKey },
  });
  const j = await r.json();
  showResp(j);
  if (r.status === 200) {
    log(`deleted id=${id} (bodies=${j.bodiesRemoved} snaps=${j.snapshotsRemoved})`, 'ok');
    await pollHealth();
    clearCanvases();
  } else {
    log(`delete failed: ${r.status} ${j.error || ''}`, 'error');
  }
}

// ── Render trajectory + energy charts ──────────────────────────────────────
async function renderTrajectory(id) {
  const r = await fetch(`/api/simulations/${id}/snapshots`, { method: 'GET' });
  const j = await r.json();
  if (!j.snapshots || j.snapshots.length === 0) {
    log(`no snapshots for id=${id}`, 'warn');
    return;
  }
  drawTrajectory(j.snapshots);
  drawEnergy(j.snapshots);
  log(`rendered ${j.snapshots.length} snapshots for id=${id}`, 'ok');
}

function clearCanvases() {
  for (const id of ['traj-canvas', 'energy-canvas']) {
    const c = $(id);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#0b1021';
    ctx.fillRect(0, 0, c.width, c.height);
  }
}

function drawTrajectory(snaps) {
  const c = $('traj-canvas');
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0b1021';
  ctx.fillRect(0, 0, c.width, c.height);

  // Auto-scale across all bodies in all snapshots
  let max = 1.0;
  for (const s of snaps) {
    for (const p of s.positions) {
      max = Math.max(max, Math.abs(p[0]), Math.abs(p[1]));
    }
  }
  const scale = (c.width / 2 - 30) / max;
  const cx = c.width / 2, cy = c.height / 2;

  // Axes
  ctx.strokeStyle = '#2c3a6b';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(c.width, cy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, c.height); ctx.stroke();

  // Draw each body's trajectory as a separate colored line
  const palette = ['#3b5bdb', '#51cf66', '#ff6b6b', '#fcc419', '#cc5de8',
                   '#22b8cf', '#ff922b', '#94d82d', '#f06595', '#5c7cfa'];
  const nBodies = snaps[0].positions.length;
  for (let b = 0; b < nBodies; b++) {
    ctx.strokeStyle = palette[b % palette.length];
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < snaps.length; i++) {
      const x = cx + snaps[i].positions[b][0] * scale;
      const y = cy + snaps[i].positions[b][1] * scale;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    // Start marker (green) + end marker (red)
    ctx.fillStyle = '#51cf66';
    ctx.beginPath();
    ctx.arc(cx + snaps[0].positions[b][0] * scale,
            cy + snaps[0].positions[b][1] * scale, 4, 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillStyle = '#ff6b6b';
    const last = snaps[snaps.length - 1];
    ctx.beginPath();
    ctx.arc(cx + last.positions[b][0] * scale,
            cy + last.positions[b][1] * scale, 4, 0, 2 * Math.PI);
    ctx.fill();
  }

  // Scale label
  ctx.fillStyle = '#6b7fb3';
  ctx.font = '11px "SFMono-Regular", Menlo, monospace';
  ctx.fillText(`scale: ±${max.toExponential(2)} (1 unit = ${(c.width/2 - 30)/max}px)`, 8, 14);
  ctx.fillText(`snapshots: ${snaps.length} · bodies: ${nBodies}`, 8, c.height - 6);
}

function drawEnergy(snaps) {
  const c = $('energy-canvas');
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0b1021';
  ctx.fillRect(0, 0, c.width, c.height);
  if (snaps.length < 2) return;

  const energies = snaps.map(s => s.energy);
  let minE = Math.min(...energies), maxE = Math.max(...energies);
  if (maxE - minE < 1e-12) { minE -= 1e-6; maxE += 1e-6; }
  const xStep = c.width / (snaps.length - 1);

  // Horizontal grid lines
  ctx.strokeStyle = '#1a2444';
  ctx.lineWidth = 0.5;
  for (let i = 1; i < 4; i++) {
    const y = (i / 4) * c.height;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(c.width, y); ctx.stroke();
  }

  // Energy line
  ctx.strokeStyle = '#51cf66';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < snaps.length; i++) {
    const x = i * xStep;
    const y = c.height - ((energies[i] - minE) / (maxE - minE)) * c.height;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Min/max labels
  ctx.fillStyle = '#6b7fb3';
  ctx.font = '10px "SFMono-Regular", Menlo, monospace';
  ctx.fillText(`max=${maxE.toExponential(6)}`, 8, 14);
  ctx.fillText(`min=${minE.toExponential(6)}`, 8, c.height - 6);
  ctx.textAlign = 'right';
  ctx.fillText(`drift=${((energies[energies.length-1] - energies[0]) / Math.abs(energies[0])).toExponential(4)}`, c.width - 8, 14);
  ctx.textAlign = 'left';
}

// ── API key persistence ────────────────────────────────────────────────────
function loadApiKey() {
  const k = localStorage.getItem('nbody-api-key') || '';
  $('apikey').value = k;
}
function saveApiKey() {
  localStorage.setItem('nbody-api-key', $('apikey').value);
}

// ── Validate system id against the DB ──────────────────────────────────────
async function validateSysId() {
  const id = parseInt($('sysid').value, 10);
  if (isNaN(id)) { $('sysid').className = ''; return; }
  const r = await fetch(`/api/simulations/${id}`, { method: 'GET' });
  if (r.status === 200) {
    $('sysid').className = 'valid';
  } else {
    $('sysid').className = 'invalid';
  }
}

// ── Wire up buttons on page load ───────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  // ── Mode badge: show whether we're in static or dynamic mode ──────────
  if (IS_DYNAMIC_MODE) {
    const badge = document.querySelector('header h1 .badge');
    if (badge) {
      badge.textContent = `DYNAMIC MODE → ${DYNAMIC_BACKEND}`;
      badge.style.background = '#51cf66';
    }
    // Skip IndexedDB open in dynamic mode (not used)
    log(`DYNAMIC MODE: forwarding all /api/* to ${DYNAMIC_BACKEND}`, 'ok');
    log('cross-user persistence via remote Postgres — requests leave the browser', 'ok');
  } else {
    // Open the DB first (static mode only)
    await window.NBodyDB.openDB();
    log('STATIC MODE: in-browser middleware → IndexedDB (single-user)', 'ok');
  }

  // Button handlers
  $('btn-create').addEventListener('click', createSystem);
  $('btn-step').addEventListener('click', stepSystem);
  $('btn-delete').addEventListener('click', deleteSystem);
  $('btn-refresh').addEventListener('click', async () => {
    await renderTrajectory($('sysid').value);
  });
  $('btn-generate').addEventListener('click', regenerateBodies);

  // Generator change → auto-regenerate (unless "custom")
  $('generator').addEventListener('change', () => {
    if ($('generator').value !== 'custom') regenerateBodies();
  });
  $('n').addEventListener('change', regenerateBodies);
  $('seed').addEventListener('change', regenerateBodies);

  // API key persistence
  loadApiKey();
  $('apikey').addEventListener('input', saveApiKey);

  // System id validation
  $('sysid').addEventListener('input', validateSysId);
  $('sysid').addEventListener('blur', validateSysId);

  // Initial render
  await pollHealth();
  await validateSysId();

  if (IS_DYNAMIC_MODE) {
    log('try: set API key → Create System → Step Forward (data persists across users)', 'ok');
  } else {
    log('try: set any API key → click "Create System" → click "Step Forward"', 'ok');
  }
});
