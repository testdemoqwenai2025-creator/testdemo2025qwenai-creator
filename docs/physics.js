// ============================================================================
// physics.js — MutableBodySystem + IC generators (1:1 port of Scala Phase 5)
// ============================================================================
// Phase 12 deliverable (static GitHub Pages demo).
//
// Zero-dependency vanilla JS. Attaches to window.NBodyPhysics so it can be
// loaded both in the browser (script tag) and in Node.js (server/server.js
// uses a `global.window = {}` shim to reuse this module verbatim).
//
// Public API (mirrors Scala Phase 5):
//   NBodyPhysics.G                       — gravitational constant (1.0)
//   NBodyPhysics.DefaultSoftening        — Plummer softening (1e-6)
//   NBodyPhysics.MutableBodySystem       — class, see below
//   NBodyPhysics.twoBodyCircular(v)      — 2-body circular orbit IC
//   NBodyPhysics.plummerSphere(n, seed)  — Plummer model (Aarseth 1974)
//   NBodyPhysics.lattice(n, spacing)     — regular cubic lattice
//   NBodyPhysics.totalEnergy(bodies, eps) — KE + PE
//   NBodyPhysics.totalMomentum(bodies)   — Σ m·v
// ============================================================================

(function (global) {
  'use strict';

  const G = 1.0;
  const DefaultSoftening = 1.0e-6;

  // ── mulberry32: deterministic PRNG (seeded) ──────────────────────────────
  // Same algorithm as Scala PlummerSphere generator. Reproducible across
  // JVM/JS — same seed → same IC → same trajectory → same drift numbers.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function gaussian(rng) {
    // Box–Muller
    const u1 = Math.max(1e-12, rng());
    const u2 = rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  // ── MutableBodySystem ────────────────────────────────────────────────────
  //
  // Mirrors Scala MutableKDK: flat Float64Array buffers, zero allocations
  // in the integration loop. Bodies never escape — we mutate the arrays
  // in place. The constructor takes a list of {mass, x, y, z, vx, vy, vz}
  // plain objects (no class instances — keeps it JSON-serializable).
  class MutableBodySystem {
    constructor(bodies, dt, softening) {
      const n = bodies.length;
      this.n = n;
      this.dt = dt || 0.01;
      this.softening = (softening === undefined) ? DefaultSoftening : softening;
      this.px = new Float64Array(n);
      this.py = new Float64Array(n);
      this.pz = new Float64Array(n);
      this.vx = new Float64Array(n);
      this.vy = new Float64Array(n);
      this.vz = new Float64Array(n);
      this.mass = new Float64Array(n);
      this.ax = new Float64Array(n);
      this.ay = new Float64Array(n);
      this.az = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const b = bodies[i];
        this.px[i] = +b.x; this.py[i] = +b.y; this.pz[i] = +b.z;
        this.vx[i] = +b.vx; this.vy[i] = +b.vy; this.vz[i] = +b.vz;
        this.mass[i] = +b.mass;
      }
      this._computeAccelerations();
    }

    // Pairwise Newtonian acceleration with Plummer softening.
    // a_i = Σ_{j≠i} G·m_j · (r_j - r_i) / (|r_j - r_i|² + ε²)^(3/2)
    _computeAccelerations() {
      const n = this.n;
      const eps2 = this.softening * this.softening;
      for (let i = 0; i < n; i++) { this.ax[i] = 0; this.ay[i] = 0; this.az[i] = 0; }
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const dx = this.px[j] - this.px[i];
          const dy = this.py[j] - this.py[i];
          const dz = this.pz[j] - this.pz[i];
          const r2 = dx * dx + dy * dy + dz * dz + eps2;
          const invR = 1 / Math.sqrt(r2);
          const invR3 = invR * invR * invR;
          const s_i = G * this.mass[j] * invR3;
          const s_j = G * this.mass[i] * invR3;
          this.ax[i] += s_i * dx; this.ay[i] += s_i * dy; this.az[i] += s_i * dz;
          this.ax[j] -= s_j * dx; this.ay[j] -= s_j * dy; this.az[j] -= s_j * dz;
        }
      }
    }

    // Kick-Drift-Kick leapfrog step (symplectic, energy-conserving).
    step(dt) {
      dt = (dt === undefined) ? this.dt : dt;
      const n = this.n;
      const half = dt * 0.5;
      for (let i = 0; i < n; i++) {
        this.vx[i] += half * this.ax[i];
        this.vy[i] += half * this.ay[i];
        this.vz[i] += half * this.az[i];
      }
      for (let i = 0; i < n; i++) {
        this.px[i] += dt * this.vx[i];
        this.py[i] += dt * this.vy[i];
        this.pz[i] += dt * this.vz[i];
      }
      this._computeAccelerations();
      for (let i = 0; i < n; i++) {
        this.vx[i] += half * this.ax[i];
        this.vy[i] += half * this.ay[i];
        this.vz[i] += half * this.az[i];
      }
    }

    energy() {
      return totalEnergyTyped(this.n, this.px, this.py, this.pz,
                              this.vx, this.vy, this.vz, this.mass, this.softening);
    }

    toJSON() {
      const out = [];
      for (let i = 0; i < this.n; i++) {
        out.push({
          mass: this.mass[i],
          x: this.px[i], y: this.py[i], z: this.pz[i],
          vx: this.vx[i], vy: this.vy[i], vz: this.vz[i]
        });
      }
      return out;
    }
  }

  function totalEnergyTyped(n, px, py, pz, vx, vy, vz, mass, softening) {
    softening = (softening === undefined) ? DefaultSoftening : softening;
    let ke = 0, pe = 0;
    const eps2 = softening * softening;
    for (let i = 0; i < n; i++) {
      ke += 0.5 * mass[i] * (vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i]);
      for (let j = i + 1; j < n; j++) {
        const dx = px[j] - px[i];
        const dy = py[j] - py[i];
        const dz = pz[j] - pz[i];
        const r = Math.sqrt(dx * dx + dy * dy + dz * dz + eps2);
        pe -= G * mass[i] * mass[j] / r;
      }
    }
    return ke + pe;
  }

  // Phase 16: KE/PE breakdown — used by the telemetry panel to show
  // the virial ratio 2KE + PE (≈0 for a bound relaxed system) and to
  // visualize the energy partition on the energy chart.
  function energyBreakdownTyped(n, px, py, pz, vx, vy, vz, mass, softening) {
    softening = (softening === undefined) ? DefaultSoftening : softening;
    let ke = 0, pe = 0;
    const eps2 = softening * softening;
    for (let i = 0; i < n; i++) {
      ke += 0.5 * mass[i] * (vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i]);
      for (let j = i + 1; j < n; j++) {
        const dx = px[j] - px[i];
        const dy = py[j] - py[i];
        const dz = pz[j] - pz[i];
        const r = Math.sqrt(dx * dx + dy * dy + dz * dz + eps2);
        pe -= G * mass[i] * mass[j] / r;
      }
    }
    return { ke, pe, total: ke + pe, virial: 2 * ke + pe };
  }

  function energyBreakdown(bodies, eps) {
    const n = bodies.length;
    const px = new Float64Array(n), py = new Float64Array(n), pz = new Float64Array(n);
    const vx = new Float64Array(n), vy = new Float64Array(n), vz = new Float64Array(n);
    const mass = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const b = bodies[i];
      px[i] = +b.x; py[i] = +b.y; pz[i] = +b.z;
      vx[i] = +b.vx; vy[i] = +b.vy; vz[i] = +b.vz;
      mass[i] = +b.mass;
    }
    return energyBreakdownTyped(n, px, py, pz, vx, vy, vz, mass, eps);
  }

  function totalEnergy(bodies, eps) {
    const n = bodies.length;
    const px = new Float64Array(n), py = new Float64Array(n), pz = new Float64Array(n);
    const vx = new Float64Array(n), vy = new Float64Array(n), vz = new Float64Array(n);
    const mass = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const b = bodies[i];
      px[i] = +b.x; py[i] = +b.y; pz[i] = +b.z;
      vx[i] = +b.vx; vy[i] = +b.vy; vz[i] = +b.vz;
      mass[i] = +b.mass;
    }
    return totalEnergyTyped(n, px, py, pz, vx, vy, vz, mass, eps);
  }

  function totalMomentum(bodies) {
    let px = 0, py = 0, pz = 0;
    for (const b of bodies) {
      px += b.mass * b.vx;
      py += b.mass * b.vy;
      pz += b.mass * b.vz;
    }
    return { x: px, y: py, z: pz };
  }

  // ── Initial-condition generators ─────────────────────────────────────────

  function twoBodyCircular(opts) {
    opts = opts || {};
    const M = opts.M ?? 1.0;
    const m = opts.m ?? 1e-3;
    const r = opts.r ?? 1.0;
    const v = Math.sqrt(G * M / r);
    return [
      { mass: M,  x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 },
      { mass: m,  x: r, y: 0, z: 0, vx: 0, vy: v, vz: 0 }
    ];
  }

  function plummerSphere(n, seed) {
    const rng = mulberry32(seed || 1);
    const bodies = [];
    let vcmX = 0, vcmY = 0, vcmZ = 0;
    let pcmX = 0, pcmY = 0, pcmZ = 0;
    let totalMass = 0;
    for (let i = 0; i < n; i++) {
      const mass = 1 / n;
      const u = Math.max(1e-6, Math.min(1 - 1e-6, rng()));
      const r = 1 / Math.sqrt(Math.pow(u, -2 / 3) - 1);
      const theta = Math.acos(2 * rng() - 1);
      const phi = 2 * Math.PI * rng();
      const x = r * Math.sin(theta) * Math.cos(phi);
      const y = r * Math.sin(theta) * Math.sin(phi);
      const z = r * Math.cos(theta);
      let q, g;
      do {
        q = Math.max(0.1, rng());
        g = q * q * Math.pow(1 - q * q, 3.5);
      } while (g < 0.1 * rng());
      const ve = Math.SQRT2 * Math.pow(1 + r * r, -0.25);
      const v = q * ve;
      const vtheta = Math.acos(2 * rng() - 1);
      const vphi = 2 * Math.PI * rng();
      const vx = v * Math.sin(vtheta) * Math.cos(vphi);
      const vy = v * Math.sin(vtheta) * Math.sin(vphi);
      const vz = v * Math.cos(vtheta);
      bodies.push({ mass, x, y, z, vx, vy, vz });
      vcmX += mass * vx; vcmY += mass * vy; vcmZ += mass * vz;
      pcmX += mass * x; pcmY += mass * y; pcmZ += mass * z;
      totalMass += mass;
    }
    const vcmXavg = vcmX / totalMass;
    const vcmYavg = vcmY / totalMass;
    const vcmZavg = vcmZ / totalMass;
    const pcmXavg = pcmX / totalMass;
    const pcmYavg = pcmY / totalMass;
    const pcmZavg = pcmZ / totalMass;
    for (const b of bodies) {
      b.vx -= vcmXavg; b.vy -= vcmYavg; b.vz -= vcmZavg;
      b.x  -= pcmXavg; b.y  -= pcmYavg; b.z  -= pcmZavg;
    }
    return bodies;
  }

  function lattice(n, spacing) {
    spacing = spacing || 1.0;
    const side = Math.ceil(Math.cbrt(n));
    const bodies = [];
    const rng = mulberry32(42);
    let i = 0;
    for (let xi = 0; xi < side && i < n; xi++) {
      for (let yi = 0; yi < side && i < n; yi++) {
        for (let zi = 0; zi < side && i < n; zi++) {
          bodies.push({
            mass: 1.0 / n,
            x: xi * spacing, y: yi * spacing, z: zi * spacing,
            vx: (rng() - 0.5) * 0.01,
            vy: (rng() - 0.5) * 0.01,
            vz: (rng() - 0.5) * 0.01
          });
          i++;
        }
      }
    }
    return bodies;
  }

  // ── Phase 15 scenario library ────────────────────────────────────────────
  // Curated ICs that produce visually striking 3D trajectories so the demo
  // immediately shows something interesting on first load.

  // Solar System: central star (1.0) + 4 planets in circular orbits on
  // slightly inclined planes (so 3D rendering shows real depth).
  function solarSystem() {
    const M = 1.0;
    const planets = [
      { r: 1.0,  m: 1e-4, inc: 0.00 },
      { r: 1.5,  m: 2e-4, inc: 0.05 },
      { r: 2.2,  m: 3e-4, inc: 0.10 },
      { r: 3.0,  m: 1e-4, inc: -0.08 }
    ];
    const bodies = [{ mass: M, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }];
    for (const p of planets) {
      const v = Math.sqrt(G * M / p.r);
      // Position the planet on the inclined orbit: start at (r,0,0), velocity
      // tilted by `inc` so the orbit normal is (sin(inc), 0, cos(inc)).
      bodies.push({
        mass: p.m,
        x: p.r, y: 0, z: 0,
        vx: 0,
        vy: v * Math.cos(p.inc),
        vz: v * Math.sin(p.inc)
      });
    }
    // Null the center-of-mass velocity + position so the system doesn't drift.
    let totalMass = 0, vcmX = 0, vcmY = 0, vcmZ = 0;
    let pcmX = 0, pcmY = 0, pcmZ = 0;
    for (const b of bodies) {
      totalMass += b.mass;
      vcmX += b.mass * b.vx; vcmY += b.mass * b.vy; vcmZ += b.mass * b.vz;
      pcmX += b.mass * b.x; pcmY += b.mass * b.y; pcmZ += b.mass * b.z;
    }
    const vx0 = vcmX / totalMass, vy0 = vcmY / totalMass, vz0 = vcmZ / totalMass;
    const px0 = pcmX / totalMass, py0 = pcmY / totalMass, pz0 = pcmZ / totalMass;
    for (const b of bodies) {
      b.vx -= vx0; b.vy -= vy0; b.vz -= vz0;
      b.x  -= px0; b.y  -= py0; b.z  -= pz0;
    }
    return bodies;
  }

  // Figure-8 choreography (Chenciner–Montgomery 2000): three equal masses
  // tracing the same figure-8 curve on the XY plane with period T ≈ 6.3259.
  // Initial conditions from the literature:
  //   r1 = ( 0.97000436, -0.24308753, 0)
  //   r2 = (-0.97000436,  0.24308753, 0)
  //   r3 = ( 0, 0, 0)
  //   v3 = (-0.93240737, -0.86473146, 0)
  //   v1 = v2 = -v3/2
  //   G = 1, m = 1 each
  function figure8() {
    const r1 = { x:  0.97000436, y: -0.24308753, z: 0 };
    const r2 = { x: -0.97000436, y:  0.24308753, z: 0 };
    const v3 = { x: -0.93240737, y: -0.86473146, z: 0 };
    return [
      { mass: 1.0, x: r1.x, y: r1.y, z: r1.z, vx: -v3.x / 2, vy: -v3.y / 2, vz: 0 },
      { mass: 1.0, x: r2.x, y: r2.y, z: r2.z, vx: -v3.x / 2, vy: -v3.y / 2, vz: 0 },
      { mass: 1.0, x: 0,     y: 0,     z: 0,    vx:  v3.x,     vy:  v3.y,     vz: 0 }
    ];
  }

  // Binary star + circumbinary planet: two equal-mass stars in a tight binary
  // (r=0.5, v from circular orbit) plus a planet on a wider circular orbit
  // (r=4, slightly inclined). Total system mass ≈ 2, planet mass negligible.
  function binaryWithPlanet() {
    const Mstar = 1.0;
    const Mtot = 2 * Mstar;
    const rBin = 0.5;
    const vBin = Math.sqrt(G * Mstar / (2 * rBin));  // each star's speed in CM frame
    const rPlanet = 4.0;
    const vPlanet = Math.sqrt(G * Mtot / rPlanet);
    const inc = 0.15;
    const bodies = [
      // Star 1 — left side of binary, moving up (+y)
      { mass: Mstar, x: -rBin, y: 0, z: 0, vx: 0, vy:  vBin, vz: 0 },
      // Star 2 — right side, moving down (-y)
      { mass: Mstar, x:  rBin, y: 0, z: 0, vx: 0, vy: -vBin, vz: 0 },
      // Planet — far out, circular orbit, tilted 8.6° out of plane
      { mass: 1e-4, x: rPlanet, y: 0, z: 0,
        vx: 0, vy: vPlanet * Math.cos(inc), vz: vPlanet * Math.sin(inc) }
    ];
    // Null CM (already centered but be safe)
    let totalMass = 0, vcmX = 0, vcmY = 0, vcmZ = 0;
    for (const b of bodies) {
      totalMass += b.mass;
      vcmX += b.mass * b.vx; vcmY += b.mass * b.vy; vcmZ += b.mass * b.vz;
    }
    for (const b of bodies) {
      b.vx -= vcmX / totalMass; b.vy -= vcmY / totalMass; b.vz -= vcmZ / totalMass;
    }
    return bodies;
  }

  global.NBodyPhysics = {
    G,
    DefaultSoftening,
    MutableBodySystem,
    mulberry32,
    twoBodyCircular,
    plummerSphere,
    lattice,
    solarSystem,        // Phase 15
    figure8,            // Phase 15
    binaryWithPlanet,   // Phase 15
    totalEnergy,
    totalMomentum,
    totalEnergyTyped,
    energyBreakdown,        // Phase 16: KE/PE split + virial ratio
    energyBreakdownTyped    // Phase 16: typed-array fast path
  };

})(typeof window !== 'undefined' ? window : globalThis);
