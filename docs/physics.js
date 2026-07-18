/* ============================================================================
 * physics.js — N-body physics engine (vanilla JS port of src/lib/nbody.ts)
 * ============================================================================
 * Mirrors the Scala Phase 5 MutableKDK implementation:
 *
 *   - Newtonian gravity with G=1 and Plummer softening (1/r² → 1/(r²+ε²))
 *   - Leapfrog KDK (Kick-Drift-Kick) symplectic integrator
 *   - Mutable flat-array storage for zero-allocation stepping
 *
 * Initial-condition generators mirror the Scala Phase 8 PlummerSphere and
 * Phase 10 StructuredGenerators (lattice, two-body).
 * ========================================================================== */

/** A mutable N-body system backed by parallel Float64Arrays. */
class MutableBodySystem {
  constructor(inits) {
    this.n = inits.length;
    this.mass  = new Float64Array(this.n);
    this.posX  = new Float64Array(this.n);
    this.posY  = new Float64Array(this.n);
    this.posZ  = new Float64Array(this.n);
    this.velX  = new Float64Array(this.n);
    this.velY  = new Float64Array(this.n);
    this.velZ  = new Float64Array(this.n);
    this.accX  = new Float64Array(this.n);
    this.accY  = new Float64Array(this.n);
    this.accZ  = new Float64Array(this.n);
    for (let i = 0; i < this.n; i++) {
      this.mass[i] = inits[i].mass;
      this.posX[i] = inits[i].pos[0];
      this.posY[i] = inits[i].pos[1];
      this.posZ[i] = inits[i].pos[2];
      this.velX[i] = inits[i].vel[0];
      this.velY[i] = inits[i].vel[1];
      this.velZ[i] = inits[i].vel[2];
    }
    // First-call guard: accelerations must be computed before the first step
    this._accInitialized = false;
  }

  /** a_i = Σ_{j≠i} G·m_j·(r_j-r_i) / (|r|²+ε²)^(3/2). O(N²) brute force. */
  computeAccelerations(softening) {
    const { n, mass, posX, posY, posZ, accX, accY, accZ } = this;
    accX.fill(0); accY.fill(0); accZ.fill(0);
    const eps2 = softening * softening;
    const G = 1.0;
    for (let i = 0; i < n; i++) {
      const xi = posX[i], yi = posY[i], zi = posZ[i];
      for (let j = i + 1; j < n; j++) {
        const dx = posX[j] - xi;
        const dy = posY[j] - yi;
        const dz = posZ[j] - zi;
        const r2 = dx * dx + dy * dy + dz * dz + eps2;
        const invR3 = 1.0 / (r2 * Math.sqrt(r2));
        const fOverR = G * invR3;
        const fxij = fOverR * dx;
        const fyij = fOverR * dy;
        const fzij = fOverR * dz;
        const mj = mass[j];
        accX[i] += mj * fxij;
        accY[i] += mj * fyij;
        accZ[i] += mj * fzij;
        const mi = mass[i];
        accX[j] -= mi * fxij;
        accY[j] -= mi * fyij;
        accZ[j] -= mi * fzij;
      }
    }
    this._accInitialized = true;
  }

  /** Leapfrog KDK step: Kick(h/2) → Drift(h) → Kick(h/2). */
  step(dt, softening) {
    if (!this._accInitialized) this.computeAccelerations(softening);
    const { n, posX, posY, posZ, velX, velY, velZ, accX, accY, accZ } = this;
    const halfDt = dt * 0.5;
    // Kick (half) — v += a·dt/2
    for (let i = 0; i < n; i++) {
      velX[i] += halfDt * accX[i];
      velY[i] += halfDt * accY[i];
      velZ[i] += halfDt * accZ[i];
    }
    // Drift — x += v·dt
    for (let i = 0; i < n; i++) {
      posX[i] += dt * velX[i];
      posY[i] += dt * velY[i];
      posZ[i] += dt * velZ[i];
    }
    // Recompute accelerations at new positions
    this.computeAccelerations(softening);
    // Kick (half) — v += a·dt/2 with new accelerations
    for (let i = 0; i < n; i++) {
      velX[i] += halfDt * accX[i];
      velY[i] += halfDt * accY[i];
      velZ[i] += halfDt * accZ[i];
    }
  }

  /** Total energy: K + U (with Plummer-softened potential). */
  totalEnergy(softening) {
    const { n, mass, posX, posY, posZ, velX, velY, velZ } = this;
    const eps2 = softening * softening;
    let K = 0;
    for (let i = 0; i < n; i++) {
      const v2 = velX[i]*velX[i] + velY[i]*velY[i] + velZ[i]*velZ[i];
      K += 0.5 * mass[i] * v2;
    }
    let U = 0;
    const G = 1.0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = posX[j] - posX[i];
        const dy = posY[j] - posY[i];
        const dz = posZ[j] - posZ[i];
        const r = Math.sqrt(dx*dx + dy*dy + dz*dz + eps2);
        U -= G * mass[i] * mass[j] / r;
      }
    }
    return K + U;
  }

  /** |p| = |Σ m_i·v_i|. */
  momentumMagnitude() {
    const { n, mass, velX, velY, velZ } = this;
    let px = 0, py = 0, pz = 0;
    for (let i = 0; i < n; i++) {
      px += mass[i] * velX[i];
      py += mass[i] * velY[i];
      pz += mass[i] * velZ[i];
    }
    return Math.sqrt(px*px + py*py + pz*pz);
  }

  /** |L| = |Σ m_i·(r_i × v_i)|. */
  angularMomentumMagnitude() {
    const { n, mass, posX, posY, posZ, velX, velY, velZ } = this;
    let lx = 0, ly = 0, lz = 0;
    for (let i = 0; i < n; i++) {
      const m = mass[i];
      lx += m * (posY[i]*velZ[i] - posZ[i]*velY[i]);
      ly += m * (posZ[i]*velX[i] - posX[i]*velZ[i]);
      lz += m * (posX[i]*velY[i] - posY[i]*velX[i]);
    }
    return Math.sqrt(lx*lx + ly*ly + lz*lz);
  }

  /** Snapshot the current state for trajectory replay. */
  snapshot(step, softening) {
    const positions = new Array(this.n);
    for (let i = 0; i < this.n; i++) {
      positions[i] = [this.posX[i], this.posY[i], this.posZ[i]];
    }
    return {
      step,
      energy: this.totalEnergy(softening),
      momentumMag: this.momentumMagnitude(),
      angularMag: this.angularMomentumMagnitude(),
      positions,
    };
  }
}

// ── Initial-condition generators ──────────────────────────────────────────

/** Mulberry32 seeded RNG (deterministic across runs). */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Plummer sphere (Aarseth 1974 algorithm, simplified). */
function plummerSphere(n, seed, totalMass = 1.0, scaleRadius = 1.0) {
  const rng = mulberry32(seed);
  const out = [];
  const mPerBody = totalMass / n;
  for (let i = 0; i < n; i++) {
    const u = Math.max(rng() * 0.9999 + 0.0001, 1e-6);
    const r = scaleRadius / Math.sqrt(Math.pow(u, -2/3) - 1);
    const theta = Math.acos(2 * rng() - 1);
    const phi = 2 * Math.PI * rng();
    const x = r * Math.sin(theta) * Math.cos(phi);
    const y = r * Math.sin(theta) * Math.sin(phi);
    const z = r * Math.cos(theta);
    const vEsc = Math.sqrt(2) * Math.pow(r*r + scaleRadius*scaleRadius, -0.25);
    const vMag = vEsc * (0.5 + 0.5 * rng());
    const vt = Math.acos(2 * rng() - 1);
    const vp = 2 * Math.PI * rng();
    const vx = vMag * Math.sin(vt) * Math.cos(vp);
    const vy = vMag * Math.sin(vt) * Math.sin(vp);
    const vz = vMag * Math.cos(vt);
    out.push({ mass: mPerBody, pos: [x, y, z], vel: [vx, vy, vz] });
  }
  return out;
}

/** Two-body Kepler orbit (one heavy + one light, circular orbit at r=1). */
function twoBody(seed) {
  return [
    { mass: 1.0,   pos: [0, 0, 0], vel: [0, 0, 0] },
    { mass: 0.001, pos: [1, 0, 0], vel: [0, 1, 0] },
  ];
}

/** Cubic lattice with optional jitter (mirrors Scala Phase 10 lattice). */
function lattice(m, seed, totalMass = 1.0, spacing = 1.0, jitter = 0.0) {
  const rng = mulberry32(seed);
  const out = [];
  const n = m * m * m;
  const mPerBody = totalMass / n;
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < m; j++) {
      for (let k = 0; k < m; k++) {
        const jx = jitter > 0 ? (rng() - 0.5) * 2 * jitter : 0;
        const jy = jitter > 0 ? (rng() - 0.5) * 2 * jitter : 0;
        const jz = jitter > 0 ? (rng() - 0.5) * 2 * jitter : 0;
        out.push({
          mass: mPerBody,
          pos: [(i + jx) * spacing, (j + jy) * spacing, (k + jz) * spacing],
          vel: [0, 0, 0],
        });
      }
    }
  }
  return out;
}

/** Dispatch to the right generator by type. */
function generateInitialConditions(type, n, seed) {
  switch (type) {
    case 'plummer':  return plummerSphere(n, seed);
    case 'lattice': {
      const m = Math.max(1, Math.floor(Math.cbrt(n)));
      return lattice(m, seed);
    }
    case 'two-body': return twoBody(seed);
    default: throw new Error(`Unknown generator type: ${type}`);
  }
}

// Expose to global scope
window.NBodyPhysics = {
  MutableBodySystem,
  plummerSphere, twoBody, lattice, generateInitialConditions,
};
