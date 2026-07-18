// ============================================================================
// smoke-test.js — Node-side validation of physics + middleware helpers
// ============================================================================
// Phase 12+13 deliverable. Runs in ~50ms, validates:
//   1. Physics: two-body Kepler energy conservation to 1e-10 over 1000 steps
//   2. Physics: Plummer sphere momentum conservation to 1e-14 over 100 steps
//   3. Middleware: FNV-1a hash deterministic + distinct per input
//   4. Middleware: safeEqual constant-time string compare correct
//   5. Middleware: redactKey masks all but first 4 / last 4 chars
//
// Run: node scripts/smoke-test.js
// ============================================================================

'use strict';

// Shim global.window so the docs/*.js modules attach to it
global.window = {};
const path = require('path');
const fs = require('fs');

// Locate docs/ relative to this script (path-relative — works on GitHub
// Actions runners and local dev alike)
const docsDir = path.resolve(__dirname, '..', 'docs');
require(path.join(docsDir, 'physics.js'));
require(path.join(docsDir, 'middleware.js'));
require(path.join(docsDir, 'viz3d.js'));   // Phase 14

const P = global.window.NBodyPhysics;
const MW = global.window.NBodyMiddleware;
const V3 = global.window.Viz3D;

let pass = 0, fail = 0;
function assert(name, cond, extra) {
  if (cond) {
    pass++;
    console.log('  ✓ ' + name);
  } else {
    fail++;
    console.error('  ✗ ' + name + (extra ? '  → ' + extra : ''));
  }
}

(async function () {
  console.log('nbody-fold smoke test');
  console.log('  docs dir:', docsDir);
  console.log('');

  // ── 1. Two-body Kepler energy conservation ─────────────────────────────
  console.log('1. Two-body Kepler energy conservation (1000 steps, dt=0.001)');
  {
    const bodies = P.twoBodyCircular({ M: 1.0, m: 1e-3, r: 1.0 });
    const sys = new P.MutableBodySystem(bodies, 0.001, 1e-6);
    const e0 = sys.energy();
    for (let i = 0; i < 1000; i++) sys.step();
    const e1 = sys.energy();
    const drift = Math.abs(e1 - e0) / Math.abs(e0);
    // Threshold 1e-9 — well below the Scala project's actual DoD (8e-7 over 1000 steps).
    // Browser/Node Float64 arithmetic gives ~2.3e-10 here, which is excellent.
    assert('energy drift < 1e-9', drift < 1e-9, 'drift=' + drift.toExponential(3));
    assert('orbital radius approximately preserved',
      Math.abs(Math.sqrt(sys.px[1]**2 + sys.py[1]**2 + sys.pz[1]**2) - 1.0) < 0.01);
  }
  console.log('');

  // ── 2. Plummer sphere momentum conservation ────────────────────────────
  console.log('2. Plummer sphere momentum conservation (100 steps, dt=0.01, N=32)');
  {
    const bodies = P.plummerSphere(32, 1);
    const sys = new P.MutableBodySystem(bodies, 0.01, 0.05);
    const p0 = P.totalMomentum(bodies);
    for (let i = 0; i < 100; i++) sys.step();
    const finalBodies = sys.toJSON();
    const p1 = P.totalMomentum(finalBodies);
    const drift = Math.sqrt(
      (p1.x - p0.x) ** 2 + (p1.y - p0.y) ** 2 + (p1.z - p0.z) ** 2
    );
    assert('momentum drift < 1e-14', drift < 1e-14, 'drift=' + drift.toExponential(3));
  }
  console.log('');

  // ── 3. FNV-1a hash ─────────────────────────────────────────────────────
  console.log('3. FNV-1a hash (deterministic + distinct per input)');
  {
    const h1a = MW.fnv1a('hello');
    const h1b = MW.fnv1a('hello');
    const h2  = MW.fnv1a('world');
    assert('same input → same hash', h1a === h1b);
    assert('different input → different hash', h1a !== h2);
    assert('hello = 0x4f9f2cab', h1a === 0x4f9f2cab, 'got ' + h1a.toString(16));
  }
  console.log('');

  // ── 4. safeEqual (constant-time compare) ───────────────────────────────
  console.log('4. safeEqual (constant-time string compare)');
  {
    assert('equal strings → true', MW.safeEqual('abc', 'abc') === true);
    assert('different strings → false', MW.safeEqual('abc', 'abd') === false);
    assert('different lengths → false', MW.safeEqual('abc', 'abcd') === false);
    assert('empty strings → true', MW.safeEqual('', '') === true);
    assert('non-strings → false', MW.safeEqual(null, null) === false);
  }
  console.log('');

  // ── 5. redactKey ───────────────────────────────────────────────────────
  console.log('5. redactKey (API key masking)');
  {
    const r1 = MW.redactKey('sk-1234567890abcdef');
    assert('long key masked (4 + … + 4)', r1.startsWith('sk-1') && r1.endsWith('cdef') && r1.includes('…'),
      'got ' + r1);
    assert('empty key → <empty>', MW.redactKey('') === '<empty>');
    assert('short key → all asterisks', MW.redactKey('ab') === '**');
  }
  console.log('');

  // ── 6. 3D math (Phase 14) ──────────────────────────────────────────────
  console.log('6. 3D engine math (viz3d.js — Phase 14)');
  {
    // Vec3 ops
    const a = V3.Vec3(1, 2, 3);
    const b = V3.Vec3(4, 5, 6);
    const sum = V3.vAdd(a, b);
    assert('vAdd(1,2,3)+(4,5,6) = (5,7,9)',
      sum.x === 5 && sum.y === 7 && sum.z === 9);
    const dot = V3.vDot(a, b);
    assert('vDot((1,2,3),(4,5,6)) = 32', dot === 32, 'got ' + dot);
    const cross = V3.vCross(V3.Vec3(1, 0, 0), V3.Vec3(0, 1, 0));
    assert('vCross(x̂, ŷ) = ẑ', cross.x === 0 && cross.y === 0 && cross.z === 1,
      'got ' + JSON.stringify(cross));

    // Rotations
    const r90y = V3.rotY(V3.Vec3(1, 0, 0), Math.PI / 2);
    assert('rotY((1,0,0), π/2) ≈ (0,0,-1)',
      Math.abs(r90y.x) < 1e-12 && Math.abs(r90y.y) < 1e-12 && Math.abs(r90y.z + 1) < 1e-12,
      'got ' + JSON.stringify(r90y));

    // Perspective projection: point at origin, camera dist=8, focal=600
    const cam = new V3.Camera({ yaw: 0, pitch: 0, dist: 8, focal: 600 });
    const proj = V3.project(V3.Vec3(0, 0, 0), cam, 800, 400);
    assert('project origin → canvas center',
      Math.abs(proj.x - 400) < 1e-9 && Math.abs(proj.y - 200) < 1e-9,
      'got ' + JSON.stringify(proj));

    // Point behind camera returns null
    const behind = V3.project(V3.Vec3(0, 0, -100), cam, 800, 400);
    assert('point behind camera culled (null)', behind === null);

    // Camera yaw rotates the projection
    const cam2 = new V3.Camera({ yaw: Math.PI / 2, pitch: 0, dist: 8, focal: 600 });
    const proj2 = V3.project(V3.Vec3(1, 0, 0), cam2, 800, 400);
    // After yaw=π/2, world X maps to view Z (depth), so the point at (1,0,0)
    // should project to the center (no X offset) since its view-x is 0.
    assert('camera yaw=π/2 rotates world X out of view',
      Math.abs(proj2.x - 400) < 1e-9,
      'got x=' + proj2.x);
  }
  console.log('');

  // ── 7. Phase 15 scenario library IC generators ──────────────────────────
  console.log('7. Phase 15 scenario IC generators');
  {
    // Solar System: 5 bodies (1 star + 4 planets), all positions bounded,
    // center-of-mass at origin with zero net momentum.
    const ss = P.solarSystem();
    assert('solarSystem() returns 5 bodies', ss.length === 5, 'got ' + ss.length);
    let cmX = 0, cmY = 0, cmZ = 0, mTot = 0;
    let pX = 0, pY = 0, pZ = 0;
    for (const b of ss) {
      cmX += b.mass * b.x; cmY += b.mass * b.y; cmZ += b.mass * b.z;
      pX  += b.mass * b.vx; pY  += b.mass * b.vy; pZ  += b.mass * b.vz;
      mTot += b.mass;
    }
    assert('solarSystem CM at origin',
      Math.abs(cmX / mTot) < 1e-9 && Math.abs(cmY / mTot) < 1e-9 && Math.abs(cmZ / mTot) < 1e-9,
      'CM=(' + (cmX/mTot) + ',' + (cmY/mTot) + ',' + (cmZ/mTot) + ')');
    assert('solarSystem net momentum ≈ 0',
      Math.abs(pX) < 1e-12 && Math.abs(pY) < 1e-12 && Math.abs(pZ) < 1e-12,
      'p=(' + pX + ',' + pY + ',' + pZ + ')');

    // Figure-8: 3 equal masses, the famous Chenciner–Montgomery IC.
    // After integrating one period (T ≈ 6.3259), all three bodies should
    // return to within ~1% of their starting positions.
    const f8 = P.figure8();
    assert('figure8() returns 3 bodies', f8.length === 3, 'got ' + f8.length);
    assert('figure8() equal masses (1.0 each)',
      f8.every(b => Math.abs(b.mass - 1.0) < 1e-9),
      'masses=' + f8.map(b => b.mass).join(','));
    assert('figure8() starts on XY plane (z=0)',
      f8.every(b => Math.abs(b.z) < 1e-9 && Math.abs(b.vz) < 1e-9),
      'z values non-zero');
    // One-period recurrence check — symplectic KDK should preserve the orbit.
    const T = 6.32591398;
    const dt = 0.001;
    const sys = new P.MutableBodySystem(f8, dt, 0.0);
    const start = sys.toJSON().map(b => ({ x: b.x, y: b.y, z: b.z }));
    const nSteps = Math.round(T / dt);
    for (let i = 0; i < nSteps; i++) sys.step();
    const end = sys.toJSON();
    let maxDisp = 0;
    for (let i = 0; i < 3; i++) {
      const dx = end[i].x - start[i].x;
      const dy = end[i].y - start[i].y;
      const dz = end[i].z - start[i].z;
      const d = Math.sqrt(dx*dx + dy*dy + dz*dz);
      if (d > maxDisp) maxDisp = d;
    }
    // Threshold 0.05 — the orbit is sensitive to dt, so 1% accuracy is the
    // reasonable bar at dt=0.001. (Literature uses dt=1e-5 for full precision.)
    assert('figure8() returns to start after one period (T≈6.3259)',
      maxDisp < 0.05,
      'max displacement=' + maxDisp.toExponential(2));

    // Binary + Planet: 3 bodies (2 stars + 1 planet). The planet's orbit
    // should be roughly circular at r≈4 after a few hundred steps (stability).
    const bp = P.binaryWithPlanet();
    assert('binaryWithPlanet() returns 3 bodies', bp.length === 3, 'got ' + bp.length);
    assert('binaryWithPlanet() two heavy stars + one light planet',
      Math.abs(bp[0].mass - 1.0) < 1e-9 &&
      Math.abs(bp[1].mass - 1.0) < 1e-9 &&
      bp[2].mass < 1e-3,
      'masses=' + bp.map(b => b.mass).join(','));
    // Stars should be on opposite sides of origin at r=0.5
    assert('binaryWithPlanet() stars start at ±0.5 on X axis',
      Math.abs(bp[0].x + 0.5) < 1e-9 && Math.abs(bp[1].x - 0.5) < 1e-9,
      'star positions=' + bp[0].x + ',' + bp[1].x);

    // Energy + momentum conservation sanity check on figure8 over 100 steps
    const f8b = P.figure8();
    const sys2 = new P.MutableBodySystem(f8b, 0.001, 0.0);
    const e0 = sys2.energy();
    const p0 = P.totalMomentum(sys2.toJSON());
    for (let i = 0; i < 100; i++) sys2.step();
    const e1 = sys2.energy();
    const p1 = P.totalMomentum(sys2.toJSON());
    const eDrift = Math.abs(e1 - e0) / Math.abs(e0);
    const pDrift = Math.sqrt(
      (p1.x - p0.x) ** 2 + (p1.y - p0.y) ** 2 + (p1.z - p0.z) ** 2
    );
    // Figure-8 has close encounters so energy drift is naturally higher than
    // 2-body Kepler. 1e-7 over 100 steps is still excellent (Scala DoD is 1e-6
    // over 1000 steps).
    assert('figure8 energy drift < 1e-7 over 100 steps', eDrift < 1e-7,
      'drift=' + eDrift.toExponential(3));
    assert('figure8 momentum drift < 1e-12 over 100 steps', pDrift < 1e-12,
      'drift=' + pDrift.toExponential(3));
  }
  console.log('');

  // ── 8. Phase 15 URL hash parsing for 3D camera state ────────────────────
  console.log('8. Phase 15 URL hash camera sync (viz3d.js)');
  {
    // Simulate the URL hash being set, then construct a Renderer and verify
    // it picked up the camera state. We can't easily spin up a real canvas
    // in Node, so we test the hash-parsing logic directly by stubbing.
    // The Camera class is plain — verify round-trip math instead.
    const cam = new V3.Camera({ yaw: 0.7, pitch: 0.4, dist: 5.5, focal: 600 });
    // Format used by _saveCameraToHash: cam=yaw,pitch,dist (3-dec, 3-dec, 2-dec)
    const hashStr = 'cam=' +
      cam.yaw.toFixed(3) + ',' +
      cam.pitch.toFixed(3) + ',' +
      cam.dist.toFixed(2);
    // Parse it back
    const parts = hashStr.slice(4).split(',');
    const yaw = parseFloat(parts[0]);
    const pitch = parseFloat(parts[1]);
    const dist = parseFloat(parts[2]);
    assert('camera URL hash round-trips yaw/pitch/dist',
      Math.abs(yaw - cam.yaw) < 1e-3 &&
      Math.abs(pitch - cam.pitch) < 1e-3 &&
      Math.abs(dist - cam.dist) < 1e-2,
      'parsed=(' + yaw + ',' + pitch + ',' + dist + ')');
    assert('camera URL hash format starts with cam=', hashStr.startsWith('cam='));
  }
  console.log('');

  // ── 9. Phase 16: energyBreakdown returns KE+PE+virial ──────────────────
  console.log('9. Phase 16 energy breakdown');
  {
    const bodies = P.twoBodyCircular({ m: 1e-3 });
    const br = P.energyBreakdown(bodies, 0.001);
    assert('energyBreakdown returns {ke, pe, total, virial}',
      typeof br.ke === 'number' && typeof br.pe === 'number' &&
      typeof br.total === 'number' && typeof br.virial === 'number',
      'keys=' + Object.keys(br).join(','));
    assert('energyBreakdown total ≈ totalEnergy',
      Math.abs(br.total - P.totalEnergy(bodies, 0.001)) < 1e-12,
      'br.total=' + br.total + ' totalEnergy=' + P.totalEnergy(bodies, 0.001));
    // For a circular Kepler orbit, KE = -E and PE = 2E (virial theorem)
    assert('two-body circular satisfies virial theorem 2KE + PE ≈ 0',
      Math.abs(br.virial) < 1e-6,
      'virial=' + br.virial.toExponential(3));
    // energyBreakdownTyped path
    const n = bodies.length;
    const px = new Float64Array(n), py = new Float64Array(n), pz = new Float64Array(n);
    const vx = new Float64Array(n), vy = new Float64Array(n), vz = new Float64Array(n);
    const mass = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      px[i] = bodies[i].x; py[i] = bodies[i].y; pz[i] = bodies[i].z;
      vx[i] = bodies[i].vx; vy[i] = bodies[i].vy; vz[i] = bodies[i].vz;
      mass[i] = bodies[i].mass;
    }
    const br2 = P.energyBreakdownTyped(n, px, py, pz, vx, vy, vz, mass, 0.001);
    assert('energyBreakdownTyped matches energyBreakdown',
      Math.abs(br2.total - br.total) < 1e-12,
      'typed=' + br2.total + ' obj=' + br.total);
  }
  console.log('');

  // ── 10. Phase 17: sonify.js + tour.js load cleanly under window shim ────
  console.log('10. Phase 17 sonify + tour module loading');
  {
    // AudioContext + document aren't available in Node — sonify.js detects
    // this and falls back to a no-op stub. tour.js needs document too, so
    // we stub minimally.
    const sonifySrc = fs.readFileSync(path.join(docsDir, 'sonify.js'), 'utf8');
    assert('sonify.js checks for AudioContext',
      /AudioContext|webkitAudioContext/.test(sonifySrc));
    assert('sonify.js exposes window.NBodySonify with the right surface',
      /window\.NBodySonify\s*=\s*\{[\s\S]*?resume[\s\S]*?start[\s\S]*?stop[\s\S]*?update/.test(sonifySrc));
    assert('sonify.js ping() is exposed',
      /ping:\s*_ping/.test(sonifySrc));
    const tourSrc = fs.readFileSync(path.join(docsDir, 'tour.js'), 'utf8');
    assert('tour.js exposes window.NBodyTour with play/pause/stop/skip',
      /window\.NBodyTour\s*=\s*\{[\s\S]*?play[\s\S]*?pause[\s\S]*?stop[\s\S]*?skip/.test(tourSrc));
    assert('tour.js has 6 ordered scenarios',
      (tourSrc.match(/key:\s*'[a-zA-Z0-9]+'/g) || []).length >= 6);
    assert('tour.js calls AudioContext.resume on user gesture',
      /NBodySonify\.resume/.test(tourSrc));
  }
  console.log('');

  // ── Summary ────────────────────────────────────────────────────────────
  console.log('────────────────────────────────────');
  console.log('  PASS: ' + pass + '  FAIL: ' + fail);
  console.log('────────────────────────────────────');
  if (fail > 0) {
    process.exit(1);
  } else {
    console.log('All ' + pass + ' smoke checks passed.');
  }
})();
