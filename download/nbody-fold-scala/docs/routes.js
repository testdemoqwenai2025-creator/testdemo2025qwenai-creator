// ============================================================================
// routes.js — REST route handlers (1:1 port of Scala Phase 12 Routes.scala)
// ============================================================================
// Phase 12 deliverable (static GitHub Pages demo).
//
// Endpoints (all JSON):
//   GET    /api/health                       → health snapshot
//   GET    /api/systems                      → list all systems
//   POST   /api/systems                      → create a system + bodies
//   GET    /api/systems/:id                  → full state: meta + bodies + last
//   POST   /api/systems/:id/step             → advance N steps, persist samples
//   GET    /api/systems/:id/trajectories     → all trajectory samples
//   DELETE /api/systems/:id                  → cascade delete
//   GET    /api/audit                        → recent audit-log rows
//
// Each handler takes a Request and returns a Response. Dispatch is a single
// pattern-match on (method, path-segments) — same shape as Scala.
// ============================================================================

(function (global) {
  'use strict';

  const { json, errorJson } = global.NBodyMiddleware;
  const P = global.NBodyPhysics;

  function makeRoutes(db, opts) {
    opts = opts || {};
    const startedAt = opts.startedAt || Date.now();
    const version   = opts.version   || '1.0.0-static';
    const region    = opts.region    || 'browser';
    let requestCount = 0;

    // ── GET /api/health ─────────────────────────────────────────────────
    async function health(req) {
      const uptimeSec = Math.floor((Date.now() - startedAt) / 1000);
      const stats = await db.stats().catch(() => ({ systems: 0, bodies: 0, trajectories: 0, audit: 0 }));
      return json(200, {
        status: 'ok',
        version,
        region,
        uptimeSec,
        requestCount: ++requestCount,
        timestamp: Date.now(),
        systems: stats.systems,
        bodies: stats.bodies,
        trajectories: stats.trajectories
      });
    }

    // ── GET /api/systems ────────────────────────────────────────────────
    async function listSystems(req) {
      const systems = await db.listSystems();
      const out = [];
      for (const s of systems) {
        const bodies = await db.bodiesOf(s.id);
        const trajs = await db.trajectoriesOf(s.id);
        out.push({
          id: s.id, name: s.name, createdAt: s.createdAt,
          dt: s.dt, softening: s.softening, steps: s.steps,
          bodies: bodies.length, trajectories: trajs.length
        });
      }
      return json(200, { systems: out });
    }

    // ── POST /api/systems ───────────────────────────────────────────────
    // Body: { name, dt, softening, bodies: [{mass, x,y,z, vx,vy,vz}, ...] }
    async function createSystem(req) {
      const jb = req.jsonBody;
      if (!jb) return errorJson(400, 'missing_json_body');
      const name      = jb.name      || 'unnamed';
      const dt        = +jb.dt       || 0.01;
      const softening = +jb.softening || P.DefaultSoftening;
      const bodiesArr = Array.isArray(jb.bodies) ? jb.bodies : [];
      if (bodiesArr.length === 0) return errorJson(400, 'empty_bodies');

      const sys = await db.insertSystem(name, dt, softening);
      for (const b of bodiesArr) await db.insertBody(sys.id, b);

      // Phase 15: persist step-0 trajectory for ALL bodies, not just body 0.
      const bodies = await db.bodiesOf(sys.id);
      const e0 = P.totalEnergy(bodies, softening);
      for (let i = 0; i < bodies.length; i++) {
        const b = bodies[i];
        await db.insertTrajectory(sys.id, 0, i, b.x, b.y, b.z, b.vx, b.vy, b.vz, e0);
      }

      return json(201, {
        id: sys.id, createdAt: sys.createdAt,
        bodies: bodiesArr.length, energy0: e0
      });
    }

    // ── GET /api/systems/:id ────────────────────────────────────────────
    async function getSystem(req) {
      const id = pathId(req, 2);
      if (id === null) return errorJson(400, 'invalid_id');
      const sys = await db.getSystem(id);
      if (!sys) return errorJson(404, 'not_found');
      const bodies = await db.bodiesOf(id);
      const last = await db.lastTrajectoryOf(id);
      return json(200, {
        id: sys.id, name: sys.name, createdAt: sys.createdAt,
        dt: sys.dt, softening: sys.softening, steps: sys.steps,
        bodies: bodies.map(b => ({
          id: b.id, mass: b.mass,
          x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz
        })),
        last: last ? {
          step: last.step, x: last.x, y: last.y, z: last.z, energy: last.energy
        } : null
      });
    }

    // ── POST /api/systems/:id/step ──────────────────────────────────────
    // Body: { steps, sampleEvery }
    async function stepSystem(req) {
      const id = pathId(req, 2);
      if (id === null) return errorJson(400, 'invalid_id');
      const sys = await db.getSystem(id);
      if (!sys) return errorJson(404, 'not_found');
      const steps = (req.jsonBody && +req.jsonBody.steps) || 100;
      const sampleEvery = (req.jsonBody && +req.jsonBody.sampleEvery) || 10;

      // Rebuild MutableBodySystem from DB rows
      const bodyRows = await db.bodiesOf(id);
      const bodies = bodyRows.map(r => ({
        mass: r.mass, x: r.x, y: r.y, z: r.z, vx: r.vx, vy: r.vy, vz: r.vz
      }));
      const system = new P.MutableBodySystem(bodies, sys.dt, sys.softening);

      const lastTraj = await db.lastTrajectoryOf(id);
      const e0 = lastTraj ? lastTraj.energy : system.energy();

      // Phase 15: sample ALL bodies (not just body 0). Each sample is stored
      // with its bodyId so the frontend can render every body's path.
      let lastEnergy = e0;
      const init = system.toJSON();
      for (let i = 0; i < init.length; i++) {
        const b = init[i];
        await db.insertTrajectory(id, sys.steps || 0, i,
          b.x, b.y, b.z, b.vx, b.vy, b.vz, e0);
      }
      for (let s = 1; s <= steps; s++) {
        system.step(sys.dt);
        if (s % sampleEvery === 0 || s === steps) {
          lastEnergy = system.energy();
          const snap = system.toJSON();
          for (let i = 0; i < snap.length; i++) {
            const b = snap[i];
            await db.insertTrajectory(id, (sys.steps || 0) + s, i,
              b.x, b.y, b.z, b.vx, b.vy, b.vz, lastEnergy);
          }
        }
      }
      await db.updateSystemSteps(id, steps);

      const drift = (e0 === 0) ? Math.abs(lastEnergy) : Math.abs(lastEnergy - e0) / Math.abs(e0);
      return json(200, {
        step: steps,
        energy0: e0,
        energyFinal: lastEnergy,
        drift,
        sampled: Math.floor(steps / Math.max(1, sampleEvery))
      });
    }

    // ── GET /api/systems/:id/trajectories ───────────────────────────────
    // Phase 15: include bodyId in each sample. Optional ?bodyId=N filter.
    async function trajectories(req) {
      const id = pathId(req, 2);
      if (id === null) return errorJson(400, 'invalid_id');
      const sys = await db.getSystem(id);
      if (!sys) return errorJson(404, 'not_found');
      const rows = await db.trajectoriesOf(id);
      const filterBody = req.query && req.query.bodyId !== undefined
        ? parseInt(req.query.bodyId, 10) : null;
      const filtered = Number.isFinite(filterBody)
        ? rows.filter(r => (r.bodyId === undefined ? 0 : r.bodyId) === filterBody)
        : rows;
      return json(200, {
        systemId: id,
        trajectories: filtered.map(t => ({
          step: t.step, bodyId: t.bodyId === undefined ? 0 : t.bodyId,
          x: t.x, y: t.y, z: t.z,
          vx: t.vx, vy: t.vy, vz: t.vz, energy: t.energy
        }))
      });
    }

    // ── GET /api/systems/:id/trajectories/all ───────────────────────────
    // Phase 15: grouped-by-body shape for multi-body rendering.
    async function trajectoriesAll(req) {
      const id = pathId(req, 2);
      if (id === null) return errorJson(400, 'invalid_id');
      const sys = await db.getSystem(id);
      if (!sys) return errorJson(404, 'not_found');
      const [rows, bodyRows] = await Promise.all([
        db.trajectoriesOf(id), db.bodiesOf(id)
      ]);
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
        byBody.push({ bodyId: i, mass: b.mass, samples });
      }
      return json(200, { systemId: id, bodyCount: bodyRows.length, byBody });
    }

    // ── DELETE /api/systems/:id ─────────────────────────────────────────
    async function deleteSystem(req) {
      const id = pathId(req, 2);
      if (id === null) return errorJson(400, 'invalid_id');
      const ok = await db.deleteSystem(id);
      return ok ? json(200, { deleted: id }) : errorJson(404, 'not_found');
    }

    // ── GET /api/audit ──────────────────────────────────────────────────
    async function audit(req) {
      const limit = parseInt(req.query && req.query.limit, 10) || 50;
      const rows = await db.listAudit(limit);
      return json(200, { audit: rows });
    }

    // ── Dispatcher ──────────────────────────────────────────────────────
    async function dispatch(req) {
      const segs = (req.path || '').replace(/^\/+/, '').split('/').filter(s => s.length > 0);
      const m = req.method;
      if (m === 'GET'    && segs.length === 2 && segs[0] === 'api' && segs[1] === 'health')        return health(req);
      if (m === 'GET'    && segs.length === 2 && segs[0] === 'api' && segs[1] === 'systems')        return listSystems(req);
      if (m === 'POST'   && segs.length === 2 && segs[0] === 'api' && segs[1] === 'systems')        return createSystem(req);
      if (m === 'GET'    && segs.length === 3 && segs[0] === 'api' && segs[1] === 'systems')        return getSystem(req);
      if (m === 'POST'   && segs.length === 4 && segs[0] === 'api' && segs[1] === 'systems' && segs[3] === 'step')        return stepSystem(req);
      if (m === 'GET'    && segs.length === 5 && segs[0] === 'api' && segs[1] === 'systems' && segs[3] === 'trajectories' && segs[4] === 'all') return trajectoriesAll(req);
      if (m === 'GET'    && segs.length === 4 && segs[0] === 'api' && segs[1] === 'systems' && segs[3] === 'trajectories') return trajectories(req);
      if (m === 'DELETE' && segs.length === 3 && segs[0] === 'api' && segs[1] === 'systems')        return deleteSystem(req);
      if (m === 'GET'    && segs.length === 2 && segs[0] === 'api' && segs[1] === 'audit')          return audit(req);
      return errorJson(404, 'no_route');
    }

    return { dispatch, health, listSystems, createSystem, getSystem, stepSystem, trajectories, trajectoriesAll, deleteSystem, audit };
  }

  function pathId(req, idx) {
    const segs = (req.path || '').replace(/^\/+/, '').split('/').filter(s => s.length > 0);
    if (segs.length <= idx) return null;
    const n = parseInt(segs[idx], 10);
    return Number.isFinite(n) ? n : null;
  }

  global.NBodyRoutes = { makeRoutes, pathId };

})(typeof window !== 'undefined' ? window : globalThis);
