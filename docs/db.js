/* ============================================================================
 * db.js — IndexedDB-backed persistence for the static demo
 * ============================================================================
 * Mirrors the Prisma schema in /prisma/schema.prisma (4 object stores):
 *
 *   Simulation  — config + progress + energy0 + drift
 *   Body        — initial conditions per simulation (cascade delete)
 *   Snapshot    — sampled trajectory points (cascade delete)
 *   ApiAudit    — middleware-emitted audit log rows
 *
 * The DB is the "database tier" of the full-stack demo. All /api/* routes
 * read/write through this layer — exactly as the Scala/Prisma backend does.
 * ========================================================================== */

const DB_NAME = 'nbody-fold-scala';
const DB_VERSION = 1;
const STORES = ['Simulation', 'Body', 'Snapshot', 'ApiAudit'];

let _db = null;
let _nextId = { Simulation: 1, Body: 1, Snapshot: 1, ApiAudit: 1 };

/** Open (or create) the IndexedDB database. Returns a Promise<IDBDatabase>. */
function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = ev.target.result;
      if (!db.objectStoreNames.contains('Simulation')) {
        const s = db.createObjectStore('Simulation', { keyPath: 'id', autoIncrement: true });
        s.createIndex('name', 'name', { unique: false });
        s.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains('Body')) {
        const s = db.createObjectStore('Body', { keyPath: 'id', autoIncrement: true });
        s.createIndex('simulationId', 'simulationId', { unique: false });
      }
      if (!db.objectStoreNames.contains('Snapshot')) {
        const s = db.createObjectStore('Snapshot', { keyPath: 'id', autoIncrement: true });
        s.createIndex('simulationId', 'simulationId', { unique: false });
        s.createIndex('simulationId_step', ['simulationId', 'step'], { unique: false });
      }
      if (!db.objectStoreNames.contains('ApiAudit')) {
        const s = db.createObjectStore('ApiAudit', { keyPath: 'id', autoIncrement: true });
        s.createIndex('ts', 'ts', { unique: false });
        s.createIndex('path', 'path', { unique: false });
      }
    };
    req.onsuccess = async (ev) => {
      _db = ev.target.result;
      // Initialize _nextId counters from existing rows
      for (const store of STORES) {
        const maxId = await getMaxId(store);
        _nextId[store] = maxId + 1;
      }
      resolve(_db);
    };
    req.onerror = (ev) => reject(ev.target.error);
  });
}

/** Get the maximum id in a store (or 0 if empty). */
function getMaxId(store) {
  return new Promise((resolve, reject) => {
    if (!_db) return resolve(0);
    const tx = _db.transaction(store, 'readonly');
    const idx = tx.objectStore(store);
    const openReq = idx.openCursor(null, 'prev');
    openReq.onsuccess = (ev) => {
      const cursor = ev.target.result;
      if (cursor) resolve(cursor.value.id || 0);
      else resolve(0);
    };
    openReq.onerror = (ev) => reject(ev.target.error);
  });
}

/** Allocate the next id for a store (monotonic, collision-free). */
function nextId(store) {
  const id = _nextId[store];
  _nextId[store] = id + 1;
  return id;
}

/** Insert a row into a store. Resolves to the inserted row (with id). */
function dbInsert(store, row) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const id = nextId(store);
    const rowWithId = { ...row, id };
    tx.objectStore(store).add(rowWithId);
    tx.oncomplete = () => resolve(rowWithId);
    tx.onerror = () => reject(tx.error);
  }));
}

/** Get a single row by id. Resolves to row or null. */
function dbGet(store, id) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  }));
}

/** Get all rows from a store, optionally sorted by a key. */
function dbAll(store, sortKey = null) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => {
      const rows = req.result || [];
      if (sortKey) rows.sort((a, b) => (a[sortKey] || 0) - (b[sortKey] || 0));
      resolve(rows);
    };
    req.onerror = () => reject(req.error);
  }));
}

/** Get all rows from a store where indexField === value. */
function dbWhere(store, indexField, value) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const idx = tx.objectStore(store).index(indexField);
    const req = idx.getAll(value);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  }));
}

/** Upsert a row with a specific id (preserves the id). */
function dbPut(store, row) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(row);
    tx.oncomplete = () => resolve(row);
    tx.onerror = () => reject(tx.error);
  }));
}

/** Delete a row by id. */
function dbDelete(store, id) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  }));
}

/** Delete all rows where indexField === value (cascade delete helper). */
function dbDeleteWhere(store, indexField, value) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const idx = tx.objectStore(store).index(indexField);
    const req = idx.openCursor(value);
    let count = 0;
    req.onsuccess = (ev) => {
      const cursor = ev.target.result;
      if (cursor) { cursor.delete(); count++; cursor.continue(); }
    };
    tx.oncomplete = () => resolve(count);
    tx.onerror = () => reject(tx.error);
  }));
}

/** Count rows in a store. */
function dbCount(store) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).count();
    req.onsuccess = () => resolve(req.result || 0);
    req.onerror = () => reject(req.error);
  }));
}

/** Clear all stores (used by the "reset" button if added later). */
async function dbClearAll() {
  const db = await openDB();
  for (const store of STORES) {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  _nextId = { Simulation: 1, Body: 1, Snapshot: 1, ApiAudit: 1 };
  return true;
}

// Expose to global scope
window.NBodyDB = {
  openDB, dbInsert, dbPut, dbGet, dbAll, dbWhere, dbDelete, dbDeleteWhere, dbCount, dbClearAll,
};
