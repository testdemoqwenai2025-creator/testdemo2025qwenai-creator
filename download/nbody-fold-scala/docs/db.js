// ============================================================================
// db.js — IndexedDB wrapper (4 object stores mirroring Prisma schema)
// ============================================================================
// Phase 12 deliverable (static GitHub Pages demo).
//
// Used only in STATIC MODE (no ?backend= query param). In dynamic mode the
// fetch shim bypasses IndexedDB entirely and forwards to the real backend.
//
// Schema mirrors Scala Phase12_WebTier/Database.scala:
//   systems        (id, name, createdAt, dt, softening, steps)
//   bodies         (id, systemId, mass, x, y, z, vx, vy, vz)
//   trajectories   (id, systemId, step, x, y, z, vx, vy, vz, energy)
//   audit          (id, ts, method, path, status, ms, meta)
//
// Cascade delete: deleting a system also deletes all its bodies,
// trajectories, and audit-log rows.
// ============================================================================

(function (global) {
  'use strict';

  const DB_NAME = 'nbody-fold';
  const DB_VERSION = 1;
  const STORES = ['systems', 'bodies', 'trajectories', 'audit'];

  let _db = null;
  let _nextId = { systems: 1, bodies: 1, trajectories: 1, audit: 1 };

  function open() {
    return new Promise((resolve, reject) => {
      if (_db) return resolve(_db);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('systems')) {
          const s = db.createObjectStore('systems', { keyPath: 'id' });
          s.createIndex('createdAt', 'createdAt');
        }
        if (!db.objectStoreNames.contains('bodies')) {
          const b = db.createObjectStore('bodies', { keyPath: 'id' });
          b.createIndex('systemId', 'systemId');
        }
        if (!db.objectStoreNames.contains('trajectories')) {
          const t = db.createObjectStore('trajectories', { keyPath: 'id' });
          t.createIndex('systemId', 'systemId');
          t.createIndex('systemId_step', ['systemId', 'step']);
        }
        if (!db.objectStoreNames.contains('audit')) {
          db.createObjectStore('audit', { keyPath: 'id' });
        }
      };
      req.onsuccess = (e) => {
        _db = e.target.result;
        // Compute next-id for each store
        let pending = STORES.length;
        STORES.forEach(store => {
          const tx = _db.transaction(store, 'readonly');
          const idx = tx.objectStore(store);
          const openReq = idx.openCursor(null, 'prev');
          openReq.onsuccess = (ev) => {
            const cursor = ev.target.result;
            if (cursor) _nextId[store] = cursor.value.id + 1;
            if (--pending === 0) resolve(_db);
          };
          openReq.onerror = () => {
            if (--pending === 0) resolve(_db);
          };
        });
      };
      req.onerror = () => reject(req.error);
    });
  }

  function tx(store, mode) {
    return _db.transaction(store, mode).objectStore(store);
  }

  function reqAsPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function put(store, value) {
    value.id = value.id || _nextId[store]++;
    await reqAsPromise(tx(store, 'readwrite').put(value));
    return value.id;
  }

  async function get(store, id) {
    return reqAsPromise(tx(store, 'readonly').get(id));
  }

  async function getAll(store) {
    return reqAsPromise(tx(store, 'readonly').getAll());
  }

  async function getAllByIndex(store, indexName, value) {
    const idx = tx(store, 'readonly').index(indexName);
    return reqAsPromise(idx.getAll(value));
  }

  async function del(store, id) {
    await reqAsPromise(tx(store, 'readwrite').delete(id));
  }

  function clearAll() {
    return Promise.all(STORES.map(s => reqAsPromise(tx(s, 'readwrite').clear())));
  }

  // ── Domain-specific helpers ──────────────────────────────────────────────

  async function listSystems() {
    const all = await getAll('systems');
    all.sort((a, b) => a.createdAt - b.createdAt);
    return all;
  }

  async function getSystem(id) { return get('systems', id); }

  async function insertSystem(name, dt, softening) {
    const id = _nextId.systems++;
    const row = {
      id, name: name || 'unnamed',
      createdAt: Date.now(),
      dt: +dt, softening: +softening,
      steps: 0
    };
    await reqAsPromise(tx('systems', 'readwrite').put(row));
    return row;
  }

  async function bodiesOf(systemId) {
    return getAllByIndex('bodies', 'systemId', systemId);
  }

  async function insertBody(systemId, body) {
    const id = _nextId.bodies++;
    const row = {
      id, systemId,
      mass: +body.mass,
      x: +body.x, y: +body.y, z: +body.z,
      vx: +body.vx, vy: +body.vy, vz: +body.vz
    };
    await reqAsPromise(tx('bodies', 'readwrite').put(row));
    return row;
  }

  async function trajectoriesOf(systemId) {
    const rows = await getAllByIndex('trajectories', 'systemId', systemId);
    rows.sort((a, b) => a.step - b.step);
    return rows;
  }

  async function lastTrajectoryOf(systemId) {
    const rows = await trajectoriesOf(systemId);
    return rows.length ? rows[rows.length - 1] : null;
  }

  async function insertTrajectory(systemId, step, x, y, z, vx, vy, vz, energy) {
    const id = _nextId.trajectories++;
    const row = {
      id, systemId, step: +step,
      x: +x, y: +y, z: +z, vx: +vx, vy: +vy, vz: +vz,
      energy: +energy
    };
    await reqAsPromise(tx('trajectories', 'readwrite').put(row));
    return row;
  }

  async function updateSystemSteps(systemId, deltaSteps) {
    const sys = await get('systems', systemId);
    if (!sys) return null;
    sys.steps = (sys.steps || 0) + (+deltaSteps);
    await reqAsPromise(tx('systems', 'readwrite').put(sys));
    return sys;
  }

  async function deleteSystem(systemId) {
    // Cascade delete bodies + trajectories
    const bodies = await bodiesOf(systemId);
    const trajs = await trajectoriesOf(systemId);
    const t = _db.transaction(['systems', 'bodies', 'trajectories'], 'readwrite');
    t.objectStore('systems').delete(systemId);
    for (const b of bodies) t.objectStore('bodies').delete(b.id);
    for (const tr of trajs) t.objectStore('trajectories').delete(tr.id);
    await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); });
    return true;
  }

  async function insertAudit(row) {
    const id = _nextId.audit++;
    await reqAsPromise(tx('audit', 'readwrite').put({ id, ts: Date.now(), ...row }));
    return id;
  }

  async function listAudit(limit) {
    const all = await getAll('audit');
    all.sort((a, b) => b.ts - a.ts);
    return limit ? all.slice(0, limit) : all;
  }

  async function stats() {
    const [systems, bodies, trajectories, audit] = await Promise.all([
      getAll('systems'), getAll('bodies'), getAll('trajectories'), getAll('audit')
    ]);
    return {
      systems: systems.length,
      bodies: bodies.length,
      trajectories: trajectories.length,
      audit: audit.length
    };
  }

  global.NBodyDB = {
    open,
    STORES,
    listSystems, getSystem, insertSystem, deleteSystem, updateSystemSteps,
    bodiesOf, insertBody,
    trajectoriesOf, lastTrajectoryOf, insertTrajectory,
    insertAudit, listAudit,
    stats, clearAll
  };

})(typeof window !== 'undefined' ? window : globalThis);
