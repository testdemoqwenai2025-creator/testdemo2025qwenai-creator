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
  async insertTrajectory(systemId, step, x, y, z, vx, vy, vz, energy) {
    const row = {
      id: db._seq.trajectories++,
      systemId: +systemId, step: +step,
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
  const b0 = bodies[0];
  await DB.insertTrajectory(sys.id, 0, b0.x, b0.y, b0.z, b0.vx, b0.vy, b0.vz, e0);
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
  const init = system.toJSON();
  // Note: we DON'T insert step-0 here (already inserted at create time);
  // we sample at every sampleEvery step + the final step.
  for (let s = 1; s <= steps; s++) {
    system.step(sys.dt);
    if (s % sampleEvery === 0 || s === steps) {
      lastEnergy = system.energy();
      const b0 = system.toJSON()[0];
      await DB.insertTrajectory(id, (sys.steps || 0) + s,
        b0.x, b0.y, b0.z, b0.vx, b0.vy, b0.vz, lastEnergy);
    }
  }
  await DB.updateSystemSteps(id, steps);
  const drift = (e0 === 0) ? Math.abs(lastEnergy) : Math.abs(lastEnergy - e0) / Math.abs(e0);
  sendJson(res, 200, {
    step: steps, energy0: e0, energyFinal: lastEnergy, drift,
    sampled: Math.floor(steps / Math.max(1, sampleEvery))
  });
  save();  // persist all the trajectory writes
}

async function handleTrajectories(req, res) {
  const id = pathId(req, 2);
  if (id === null) return sendJson(res, 400, { error: 'invalid_id' });
  const sys = await DB.getSystem(id);
  if (!sys) return sendJson(res, 404, { error: 'not_found' });
  const rows = await DB.trajectoriesOf(id);
  sendJson(res, 200, {
    systemId: id,
    trajectories: rows.map(t => ({
      step: t.step, x: t.x, y: t.y, z: t.z,
      vx: t.vx, vy: t.vy, vz: t.vz, energy: t.energy
    }))
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

// ── Dispatcher ────────────────────────────────────────────────────────────
async function dispatch(req, res) {
  const segs = req.pathname.replace(/^\/+/, '').split('/').filter(s => s.length > 0);
  const m = req.method;
  try {
    if (m === 'OPTIONS') return sendJson(res, 204, null);
    if (m === 'GET'    && segs.length === 2 && segs[0] === 'api' && segs[1] === 'health')        return handleHealth(req, res);
    if (m === 'GET'    && segs.length === 2 && segs[0] === 'api' && segs[1] === 'systems')        return handleListSystems(req, res);
    if (m === 'POST'   && segs.length === 2 && segs[0] === 'api' && segs[1] === 'systems')        return handleCreateSystem(req, res);
    if (m === 'GET'    && segs.length === 3 && segs[0] === 'api' && segs[1] === 'systems')        return handleGetSystem(req, res);
    if (m === 'POST'   && segs.length === 4 && segs[0] === 'api' && segs[1] === 'systems' && segs[3] === 'step')        return handleStepSystem(req, res);
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
      save();
      return;
    }
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
      jsonBody(req, async (err, jb) => {
        if (err) {
          sendJson(res, 400, { error: 'invalid_json_body' });
          await DB.insertAudit({ method: req.method, path: req.pathname, status: 400, ms: Date.now() - t0, meta: err.message });
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
          DB.insertAudit({ method: req.method, path: req.pathname, status: _status, ms: Date.now() - t0, meta: null })
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
        DB.insertAudit({ method: req.method, path: req.pathname, status: _status, ms: Date.now() - t0, meta: null })
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
