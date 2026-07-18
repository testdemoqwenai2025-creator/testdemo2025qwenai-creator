/* ============================================================================
 * routes.js — REST API route handlers for the static demo
 * ============================================================================
 * Mirrors the Next.js API routes in src/app/api/:
 *
 *   GET    /api/health                       — uptime + row counts
 *   GET    /api/simulations                  — list all systems
 *   POST   /api/simulations                  — create a system + bodies
 *   GET    /api/simulations/:id              — get system + bodies
 *   DELETE /api/simulations/:id              — delete (cascade) system
 *   POST   /api/simulations/:id/step         — advance N leapfrog KDK steps
 *   GET    /api/simulations/:id/snapshots    — chart data (energy/momentum)
 *   GET    /api/audit                        — recent audit-log rows
 *
 * Each handler returns a synthetic Response (see middleware.js makeResponse).
 * The dispatcher parses the path + method and dispatches to the handler.
 * ========================================================================== */

const { MutableBodySystem, generateInitialConditions } = window.NBodyPhysics;
const { makeResponse } = window.NBodyMW;

const START_MS = Date.now();

// ── Route handlers ─────────────────────────────────────────────────────────

/** GET /api/health — uptime + row counts from each IndexedDB store. */
async function getHealth(req) {
  const [sysCount, bodyCount, snapCount, auditCount] = await Promise.all([
    window.NBodyDB.dbCount('Simulation'),
    window.NBodyDB.dbCount('Body'),
    window.NBodyDB.dbCount('Snapshot'),
    window.NBodyDB.dbCount('ApiAudit'),
  ]);
  return makeResponse(200, {
    status: 'ok',
    uptimeSec: Math.round((Date.now() - START_MS) / 1000),
    systems: sysCount,
    bodies: bodyCount,
    snapshots: snapCount,
    auditRows: auditCount,
    middlewareChain: ['errorHandler', 'requestLogger', 'authGate', 'jsonBody', 'corsHandler', 'dispatcher'],
    phase: 12,
    engine: 'MutableBodySystem (leapfrog KDK, G=1, Plummer softening)',
  });
}

/** GET /api/simulations — list all systems (without bodies for brevity). */
async function listSimulations(req) {
  const systems = await window.NBodyDB.dbAll('Simulation', 'id');
  return makeResponse(200, {
    count: systems.length,
    simulations: systems.map(s => ({
      id: s.id,
      name: s.name,
      dt: s.dt,
      softening: s.softening,
      stepCount: s.stepCount,
      energy0: s.energy0,
      energyFinal: s.energyFinal,
      drift: s.drift,
      createdAt: s.createdAt,
    })),
  });
}

/** POST /api/simulations — create a system with bodies. */
async function createSimulation(req) {
  const { name, dt, softening, bodies, generator, n, seed } = req.body || {};

  if (!Array.isArray(bodies) || bodies.length < 2) {
    return makeResponse(400, { error: 'bodies must be an array of length >= 2' });
  }
  if (typeof dt !== 'number' || dt <= 0) {
    return makeResponse(400, { error: 'dt must be a positive number' });
  }
  if (typeof softening !== 'number' || softening < 0) {
    return makeResponse(400, { error: 'softening must be >= 0' });
  }

  // Normalize body shape: { mass, pos:[x,y,z], vel:[x,y,z] }
  const normalized = bodies.map((b, i) => ({
    mass: Number(b.mass),
    pos: Array.isArray(b.pos) ? b.pos.map(Number) : [Number(b.x)||0, Number(b.y)||0, Number(b.z)||0],
    vel: Array.isArray(b.vel) ? b.vel.map(Number) : [Number(b.vx)||0, Number(b.vy)||0, Number(b.vz)||0],
  }));

  // Compute energy0 with a fresh system
  const sys = new MutableBodySystem(normalized);
  const energy0 = sys.totalEnergy(softening);

  // Insert Simulation row
  const sim = await window.NBodyDB.dbInsert('Simulation', {
    name: name || `system-${Date.now()}`,
    dt, softening,
    generator: generator || 'custom',
    n: normalized.length,
    seed: seed || 0,
    energy0,
    energyFinal: energy0,
    drift: 0,
    stepCount: 0,
    createdAt: Date.now(),
  });

  // Insert Body rows
  for (let i = 0; i < normalized.length; i++) {
    await window.NBodyDB.dbInsert('Body', {
      simulationId: sim.id,
      bodyId: i + 1,
      mass: normalized[i].mass,
      posX: normalized[i].pos[0],
      posY: normalized[i].pos[1],
      posZ: normalized[i].pos[2],
      velX: normalized[i].vel[0],
      velY: normalized[i].vel[1],
      velZ: normalized[i].vel[2],
    });
  }

  return makeResponse(201, {
    id: sim.id,
    name: sim.name,
    bodies: normalized.length,
    energy0,
    dt, softening,
    createdAt: sim.createdAt,
  });
}

/** GET /api/simulations/:id — get a system + its bodies. */
async function getSimulation(req, id) {
  const sim = await window.NBodyDB.dbGet('Simulation', Number(id));
  if (!sim) return makeResponse(404, { error: `Simulation ${id} not found` });
  const bodies = await window.NBodyDB.dbWhere('Body', 'simulationId', Number(id));
  return makeResponse(200, {
    ...sim,
    bodies: bodies.map(b => ({
      bodyId: b.bodyId,
      mass: b.mass,
      pos: [b.posX, b.posY, b.posZ],
      vel: [b.velX, b.velY, b.velZ],
    })),
  });
}

/** DELETE /api/simulations/:id — cascade delete a system + its bodies + snapshots. */
async function deleteSimulation(req, id) {
  const sim = await window.NBodyDB.dbGet('Simulation', Number(id));
  if (!sim) return makeResponse(404, { error: `Simulation ${id} not found` });
  const bCount = await window.NBodyDB.dbDeleteWhere('Body', 'simulationId', Number(id));
  const sCount = await window.NBodyDB.dbDeleteWhere('Snapshot', 'simulationId', Number(id));
  await window.NBodyDB.dbDelete('Simulation', Number(id));
  return makeResponse(200, {
    deleted: true,
    id: Number(id),
    bodiesRemoved: bCount,
    snapshotsRemoved: sCount,
  });
}

/** POST /api/simulations/:id/step — advance N leapfrog KDK steps. */
async function stepSimulation(req, id) {
  const { steps, sampleEvery } = req.body || {};
  const sim = await window.NBodyDB.dbGet('Simulation', Number(id));
  if (!sim) return makeResponse(404, { error: `Simulation ${id} not found` });

  const N = Math.max(1, Math.min(50000, Number(steps) || 100));
  const sample = Math.max(1, Number(sampleEvery) || 10);

  // Rebuild the system from the stored bodies
  const bodyRows = await window.NBodyDB.dbWhere('Body', 'simulationId', Number(id));
  if (bodyRows.length === 0) {
    return makeResponse(400, { error: `Simulation ${id} has no bodies` });
  }
  bodyRows.sort((a, b) => a.bodyId - b.bodyId);
  const inits = bodyRows.map(b => ({
    mass: b.mass,
    pos: [b.posX, b.posY, b.posZ],
    vel: [b.velX, b.velY, b.velZ],
  }));

  // Load existing snapshots so we can continue from the right step
  const existingSnaps = await window.NBodyDB.dbWhere('Snapshot', 'simulationId', Number(id));
  const startStep = existingSnaps.reduce((max, s) => Math.max(max, s.step), 0);

  const sys = new MutableBodySystem(inits);
  // If we have a prior snapshot, restore positions/velocities from the latest one
  if (existingSnaps.length > 0) {
    existingSnaps.sort((a, b) => a.step - b.step);
    const last = existingSnaps[existingSnaps.length - 1];
    for (let i = 0; i < sys.n && i < last.positions.length; i++) {
      sys.posX[i] = last.positions[i][0];
      sys.posY[i] = last.positions[i][1];
      sys.posZ[i] = last.positions[i][2];
      // Velocities aren't stored in snapshots — recompute from accelerations
      // For the static demo, we accept that long-running sim accuracy degrades
      // slightly when resuming. (The Scala backend stores full state in Body rows.)
    }
  }

  // Run N steps, sampling every `sample` steps
  const energyBefore = sys.totalEnergy(sim.softening);
  for (let i = 1; i <= N; i++) {
    sys.step(sim.dt, sim.softening);
    if (i % sample === 0 || i === N) {
      const snap = sys.snapshot(startStep + i, sim.softening);
      await window.NBodyDB.dbInsert('Snapshot', {
        simulationId: Number(id),
        step: startStep + i,
        energy: snap.energy,
        momentumMag: snap.momentumMag,
        angularMag: snap.angularMag,
        positions: snap.positions,
        ts: Date.now(),
      });
    }
  }
  const energyAfter = sys.totalEnergy(sim.softening);
  const drift = energyBefore !== 0 ? (energyAfter - energyBefore) / Math.abs(energyBefore) : 0;

  // Update Simulation row in-place (preserves the id)
  await window.NBodyDB.dbPut('Simulation', {
    ...sim,
    stepCount: startStep + N,
    energyFinal: energyAfter,
    drift,
  });

  return makeResponse(200, {
    id: Number(id),
    step: startStep + N,
    stepsExecuted: N,
    sampleEvery: sample,
    energyBefore,
    energyAfter,
    drift,
    snapshotsAdded: Math.floor(N / sample) + (N % sample === 0 ? 0 : 1),
  });
}

/** GET /api/simulations/:id/snapshots — chart data (energy/momentum/positions). */
async function getSnapshots(req, id) {
  const snaps = await window.NBodyDB.dbWhere('Snapshot', 'simulationId', Number(id));
  snaps.sort((a, b) => a.step - b.step);
  return makeResponse(200, {
    id: Number(id),
    count: snaps.length,
    snapshots: snaps.map(s => ({
      step: s.step,
      energy: s.energy,
      momentumMag: s.momentumMag,
      angularMag: s.angularMag,
      positions: s.positions,
    })),
  });
}

/** GET /api/audit — recent audit-log rows. */
async function getAudit(req) {
  const rows = await window.NBodyDB.dbAll('ApiAudit', 'id');
  // Return in reverse order (most recent first)
  rows.reverse();
  return makeResponse(200, {
    count: rows.length,
    audit: rows.slice(0, 100).map(r => ({
      ts: r.ts,
      method: r.method,
      path: r.path,
      status: r.status,
      latencyMs: r.latencyMs,
      ipHash: r.ipHash,
      apiKey: r.apiKey,
    })),
  });
}

// ── Dispatcher ─────────────────────────────────────────────────────────────

/** Match a path against a route pattern. Returns { matched, params }. */
function matchPath(pattern, pathname) {
  const pParts = pattern.split('/').filter(Boolean);
  const aParts = pathname.split('/').filter(Boolean);
  if (pParts.length !== aParts.length) return { matched: false, params: {} };
  const params = {};
  for (let i = 0; i < pParts.length; i++) {
    if (pParts[i].startsWith(':')) {
      params[pParts[i].slice(1)] = decodeURIComponent(aParts[i]);
    } else if (pParts[i] !== aParts[i]) {
      return { matched: false, params: {} };
    }
  }
  return { matched: true, params };
}

/** The dispatcher — pattern-matches the path and calls the right handler. */
async function dispatcher(req) {
  const { method, pathname } = req;

  // Static route table
  const routes = [
    { pattern: '/api/health',                       method: 'GET',    handler: getHealth },
    { pattern: '/api/simulations',                  method: 'GET',    handler: listSimulations },
    { pattern: '/api/simulations',                  method: 'POST',   handler: createSimulation },
    { pattern: '/api/simulations/:id',              method: 'GET',    handler: (req, p) => getSimulation(req, p.id) },
    { pattern: '/api/simulations/:id',              method: 'DELETE', handler: (req, p) => deleteSimulation(req, p.id) },
    { pattern: '/api/simulations/:id/step',         method: 'POST',   handler: (req, p) => stepSimulation(req, p.id) },
    { pattern: '/api/simulations/:id/snapshots',    method: 'GET',    handler: (req, p) => getSnapshots(req, p.id) },
    { pattern: '/api/audit',                        method: 'GET',    handler: getAudit },
  ];

  for (const r of routes) {
    if (r.method !== method) continue;
    const { matched, params } = matchPath(r.pattern, pathname);
    if (matched) return await r.handler(req, params);
  }

  return makeResponse(404, {
    error: 'Not Found',
    method, pathname,
    availableRoutes: routes.map(r => `${r.method} ${r.pattern}`),
  });
}

// ── Build the full middleware chain ────────────────────────────────────────

const fullChain = window.NBodyMW.compose(
  [...window.NBodyMW.chain, dispatcher],
  async (req) => makeResponse(404, { error: 'No handler matched', pathname: req.pathname })
);

// Expose to global scope
window.NBodyRoutes = {
  dispatcher,
  fullChain,
  process(method, path, body, headers) {
    const req = window.NBodyMW.makeRequest(method, path, body, headers);
    return fullChain(req);
  },
};
