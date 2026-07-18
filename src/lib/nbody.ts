// ============================================================================
// src/lib/nbody.ts — N-body physics engine (TypeScript port of Scala Phase 5)
// ============================================================================
// Mirrors the nbody-fold-scala Phase 5_NBody engine:
//
//   - Newtonian gravity with G=1 and Plummer softening (1/r² → 1/(r²+ε²))
//   - Leapfrog KDK (Kick-Drift-Kick) symplectic integrator
//   - Mutable flat-array storage for zero-allocation stepping
//
// The TypeScript port is intentionally close to the Scala MutableKDK
// implementation: bodies are stored as 7 parallel Float64Arrays
// (mass, posX, posY, posZ, velX, velY, velZ) and accelerations are
// accumulated into 3 scratch Float64Arrays. The step() function performs
// one KDK leapfrog step in-place.
//
// Energy and momentum diagnostics mirror the Scala Simulator.energyDrift
// and momentumDrift functions for cross-validation.
// ============================================================================

export interface BodyInit {
  bodyId: number
  mass: number
  pos: [number, number, number]
  vel: [number, number, number]
}

export interface Snapshot {
  step: number
  energy: number
  momentumMag: number
  angularMag: number
  positions: [number, number, number][]
}

// ── MutableBodySystem ────────────────────────────────────────────────────
// Flat-array storage for the N-body system. Mutated in place by step().
// Mirrors the Scala MutableKDK class.

export class MutableBodySystem {
  readonly n: number
  // Position + velocity + mass — the persistent state
  mass: Float64Array
  posX: Float64Array
  posY: Float64Array
  posZ: Float64Array
  velX: Float64Array
  velY: Float64Array
  velZ: Float64Array
  // Acceleration scratch (re-used each step)
  accX: Float64Array
  accY: Float64Array
  accZ: Float64Array

  constructor(inits: BodyInit[]) {
    this.n = inits.length
    this.mass = new Float64Array(this.n)
    this.posX = new Float64Array(this.n)
    this.posY = new Float64Array(this.n)
    this.posZ = new Float64Array(this.n)
    this.velX = new Float64Array(this.n)
    this.velY = new Float64Array(this.n)
    this.velZ = new Float64Array(this.n)
    this.accX = new Float64Array(this.n)
    this.accY = new Float64Array(this.n)
    this.accZ = new Float64Array(this.n)
    for (let i = 0; i < this.n; i++) {
      this.mass[i] = inits[i].mass
      this.posX[i] = inits[i].pos[0]
      this.posY[i] = inits[i].pos[1]
      this.posZ[i] = inits[i].pos[2]
      this.velX[i] = inits[i].vel[0]
      this.velY[i] = inits[i].vel[1]
      this.velZ[i] = inits[i].vel[2]
    }
  }

  // ── Force computation: a_i = Σ_{j≠i} G·m_j·(r_j-r_i) / (|r|²+ε²)^(3/2) ──
  // O(N²) brute force. For small N (≤ 2000) on the web this is fine; for
  // larger N, use the Barnes-Hut or GroupAggregate solvers from the Scala
  // project (not ported here — this is the control-plane demo).
  computeAccelerations(softening: number): void {
    const { n, mass, posX, posY, posZ, accX, accY, accZ } = this
    // Zero accelerations
    accX.fill(0)
    accY.fill(0)
    accZ.fill(0)
    const eps2 = softening * softening
    const G = 1.0
    for (let i = 0; i < n; i++) {
      const xi = posX[i], yi = posY[i], zi = posZ[i]
      for (let j = i + 1; j < n; j++) {
        const dx = posX[j] - xi
        const dy = posY[j] - yi
        const dz = posZ[j] - zi
        const r2 = dx * dx + dy * dy + dz * dz + eps2
        const invR3 = 1.0 / (r2 * Math.sqrt(r2))
        const fOverR = G * invR3
        // a_i += m_j * fOverR * (r_j - r_i)
        const fxij = fOverR * dx
        const fyij = fOverR * dy
        const fzij = fOverR * dz
        const mj = mass[j]
        accX[i] += mj * fxij
        accY[i] += mj * fyij
        accZ[i] += mj * fzij
        // Newton's third law: a_j -= m_i * fOverR * (r_j - r_i)
        const mi = mass[i]
        accX[j] -= mi * fxij
        accY[j] -= mi * fyij
        accZ[j] -= mi * fzij
      }
    }
  }

  // ── Leapfrog KDK step ─────────────────────────────────────────────────
  // Kick(h/2) → Drift(h) → Kick(h/2). Symplectic, energy-conserving for
  // long runs. Mirrors Scala MutableKDK.step.
  step(dt: number, softening: number): void {
    const { n, mass, posX, posY, posZ, velX, velY, velZ, accX, accY, accZ } = this
    const halfDt = dt * 0.5
    // Kick (half) — v += a * dt/2 using current accelerations
    // (first call: accelerations must be initialized via computeAccelerations)
    for (let i = 0; i < n; i++) {
      velX[i] += halfDt * accX[i]
      velY[i] += halfDt * accY[i]
      velZ[i] += halfDt * accZ[i]
    }
    // Drift — x += v * dt
    for (let i = 0; i < n; i++) {
      posX[i] += dt * velX[i]
      posY[i] += dt * velY[i]
      posZ[i] += dt * velZ[i]
    }
    // Recompute accelerations at new positions
    this.computeAccelerations(softening)
    // Kick (half) — v += a * dt/2 with new accelerations
    for (let i = 0; i < n; i++) {
      velX[i] += halfDt * accX[i]
      velY[i] += halfDt * accY[i]
      velZ[i] += halfDt * accZ[i]
    }
  }

  // ── Diagnostics ───────────────────────────────────────────────────────

  totalEnergy(softening: number): number {
    const { n, mass, posX, posY, posZ, velX, velY, velZ } = this
    const eps2 = softening * softening
    let K = 0
    for (let i = 0; i < n; i++) {
      const v2 = velX[i] * velX[i] + velY[i] * velY[i] + velZ[i] * velZ[i]
      K += 0.5 * mass[i] * v2
    }
    let U = 0
    const G = 1.0
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = posX[j] - posX[i]
        const dy = posY[j] - posY[i]
        const dz = posZ[j] - posZ[i]
        const r = Math.sqrt(dx * dx + dy * dy + dz * dz + eps2)
        U -= G * mass[i] * mass[j] / r
      }
    }
    return K + U
  }

  momentumMagnitude(): number {
    const { n, mass, velX, velY, velZ } = this
    let px = 0, py = 0, pz = 0
    for (let i = 0; i < n; i++) {
      px += mass[i] * velX[i]
      py += mass[i] * velY[i]
      pz += mass[i] * velZ[i]
    }
    return Math.sqrt(px * px + py * py + pz * pz)
  }

  angularMomentumMagnitude(): number {
    const { n, mass, posX, posY, posZ, velX, velY, velZ } = this
    let lx = 0, ly = 0, lz = 0
    for (let i = 0; i < n; i++) {
      const m = mass[i]
      // L = r × p = m * (r × v)
      const rxpx = posY[i] * velZ[i] - posZ[i] * velY[i]
      const rypy = posZ[i] * velX[i] - posX[i] * velZ[i]
      const rzpz = posX[i] * velY[i] - posY[i] * velX[i]
      lx += m * rxpx
      ly += m * rypy
      lz += m * rzpz
    }
    return Math.sqrt(lx * lx + ly * ly + lz * lz)
  }

  positions(): [number, number, number][] {
    const out: [number, number, number][] = new Array(this.n)
    for (let i = 0; i < this.n; i++) {
      out[i] = [this.posX[i], this.posY[i], this.posZ[i]]
    }
    return out
  }

  snapshot(step: number, softening: number): Snapshot {
    return {
      step,
      energy: this.totalEnergy(softening),
      momentumMag: this.momentumMagnitude(),
      angularMag: this.angularMomentumMagnitude(),
      positions: this.positions(),
    }
  }
}

// ── Initial-condition generators ─────────────────────────────────────────
// Mirror the Scala Phase 8 PlummerSphere and Phase 10 StructuredGenerators.

export type GeneratorType = 'plummer' | 'lattice' | 'two-body'

/** Seeded Plummer sphere (Aarseth 1974 algorithm, simplified). */
export function plummerSphere(n: number, seed: number, totalMass = 1.0, scaleRadius = 1.0): BodyInit[] {
  const rng = mulberry32(seed)
  const out: BodyInit[] = []
  const mPerBody = totalMass / n
  for (let i = 0; i < n; i++) {
    // Pick radius via inverse-CDF of Plummer density: r = a / sqrt(M^{-2/3} - 1)
    const u = Math.max(rng() * 0.9999 + 0.0001, 1e-6)  // avoid singularity
    const r = scaleRadius / Math.sqrt(Math.pow(u, -2 / 3) - 1)
    // Isotropic direction
    const theta = Math.acos(2 * rng() - 1)
    const phi = 2 * Math.PI * rng()
    const x = r * Math.sin(theta) * Math.cos(phi)
    const y = r * Math.sin(theta) * Math.sin(phi)
    const z = r * Math.cos(theta)
    // Velocity from Plummer isotropic distribution (simplified — sample from Maxwellian)
    const vEsc = Math.sqrt(2) * Math.pow(r * r + scaleRadius * scaleRadius, -0.25)
    const vMag = vEsc * (0.5 + 0.5 * rng())  // simplified — not exact Plummer CDF
    const vt = Math.acos(2 * rng() - 1)
    const vp = 2 * Math.PI * rng()
    const vx = vMag * Math.sin(vt) * Math.cos(vp)
    const vy = vMag * Math.sin(vt) * Math.sin(vp)
    const vz = vMag * Math.cos(vt)
    out.push({
      bodyId: i + 1,
      mass: mPerBody,
      pos: [x, y, z],
      vel: [vx, vy, vz],
    })
  }
  return out
}

/** Two-body Kepler orbit (one heavy + one light, circular orbit). */
export function twoBody(seed: number): BodyInit[] {
  // G=1, M=1, r=1, v_circular = sqrt(G*M/r) = 1
  return [
    { bodyId: 1, mass: 1.0, pos: [0, 0, 0], vel: [0, 0, 0] },
    { bodyId: 2, mass: 0.001, pos: [1, 0, 0], vel: [0, 1, 0] },
  ]
}

/** Cubic lattice (mirrors Scala Phase 10 StructuredGenerators.lattice). */
export function lattice(m: number, seed: number, totalMass = 1.0, spacing = 1.0, jitter = 0.0): BodyInit[] {
  const rng = mulberry32(seed)
  const out: BodyInit[] = []
  const n = m * m * m
  const mPerBody = totalMass / n
  let id = 1
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < m; j++) {
      for (let k = 0; k < m; k++) {
        const jx = jitter > 0 ? (rng() - 0.5) * 2 * jitter : 0
        const jy = jitter > 0 ? (rng() - 0.5) * 2 * jitter : 0
        const jz = jitter > 0 ? (rng() - 0.5) * 2 * jitter : 0
        out.push({
          bodyId: id++,
          mass: mPerBody,
          pos: [(i + jx) * spacing, (j + jy) * spacing, (k + jz) * spacing],
          vel: [0, 0, 0],
        })
      }
    }
  }
  return out
}

/** Mulberry32 seeded RNG (deterministic across runs). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6D2B79F5) | 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Parse generator params from the API request body. */
export function generateInitialConditions(
  type: GeneratorType,
  n: number,
  seed: number,
): BodyInit[] {
  switch (type) {
    case 'plummer':
      return plummerSphere(n, seed)
    case 'lattice':
      // Round n down to nearest perfect cube: m = floor(cbrt(n))
      const m = Math.max(1, Math.floor(Math.cbrt(n)))
      return lattice(m, seed)
    case 'two-body':
      return twoBody(seed)
    default:
      throw new Error(`Unknown generator type: ${type}`)
  }
}
