// ============================================================================
// Integrator.scala — Leapfrog (KDK) symplectic integrator
// ============================================================================
// Phase 5 deliverable per skills.md §2 Phase 5.
//
// The leapfrog integrator is the workhorse of N-body simulation because it
// is SYMPLECTIC — it preserves the geometric structure of Hamiltonian
// dynamics, which means total energy drifts BOUNDED (oscillates around the
// true value) rather than accumulating secularly. Non-symplectic integrators
// like Runge-Kutta 4 have unbounded energy drift over long runs.
//
// The Kick-Drift-Kick (KDK) form is the most common variant:
//
//   1. KICK (half step):   v(t + dt/2)  = v(t) + a(t) * (dt/2)
//   2. DRIFT (full step):  x(t + dt)    = x(t) + v(t + dt/2) * dt
//   3. KICK (half step):   v(t + dt)    = v(t + dt/2) + a(t + dt) * (dt/2)
//
// where a(t) is the gravitational acceleration at time t (computed from
// positions x(t)) and a(t+dt) is recomputed from positions x(t+dt).
//
// Per-step cost: 2 force evaluations (one before step 1, one before step 3).
// But KDK reuses a(t) from the PREVIOUS step's final kick — so in steady
// state the cost is 1 force evaluation per step (amortized).
//
// This file provides the primitive operations; the Simulator orchestrates
// them into a full step. The split lets us test each piece in isolation.
//
// Reference: Hut & Makino 2003, "Moving Stars Around". The KDK form is
// also called the "Stormer-Verlet" method in the molecular-dynamics
// literature.
// ============================================================================

package nbody.Phase5_NBody

import nbody.Phase0_Domain.*

object Integrator:

  // ── KICK: update velocities by a * (dt/2) ──────────────────────────────
  // Pure function — returns a new Vector[Body] with updated velocities.
  // The acceleration Vector must be indexed the same as the bodies Vector.
  def kick(bodies: Vector[Body], accs: Vector[Vec3], halfDt: Double): Vector[Body] =
    require(bodies.length == accs.length,
      s"kick: bodies.length (${bodies.length}) != accs.length (${accs.length})")
    bodies.zip(accs).map { case (b, a) =>
      b.withVel(b.vel + a * halfDt)
    }

  // ── DRIFT: update positions by v * dt ──────────────────────────────────
  // Pure function — returns a new Vector[Body] with updated positions.
  def drift(bodies: Vector[Body], dt: Double): Vector[Body] =
    bodies.map(b => b.withPos(b.pos + b.vel * dt))

  // ── Full KDK step (orchestrates kick-drift-kick) ───────────────────────
  // Given bodies at time t with accelerations a(t), produce bodies at time
  // t + dt. The caller must supply the acceleration function `accFn` that
  // maps a Vector[Body] to a Vector[Vec3] of accelerations (typically
  // Physics.computeAccelerations).
  //
  // This is the high-level entry point. The Simulator wraps it with
  // hierarchy management.
  def kdkStep(bodies: Vector[Body],
              accsAtT: Vector[Vec3],
              accFn: Vector[Body] => Vector[Vec3],
              dt: Double): Vector[Body] =
    val halfDt = dt / 2.0
    // 1. KICK (half step using a(t))
    val kicked1 = kick(bodies, accsAtT, halfDt)
    // 2. DRIFT (full step using v(t + dt/2))
    val drifted = drift(kicked1, dt)
    // 3. Recompute accelerations at new positions → a(t + dt)
    val accsAtTdt = accFn(drifted)
    // 4. KICK (half step using a(t + dt))
    kick(drifted, accsAtTdt, halfDt)
