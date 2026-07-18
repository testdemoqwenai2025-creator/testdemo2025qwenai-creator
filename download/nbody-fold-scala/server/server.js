// ============================================================================
// server.js — Zero-dependency Node.js dynamic backend (Phase 13)
// ============================================================================
//
// Reuses docs/physics.js and docs/middleware.js via a `global.window = {}`
// shim so the SAME physics + middleware code runs in browser AND server.
// No npm packages — uses only Node's built-in `http`, `fs`, `path`, `crypto`,
// `url` modules.
//
// Endpoints (mirrors docs/routes.js exactly):
//   GET    /api/health                       Live status (this is what the
//                                             demo header pings every 5s)
//   GET    /api/systems
//   POST   /api/systems
//   GET    /api/systems/:id
//   POST   /api/systems/:id/step
//   GET    /api/systems/:id/trajectories
//   DELETE /api/systems/:id
//   GET    /api/audit?limit=N
//
// Static file serving: any non-/api path serves from ../docs/ (so the same
// server can host both the demo UI and the API if you want a single-process
// deployment).
//
// Persistence: JSON file at server/data/db.json, atomic write via tmp+rename.
// Loaded into memory at startup; flushed after every write. Survives restarts.
//
// Env vars:
//   PORT           listen port (default 3000; Render/Fly.io set this for you)
//   NBODY_API_KEY  required API key (default: 'demo' — set to something
//                  secret in production!)
//   NBODY_REGION   region label reported by /api/health (default: 'local')
// ============================================================================

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');   // Phase 14: WebSocket handshake SHA-1 + frame masking

// ── Shim global.window so physics.js + middleware.js attach to it ──────────
global.window = {};
require('../docs/physics.js');
require('../docs/middleware.js');
const P = global.window.NBodyPhysics;
const MW = global.window.NBodyMiddleware;

// ── Config ────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT, 10) || 3000;
const API_KEY = process.env.NBODY_API_KEY || 'demo';
const REGION = process.env.NBODY_REGION || 'local';
const VERSION = '1.0.0-server';
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');
const DOCS_DIR = path.join(__dirname, '..', 'docs');

// ── In-memory DB (flushed to DATA_FILE on every write) ─────────────────────
let db = {
  systems: [],        // [{id, name, createdAt, dt, softening, steps}]
  bodies: [],         // [{id, systemId, mass, x,y,z, vx,vy,vz}]
  trajectories: [],   // [{id, systemId, step, x,y,z, vx,vy,vz, energy}]
  audit: [],          // [{id, ts, method, path, status, ms, meta}]
  _seq: { systems: 1, bodies: 1, trajectories: 1, audit: 1 }
};
const startedAt = Date.now();
let requestCount = 0;

// ── Phase 14: Prometheus-style metrics counters ──────────────────────────
const metrics = {
  requestsTotal: 0,
  requestsByMethod: {},      // {GET: N, POST: N, ...}
  requestsByPath: {},        // {'/api/health': N, '/api/systems': N, ...}
  requestsByStatus: {},      // {200: N, 404: N, ...}
  requestLatencyMsSum: 0,
  requestLatencyMsCount: 0,
  wsConnectionsTotal: 0,
  wsConnectionsOpen: 0,
  driftObservedSum: 0,
  driftObservedCount: 0,
  lastDrift: 0
};

function recordRequest(method, pathname, status, latencyMs) {
  metrics.requestsTotal++;
  metrics.requestsByMethod[method] = (metrics.requestsByMethod[method] || 0) + 1;
  metrics.requestsByPath[pathname] = (metrics.requestsByPath[pathname] || 0) + 1;
  metrics.requestsByStatus[status] = (metrics.requestsByStatus[status] || 0) + 1;
  metrics.requestLatencyMsSum += latencyMs;
  metrics.requestLatencyMsCount++;
}
function recordDrift(drift) {
  metrics.driftObservedSum += drift;
  metrics.driftObservedCount++;
  metrics.lastDrift = drift;
}

// ── Phase 14: WebSocket subscriber registry ──────────────────────────────
// Map<systemId, Set<socket>> — when handleStepSystem computes a sample,
// it broadcasts {type:'sample', sample:{...}} to every subscriber of that
// system. On completion it broadcasts {type:'done', drift, step}.
const wsSubscribers = new Map();

function wsSubscribe(systemId, socket) {
  if (!wsSubscribers.has(systemId)) wsSubscribers.set(systemId, new Set());
  wsSubscribers.get(systemId).add(socket);
  metrics.wsConnectionsTotal++;
  metrics.wsConnectionsOpen++;
}
function wsUnsubscribe(systemId, socket) {
  const set = wsSubscribers.get(systemId);
  if (set) {
    set.delete(socket);
    if (set.size === 0) wsSubscribers.delete(systemId);
  }
  if (metrics.wsConnectionsOpen > 0) metrics.wsConnectionsOpen--;
}
function wsBroadcast(systemId, msg) {
  const set = wsSubscribers.get(systemId);
  if (!set || set.size === 0) return;
  const payload = JSON.stringify(msg);
  for (const sock of set) {
    try { sock.send(payload); } catch (_) { /* socket closed */ }
  }
}

// ── Phase 14: hand-rolled WebSocket frame helpers (zero-dependency) ──────
// Implements RFC 6455 — the minimum needed for text frames in both
// directions. Server→client frames are unmasked; client→server frames are
// masked (we unmask on read). No binary frames, no fragmentation, no
// compression (we don't need them for JSON trajectory samples).

// Compute the Sec-WebSocket-Accept header value from the client's key
function wsAcceptKey(clientKey) {
  const MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
  return crypto.createHash('sha1').update(clientKey + MAGIC).digest('base64');
}

// Encode a text frame (server → client, unmasked)
function wsEncodeText(str) {
  const payload = Buffer.from(str, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(len, 6);
  }
  header[0] = 0x81;  // FIN + text opcode
  return Buffer.concat([header, payload]);
}

// Decode a frame from a Buffer. Returns null if not enough bytes yet.
// On receipt of opcode 0x8 (close), the socket should be closed.
function wsDecodeFrame(buf) {
  if (buf.length < 2) return null;
  const b0 = buf[0], b1 = buf[1];
  const opcode = b0 & 0x0f;
  const masked = (b1 & 0x80) !== 0;
  let len = b1 & 0x7f;
  let offset = 2;
  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2);
    offset = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    // We don't expect payloads > 4GB — read low 32 bits only
    len = buf.readUInt32BE(6);
    offset = 10;
  }
  let mask = null;
  if (masked) {
    if (buf.length < offset + 4) return null;
    mask = buf.slice(offset, offset + 4);
    offset += 4;
  }
  if (buf.length < offset + len) return null;
  let payload = buf.slice(offset, offset + len);
  if (masked) {
    payload = Buffer.from(payload);  // copy before mutating
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
  }
  return { opcode, payload, consumed: offset + len };
}

// Attach WebSocket semantics to an upgraded socket. Sends a text frame
// via sock.send(str). Closes cleanly on opcode 8.
function attachWebSocket(socket, onMessage) {
  socket._wsBuf = Buffer.alloc(0);
  socket.send = function (str) {
    try { socket.write(wsEncodeText(str)); } catch (_) {}
  };
  socket.on('data', (chunk) => {
    socket._wsBuf = Buffer.concat([socket._wsBuf, chunk]);
    while (socket._wsBuf.length > 0) {
      const frame = wsDecodeFrame(socket._wsBuf);
      if (!frame) break;  // need more bytes
      socket._wsBuf = socket._wsBuf.slice(frame.consumed);
      if (frame.opcode === 0x8) {
        // Close frame
        try { socket.end(); } catch (_) {}
        return;
      }
      if (frame.opcode === 0x1 || frame.opcode === 0x0) {
        // Text frame (or continuation — we don't fragment, so treat same)
        const text = frame.payload.toString('utf8');
        if (onMessage) onMessage(text);
      }
      // Ping/pong (opcodes 9/10) — auto-respond with pong, ignore otherwise
      if (frame.opcode === 0x9) {
        try { socket.write(Buffer.from([0x8a, 0x00])); } catch (_) {}
      }
    }
  });
}

// ── Load / save ────────────────────────────────────────────────────────────
function load() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      db = Object.assign(db, parsed);
      // Recompute _seq from max id in each table
      for (const k of ['systems', 'bodies', 'trajectories', 'audit']) {
        const max = db[k].reduce((m, r) => Math.max(m, r.id), 0);
        db._seq[k] = Math.max(db._seq[k] || 1, max + 1);
      }
      console.log('[db] loaded', db.systems.length, 'systems,',
                  db.bodies.length, 'bodies,', db.trajectories.length, 'trajectories');
    }
  } catch (e) {
    console.error('[db] load failed:', e.message);
  }
}

function save() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, DATA_FILE);  // atomic
  } catch (e) {
    console.error('[db] save failed:', e.message);
  }
}

// ── DB helper API (matches the shape of docs/db.js) ──────────────────────
const DB = {
  async listSystems() {
    return db.systems.slice().sort((a, b) => a.createdAt - b.createdAt);
  },
  async getSystem(id) { return db.systems.find(s => s.id === +id) || null; },
  async insertSystem(name, dt, softening) {
    const row = {
      id: db._seq.systems++,
      name: name || 'unnamed',
      createdAt: Date.now(),
      dt: +dt, softening: +softening, steps: 0
    };
    db.systems.push(row);
    save();
    return row;
  },
  async bodiesOf(systemId) {
    return db.bodies.filter(b => b.systemId === +systemId);
  },
  async insertBody(systemId, body) {
    const row = {
      id: db._seq.bodies++,
      systemId: +systemId,
      mass: +body.mass,
      x: +body.x, y: +body.y, z: +body.z,
      vx: +body.vx, vy: +body.vy, vz: +body.vz
    };
    db.bodies.push(row);
    return row;
  },
  async trajectoriesOf(systemId) {
    return db.trajectories
      .filter(t => t.systemId === +systemId)
      .sort((a, b) => a.step - b.step);
  },
  async lastTrajectoryOf(systemId) {
    const rows = await DB.trajectoriesOf(systemId);
    return rows.length ? rows[rows.length - 1] : null;
  },
  async insertTrajectory(systemId, step, bodyId, x, y, z, vx, vy, vz, energy) {
    // Phase 15: signature now includes bodyId (kept backwards-compatible —
    // callers that omit bodyId get bodyId: 0 via the default).
    if (typeof bodyId === 'number') {
      // new Phase 15 shape: (sysId, step, bodyId, x, y, z, vx, vy, vz, energy)
    } else {
      // legacy shape: (sysId, step, x, y, z, vx, vy, vz, energy) — treat bodyId as 0
      energy = vz; vz = vy; vy = vx; vx = z; z = y; y = x; x = bodyId; bodyId = 0;
    }
    const row = {
      id: db._seq.trajectories++,
      systemId: +systemId, step: +step, bodyId: +bodyId,
      x: +x, y: +y, z: +z, vx: +vx, vy: +vy, vz: +vz, energy: +energy
    };
    db.trajectories.push(row);
    return row;
  },
  async updateSystemSteps(systemId, delta) {
    const sys = db.systems.find(s => s.id === +systemId);
    if (!sys) return null;
    sys.steps = (sys.steps || 0) + (+delta);
    save();
    return sys;
  },
  async deleteSystem(systemId) {
    const id = +systemId;
    const before = db.systems.length;
    db.systems = db.systems.filter(s => s.id !== id);
    db.bodies = db.bodies.filter(b => b.systemId !== id);
    db.trajectories = db.trajectories.filter(t => t.systemId !== id);
    save();
    return db.systems.length < before;
  },
  async insertAudit(row) {
    const r = { id: db._seq.audit++, ts: Date.now(), ...row };
    db.audit.push(r);
    if (db.audit.length > 1000) db.audit = db.audit.slice(-1000);
    return r;
  },
  async listAudit(limit) {
    const sorted = db.audit.slice().sort((a, b) => b.ts - a.ts);
    return limit ? sorted.slice(0, limit) : sorted;
  },
  async stats() {
    return {
      systems: db.systems.length,
      bodies: db.bodies.length,
      trajectories: db.trajectories.length,
      audit: db.audit.length
    };
  }
};

// Save DB after every write that mutates state
const _origInsertAudit = DB.insertAudit;
DB.insertAudit = async function (row) {
  const r = await _origInsertAudit(row);
  save();
  return r;
};

// ── Build the route handlers (reuses docs/routes.js shape) ────────────────
// We don't require docs/routes.js because that file expects a browser `window`
// context; we re-implement the same dispatch inline to keep server.js
// self-contained but semantically identical.

function jsonBody(req, cb) {
  let chunks = '';
  req.on('data', c => { chunks += c; if (chunks.length > 1e6) req.destroy(); });
  req.on('end', () => {
    if (!chunks) return cb(null, null);
    try { cb(null, JSON.parse(chunks)); }
    catch (e) { cb(new Error('invalid_json_body'), null); }
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key'
  });
  res.end(body);
}

function pathId(req, idx) {
  const segs = req.pathname.replace(/^\/+/, '').split('/').filter(s => s.length > 0);
  if (segs.length <= idx) return null;
  const n = parseInt(segs[idx], 10);
  return Number.isFinite(n) ? n : null;
}

function requireAuth(req, res) {
  if (req.pathname === '/api/health') return true;
  const key = req.headers['x-api-key'] || '';
  const ok = key && (API_KEY === 'demo' ? key.length > 0 : MW.safeEqual(key, API_KEY));
  if (!ok) { sendJson(res, 401, { error: 'missing_or_invalid_api_key' }); return false; }
  return true;
}

// ── Route handlers ────────────────────────────────────────────────────────
async function handleHealth(req, res) {
  const uptimeSec = Math.floor((Date.now() - startedAt) / 1000);
  const stats = await DB.stats();
  sendJson(res, 200, {
    status: 'ok',
    version: VERSION,
    region: REGION,
    uptimeSec,
    requestCount: ++requestCount,
    timestamp: Date.now(),
    systems: stats.systems,
    bodies: stats.bodies,
    trajectories: stats.trajectories
  });
}

async function handleListSystems(req, res) {
  const systems = await DB.listSystems();
  const out = [];
  for (const s of systems) {
    const bodies = await DB.bodiesOf(s.id);
    const trajs = await DB.trajectoriesOf(s.id);
    out.push({
      id: s.id, name: s.name, createdAt: s.createdAt,
      dt: s.dt, softening: s.softening, steps: s.steps,
      bodies: bodies.length, trajectories: trajs.length
    });
  }
  sendJson(res, 200, { systems: out });
}

async function handleCreateSystem(req, res) {
  if (!req.jsonBody) return sendJson(res, 400, { error: 'missing_json_body' });
  const jb = req.jsonBody;
  const name = jb.name || 'unnamed';
  const dt = +jb.dt || 0.01;
  const softening = +jb.softening || P.DefaultSoftening;
  const bodiesArr = Array.isArray(jb.bodies) ? jb.bodies : [];
  if (bodiesArr.length === 0) return sendJson(res, 400, { error: 'empty_bodies' });
  const sys = await DB.insertSystem(name, dt, softening);
  for (const b of bodiesArr) await DB.insertBody(sys.id, b);
  const bodies = await DB.bodiesOf(sys.id);
  const e0 = P.totalEnergy(bodies, softening);
  // Phase 15: persist step-0 trajectory for ALL bodies (bodyId 0..N-1)
  // so the demo can render every body's path, not just body 0.
  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i];
    await DB.insertTrajectory(sys.id, 0, i, b.x, b.y, b.z, b.vx, b.vy, b.vz, e0);
  }
  sendJson(res, 201, { id: sys.id, createdAt: sys.createdAt, bodies: bodiesArr.length, energy0: e0 });
}

async function handleGetSystem(req, res) {
  const id = pathId(req, 2);
  if (id === null) return sendJson(res, 400, { error: 'invalid_id' });
  const sys = await DB.getSystem(id);
  if (!sys) return sendJson(res, 404, { error: 'not_found' });
  const bodies = await DB.bodiesOf(id);
  const last = await DB.lastTrajectoryOf(id);
  sendJson(res, 200, {
    id: sys.id, name: sys.name, createdAt: sys.createdAt,
    dt: sys.dt, softening: sys.softening, steps: sys.steps,
    bodies: bodies.map(b => ({
      id: b.id, mass: b.mass,
      x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz
    })),
    last: last ? { step: last.step, x: last.x, y: last.y, z: last.z, energy: last.energy } : null
  });
}

async function handleStepSystem(req, res) {
  const id = pathId(req, 2);
  if (id === null) return sendJson(res, 400, { error: 'invalid_id' });
  const sys = await DB.getSystem(id);
  if (!sys) return sendJson(res, 404, { error: 'not_found' });
  const steps = (req.jsonBody && +req.jsonBody.steps) || 100;
  const sampleEvery = (req.jsonBody && +req.jsonBody.sampleEvery) || 10;
  const bodyRows = await DB.bodiesOf(id);
  const bodies = bodyRows.map(r => ({
    mass: r.mass, x: r.x, y: r.y, z: r.z, vx: r.vx, vy: r.vy, vz: r.vz
  }));
  const system = new P.MutableBodySystem(bodies, sys.dt, sys.softening);
  const lastTraj = await DB.lastTrajectoryOf(id);
  const e0 = lastTraj ? lastTraj.energy : system.energy();
  let lastEnergy = e0;
  // Phase 14: broadcast a "start" message so clients know to clear stale state
  wsBroadcast(id, { type: 'start', systemId: id, steps, sampleEvery, energy0: e0, bodies: bodies.length });
  for (let s = 1; s <= steps; s++) {
    system.step(sys.dt);
    if (s % sampleEvery === 0 || s === steps) {
      lastEnergy = system.energy();
      const snap = system.toJSON();
      const stepNum = (sys.steps || 0) + s;
      // Phase 15: sample ALL bodies. Persist each one with its bodyId so the
      // frontend can render every body's path. WebSocket broadcasts the
      // whole snapshot as an array of {bodyId, x,y,z,vx,vy,vz} samples.
      const samples = [];
      for (let i = 0; i < snap.length; i++) {
        const b = snap[i];
        await DB.insertTrajectory(id, stepNum, i,
          b.x, b.y, b.z, b.vx, b.vy, b.vz, lastEnergy);
        samples.push({
          bodyId: i,
          x: b.x, y: b.y, z: b.z,
          vx: b.vx, vy: b.vy, vz: b.vz
        });
      }
      // Phase 14: broadcast the snapshot to any WebSocket subscribers
      wsBroadcast(id, {
        type: 'sample',
        step: stepNum,
        energy: lastEnergy,
        samples   // Phase 15: array of all bodies' samples
      });
    }
  }
  await DB.updateSystemSteps(id, steps);
  const drift = (e0 === 0) ? Math.abs(lastEnergy) : Math.abs(lastEnergy - e0) / Math.abs(e0);
  recordDrift(drift);
  // Phase 14: broadcast completion
  wsBroadcast(id, {
    type: 'done',
    systemId: id,
    step: steps, energy0: e0, energyFinal: lastEnergy,
    drift, sampled: Math.floor(steps / Math.max(1, sampleEvery))
  });
  sendJson(res, 200, {
    step: steps, energy0: e0, energyFinal: lastEnergy, drift,
    sampled: Math.floor(steps / Math.max(1, sampleEvery))
  });
  save();
}

async function handleTrajectories(req, res) {
  const id = pathId(req, 2);
  if (id === null) return sendJson(res, 400, { error: 'invalid_id' });
  const sys = await DB.getSystem(id);
  if (!sys) return sendJson(res, 404, { error: 'not_found' });
  const rows = await DB.trajectoriesOf(id);
  // Phase 15: keep backwards-compatible flat array, but include bodyId.
  // Also accept ?bodyId=N to filter to a single body.
  const filterBody = req.query.bodyId !== undefined ? parseInt(req.query.bodyId, 10) : null;
  const filtered = Number.isFinite(filterBody)
    ? rows.filter(r => r.bodyId === filterBody)
    : rows;
  sendJson(res, 200, {
    systemId: id,
    trajectories: filtered.map(t => ({
      step: t.step, bodyId: t.bodyId === undefined ? 0 : t.bodyId,
      x: t.x, y: t.y, z: t.z,
      vx: t.vx, vy: t.vy, vz: t.vz, energy: t.energy
    }))
  });
}

// ── Phase 15: GET /api/systems/:id/trajectories/all ───────────────────────
// Returns trajectories grouped by bodyId — much friendlier for the multi-body
// 3D renderer. Shape:
//   {
//     systemId, bodyCount,
//     byBody: [
//       { bodyId, mass, samples: [{step, x,y,z, vx,vy,vz, energy}, ...] },
//       ...
//     ]
//   }
async function handleTrajectoriesAll(req, res) {
  const id = pathId(req, 2);
  if (id === null) return sendJson(res, 400, { error: 'invalid_id' });
  const sys = await DB.getSystem(id);
  if (!sys) return sendJson(res, 404, { error: 'not_found' });
  const [rows, bodyRows] = await Promise.all([DB.trajectoriesOf(id), DB.bodiesOf(id)]);
  const byBody = [];
  for (let i = 0; i < bodyRows.length; i++) {
    const b = bodyRows[i];
    const samples = rows
      .filter(t => (t.bodyId === undefined ? 0 : t.bodyId) === i)
      .map(t => ({
        step: t.step,
        x: t.x, y: t.y, z: t.z,
        vx: t.vx, vy: t.vy, vz: t.vz,
        energy: t.energy
      }));
    byBody.push({
      bodyId: i,
      mass: b.mass,
      samples
    });
  }
  sendJson(res, 200, {
    systemId: id,
    bodyCount: bodyRows.length,
    byBody
  });
}

async function handleDeleteSystem(req, res) {
  const id = pathId(req, 2);
  if (id === null) return sendJson(res, 400, { error: 'invalid_id' });
  const ok = await DB.deleteSystem(id);
  if (!ok) return sendJson(res, 404, { error: 'not_found' });
  sendJson(res, 200, { deleted: +id });
}

async function handleAudit(req, res) {
  const limit = parseInt(req.query.limit, 10) || 50;
  const rows = await DB.listAudit(limit);
  sendJson(res, 200, { audit: rows });
}

// ── Phase 14: Prometheus /metrics endpoint ────────────────────────────────
// Emits text/plain in Prometheus exposition format. No external deps.
async function handleMetrics(req, res) {
  const avgLatency = metrics.requestLatencyMsCount > 0
    ? (metrics.requestLatencyMsSum / metrics.requestLatencyMsCount).toFixed(2)
    : '0';
  const avgDrift = metrics.driftObservedCount > 0
    ? (metrics.driftObservedSum / metrics.driftObservedCount).toExponential(3)
    : '0';
  const uptimeSec = Math.floor((Date.now() - startedAt) / 1000);

  const lines = [];
  lines.push('# HELP nbody_requests_total Total HTTP requests received.');
  lines.push('# TYPE nbody_requests_total counter');
  lines.push('nbody_requests_total ' + metrics.requestsTotal);

  lines.push('# HELP nbody_uptime_seconds Server uptime in seconds.');
  lines.push('# TYPE nbody_uptime_seconds gauge');
  lines.push('nbody_uptime_seconds ' + uptimeSec);

  lines.push('# HELP nbody_systems_count Current number of systems in the DB.');
  lines.push('# TYPE nbody_systems_count gauge');
  lines.push('nbody_systems_count ' + db.systems.length);

  lines.push('# HELP nbody_bodies_count Current number of bodies in the DB.');
  lines.push('# TYPE nbody_bodies_count gauge');
  lines.push('nbody_bodies_count ' + db.bodies.length);

  lines.push('# HELP nbody_trajectories_count Current number of trajectory samples in the DB.');
  lines.push('# TYPE nbody_trajectories_count gauge');
  lines.push('nbody_trajectories_count ' + db.trajectories.length);

  lines.push('# HELP nbody_request_latency_avg_ms Average request latency in ms.');
  lines.push('# TYPE nbody_request_latency_avg_ms gauge');
  lines.push('nbody_request_latency_avg_ms ' + avgLatency);

  lines.push('# HELP nbody_ws_connections_open Currently open WebSocket connections.');
  lines.push('# TYPE nbody_ws_connections_open gauge');
  lines.push('nbody_ws_connections_open ' + metrics.wsConnectionsOpen);

  lines.push('# HELP nbody_ws_connections_total Total WebSocket connections ever opened.');
  lines.push('# TYPE nbody_ws_connections_total counter');
  lines.push('nbody_ws_connections_total ' + metrics.wsConnectionsTotal);

  lines.push('# HELP nbody_drift_last Last observed energy drift from /api/systems/:id/step.');
  lines.push('# TYPE nbody_drift_last gauge');
  lines.push('nbody_drift_last ' + metrics.lastDrift.toExponential(6));

  lines.push('# HELP nbody_drift_avg Average energy drift across all step requests.');
  lines.push('# TYPE nbody_drift_avg gauge');
  lines.push('nbody_drift_avg ' + avgDrift);

  // Per-status counters
  lines.push('# HELP nbody_requests_by_status Total requests by HTTP status code.');
  lines.push('# TYPE nbody_requests_by_status counter');
  for (const [status, count] of Object.entries(metrics.requestsByStatus)) {
    lines.push('nbody_requests_by_status{status="' + status + '"} ' + count);
  }
  // Per-method counters
  lines.push('# HELP nbody_requests_by_method Total requests by HTTP method.');
  lines.push('# TYPE nbody_requests_by_method counter');
  for (const [method, count] of Object.entries(metrics.requestsByMethod)) {
    lines.push('nbody_requests_by_method{method="' + method + '"} ' + count);
  }

  const body = lines.join('\n') + '\n';
  res.writeHead(200, {
    'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

// ── Dispatcher ────────────────────────────────────────────────────────────
async function dispatch(req, res) {
  const segs = req.pathname.replace(/^\/+/, '').split('/').filter(s => s.length > 0);
  const m = req.method;
  try {
    if (m === 'OPTIONS') return sendJson(res, 204, null);
    if (m === 'GET'    && segs.length === 2 && segs[0] === 'api' && segs[1] === 'health')        return handleHealth(req, res);
    if (m === 'GET'    && segs.length === 2 && segs[0] === 'api' && segs[1] === 'metrics')       return handleMetrics(req, res);
    if (m === 'GET'    && segs.length === 2 && segs[0] === 'api' && segs[1] === 'systems')        return handleListSystems(req, res);
    if (m === 'POST'   && segs.length === 2 && segs[0] === 'api' && segs[1] === 'systems')        return handleCreateSystem(req, res);
    if (m === 'GET'    && segs.length === 3 && segs[0] === 'api' && segs[1] === 'systems')        return handleGetSystem(req, res);
    if (m === 'POST'   && segs.length === 4 && segs[0] === 'api' && segs[1] === 'systems' && segs[3] === 'step')        return handleStepSystem(req, res);
    if (m === 'GET'    && segs.length === 5 && segs[0] === 'api' && segs[1] === 'systems' && segs[3] === 'trajectories' && segs[4] === 'all') return handleTrajectoriesAll(req, res);
    if (m === 'GET'    && segs.length === 4 && segs[0] === 'api' && segs[1] === 'systems' && segs[3] === 'trajectories') return handleTrajectories(req, res);
    if (m === 'DELETE' && segs.length === 3 && segs[0] === 'api' && segs[1] === 'systems')        return handleDeleteSystem(req, res);
    if (m === 'GET'    && segs.length === 2 && segs[0] === 'api' && segs[1] === 'audit')          return handleAudit(req, res);
    return sendJson(res, 404, { error: 'no_route' });
  } catch (e) {
    console.error('[dispatch]', e);
    return sendJson(res, 500, { error: 'internal_error', message: e.message });
  }
}

// ── Static file server (for non-API paths) ────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md':   'text/markdown; charset=utf-8',
  '.png':  'image/png',
  '.svg':  'image/svg+xml'
};

function serveStatic(req, res) {
  let p = req.pathname === '/' ? '/index.html' : req.pathname;
  // Prevent path traversal
  p = p.replace(/\.\.+/g, '').replace(/\/+/g, '/');
  const filePath = path.join(DOCS_DIR, p);
  if (!filePath.startsWith(DOCS_DIR)) return sendJson(res, 403, { error: 'forbidden' });
  fs.readFile(filePath, (err, data) => {
    if (err) return sendJson(res, 404, { error: 'not_found', path: p });
    const ext = path.extname(filePath).toLowerCase();
    const ct = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': ct,
      'Content-Length': data.length,
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
}

// ── HTTP server ───────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  // WHATWG URL API (replaces deprecated url.parse)
  const parsed = new URL(req.url, 'http://localhost');
  req.pathname = parsed.pathname;
  req.query = Object.fromEntries(parsed.searchParams.entries());
  const t0 = Date.now();

  // ── Phase 14: WebSocket upgrade for /api/systems/:id/stream ────────────
  // The 'upgrade' event is emitted below — this branch handles only
  // non-upgrade HTTP requests. WebSocket upgrade is wired in the
  // server.on('upgrade', ...) listener further down.
  // (No change to HTTP request handling here — WS is handled separately.)

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key'
    });
    return res.end();
  }

  // API routes
  if (req.pathname.startsWith('/api/')) {
    if (!requireAuth(req, res)) {
      DB.insertAudit({ method: req.method, path: req.pathname, status: 401, ms: Date.now() - t0, meta: 'auth_failed' });
      recordRequest(req.method, req.pathname, 401, Date.now() - t0);
      save();
      return;
    }
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
      jsonBody(req, async (err, jb) => {
        if (err) {
          sendJson(res, 400, { error: 'invalid_json_body' });
          await DB.insertAudit({ method: req.method, path: req.pathname, status: 400, ms: Date.now() - t0, meta: err.message });
          recordRequest(req.method, req.pathname, 400, Date.now() - t0);
          save();
          return;
        }
        req.jsonBody = jb;
        // Wrap dispatch so we can audit the result
        const _origEnd = res.end.bind(res);
        let _status = 200;
        const _writeHead = res.writeHead.bind(res);
        res.writeHead = function (status, ...rest) { _status = status; return _writeHead(status, ...rest); };
        res.end = function (...args) {
          const ms = Date.now() - t0;
          recordRequest(req.method, req.pathname, _status, ms);
          DB.insertAudit({ method: req.method, path: req.pathname, status: _status, ms, meta: null })
            .then(() => save())
            .catch(() => {});
          return _origEnd(...args);
        };
        await dispatch(req, res);
      });
    } else {
      const _origEnd = res.end.bind(res);
      let _status = 200;
      const _writeHead = res.writeHead.bind(res);
      res.writeHead = function (status, ...rest) { _status = status; return _writeHead(status, ...rest); };
      res.end = function (...args) {
        const ms = Date.now() - t0;
        recordRequest(req.method, req.pathname, _status, ms);
        DB.insertAudit({ method: req.method, path: req.pathname, status: _status, ms, meta: null })
          .then(() => save())
          .catch(() => {});
        return _origEnd(...args);
      };
      dispatch(req, res);
    }
    return;
  }

  // Static file serving
  serveStatic(req, res);
});

// ── Phase 14: WebSocket upgrade handler ───────────────────────────────────
server.on('upgrade', (req, socket) => {
  // Only handle /api/systems/:id/stream — reject everything else
  const parsed = new URL(req.url, 'http://localhost');
  const segs = parsed.pathname.replace(/^\/+/, '').split('/').filter(s => s.length > 0);
  const isStream = segs.length === 4 && segs[0] === 'api' && segs[1] === 'systems' && segs[3] === 'stream';
  if (!isStream) {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }
  // Auth check (same X-Api-Key header)
  const key = req.headers['x-api-key'] || '';
  const ok = key && (API_KEY === 'demo' ? key.length > 0 : MW.safeEqual(key, API_KEY));
  if (!ok) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  // Validate WebSocket upgrade headers
  const wsKey = req.headers['sec-websocket-key'];
  if (!wsKey) {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.destroy();
    return;
  }
  // Send the 101 Switching Protocols handshake
  const accept = wsAcceptKey(wsKey);
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n' +
    '\r\n'
  );
  // Register the subscriber
  const systemId = parseInt(segs[2], 10);
  if (!Number.isFinite(systemId)) {
    socket.write(wsEncodeText(JSON.stringify({ type: 'error', message: 'invalid_id' })));
    socket.end();
    return;
  }
  wsSubscribe(systemId, socket);
  // Attach the WebSocket data handler (handles close/ping/text frames)
  attachWebSocket(socket, (text) => {
    // We don't expect client→server messages other than close frames, but
    // if a client sends text we'll just echo a friendly acknowledgment.
    try { socket.send(JSON.stringify({ type: 'ack', text: text.slice(0, 100) })); } catch (_) {}
  });
  // Send a hello so the client knows the subscription is live
  try {
    socket.send(JSON.stringify({
      type: 'subscribed',
      systemId,
      message: 'You will receive sample/done events when POST /api/systems/' + systemId + '/step is called.'
    }));
  } catch (_) {}
  // Clean up on close
  socket.on('close', () => wsUnsubscribe(systemId, socket));
  socket.on('error', () => wsUnsubscribe(systemId, socket));
});

// ── Start ─────────────────────────────────────────────────────────────────
load();
server.listen(PORT, () => {
  console.log('nbody-fold dynamic backend');
  console.log('  version :', VERSION);
  console.log('  region  :', REGION);
  console.log('  port    :', PORT);
  console.log('  api key :', API_KEY === 'demo' ? '(demo mode — any non-empty key accepted)' : '(set)');
  console.log('  docs    :', DOCS_DIR);
  console.log('  data    :', DATA_FILE);
  console.log('  health  : http://localhost:' + PORT + '/api/health');
  console.log('  metrics : http://localhost:' + PORT + '/api/metrics');
  console.log('  ws      : ws://localhost:' + PORT + '/api/systems/:id/stream');
  console.log('  demo    : http://localhost:' + PORT + '/');
  console.log('  external: https://louispenev.github.io/nbody-fold-scala/?backend=http://localhost:' + PORT);
});

// ── Health endpoint self-test (runs at startup) ───────────────────────────
setTimeout(async () => {
  try {
    const stats = await DB.stats();
    console.log('[self-test] /api/health would return:', {
      status: 'ok', version: VERSION, region: REGION, ...stats
    });
  } catch (e) {
    console.error('[self-test] failed:', e);
  }
}, 100);
