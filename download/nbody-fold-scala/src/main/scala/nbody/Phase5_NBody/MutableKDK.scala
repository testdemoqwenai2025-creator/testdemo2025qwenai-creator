// ============================================================================
// MutableKDK.scala — Mutable-array KDK leapfrog step (hot-path optimization)
// ============================================================================
// Phase 5 performance optimization.
//
// The immutable Vector[Body] approach in Integrator.scala is correct and
// readable but too slow for production runs: each step allocates ~30 objects
// (Body copies, Vec3 instances, Vector builders) which the JVM interpreter
// and C1 JIT handle poorly. On a 2-body system this gives ~300ms/step in
// interpreted mode — making even a 200-step warmup take 60+ seconds.
//
// This object provides the SAME KDK algorithm but operates on flat
// Array[Double] buffers internally. The conversion from/to Vector[Body]
// happens ONCE per step (not per pair operation), and the hot loop has
// ZERO allocations — just primitive arithmetic on array slots.
//
// The public API is identical to what Integrator.kdkStep provides:
//   Vector[Body] → Vector[Body]
//
// But internally:
//   1. Extract px, py, pz, vx, vy, vz, mass into Array[Double] (one-time)
//   2. Run KDK on the arrays (zero allocations in the hot loop)
//   3. Reconstruct Vector[Body] from the updated arrays (one-time)
//
// This is the standard approach for all production N-body codes (GADGET,
// AREPO, REBOUND, etc.) — the integration loop always uses flat arrays,
// not immutable objects. The functional API wraps the mutable core.
// ============================================================================

package nbody.Phase5_NBody

import nbody.Phase0_Domain.*

object MutableKDK:

  // ── Single KDK step on Vector[Body] using internal mutable arrays ──────
  def step(bodies: Vector[Body], dt: Double, softening: Double): Vector[Body] =
    val n = bodies.length
    if n == 0 then return bodies

    // 1. Extract into flat arrays (one-time cost per step)
    val px  = new Array[Double](n)
    val py  = new Array[Double](n)
    val pz  = new Array[Double](n)
    val vx  = new Array[Double](n)
    val vy  = new Array[Double](n)
    val vz  = new Array[Double](n)
    val mass = new Array[Double](n)
    val ax  = new Array[Double](n)
    val ay  = new Array[Double](n)
    val az  = new Array[Double](n)
    val ids = new Array[Long](n)

    var i = 0
    while i < n do
      val b = bodies(i)
      px(i)   = b.pos.x
      py(i)   = b.pos.y
      pz(i)   = b.pos.z
      vx(i)   = b.vel.x
      vy(i)   = b.vel.y
      vz(i)   = b.vel.z
      mass(i) = b.mass.value
      ids(i)  = b.id
      i += 1

    // 2. Compute accelerations at time t (O(N²), zero allocations)
    computeAccel(px, py, pz, mass, ax, ay, az, n, softening)

    // 3. KDK leapfrog step on flat arrays
    val halfDt = dt / 2.0

    // KICK (half step): v += a * dt/2
    i = 0
    while i < n do
      vx(i) += ax(i) * halfDt
      vy(i) += ay(i) * halfDt
      vz(i) += az(i) * halfDt
      i += 1

    // DRIFT (full step): x += v * dt
    i = 0
    while i < n do
      px(i) += vx(i) * dt
      py(i) += vy(i) * dt
      pz(i) += vz(i) * dt
      i += 1

    // Recompute accelerations at t + dt
    computeAccel(px, py, pz, mass, ax, ay, az, n, softening)

    // KICK (half step): v += a(t+dt) * dt/2
    i = 0
    while i < n do
      vx(i) += ax(i) * halfDt
      vy(i) += ay(i) * halfDt
      vz(i) += az(i) * halfDt
      i += 1

    // 4. Reconstruct Vector[Body] (one-time cost per step)
    val builder = Vector.newBuilder[Body]
    i = 0
    while i < n do
      builder += Body(
        id   = ids(i),
        mass = Mass(mass(i)),
        pos  = Vec3(px(i), py(i), pz(i)),
        vel  = Vec3(vx(i), vy(i), vz(i)),
        acc  = Vec3(ax(i), ay(i), az(i))
      )
      i += 1
    builder.result()

  // ── Pairwise acceleration computation on flat arrays ───────────────────
  // O(N²), zero allocations. Uses Newton's third law to halve the work.
  // Modifies ax, ay, az in place.
  private def computeAccel(px: Array[Double], py: Array[Double], pz: Array[Double],
                           mass: Array[Double],
                           ax: Array[Double], ay: Array[Double], az: Array[Double],
                           n: Int, softening: Double): Unit =
    // Zero out acceleration arrays
    var i = 0
    while i < n do
      ax(i) = 0.0; ay(i) = 0.0; az(i) = 0.0
      i += 1

    val eps2 = softening * softening
    val G = Physics.G

    i = 0
    while i < n do
      var j = i + 1
      while j < n do
        val dx = px(j) - px(i)   // dr from i to j
        val dy = py(j) - py(i)
        val dz = pz(j) - pz(i)
        val distSq = dx * dx + dy * dy + dz * dz + eps2
        val invDist = 1.0 / math.sqrt(distSq)
        val invDist3 = invDist * invDist * invDist
        // a on i from j = G * m_j * dr / r³  (dr points from i to j → pulls i toward j)
        val factor_i = G * mass(j) * invDist3
        // a on j from i = -G * m_i * dr / r³ (equal and opposite force, different acceleration)
        val factor_j = G * mass(i) * invDist3
        ax(i) += dx * factor_i
        ay(i) += dy * factor_i
        az(i) += dz * factor_i
        ax(j) -= dx * factor_j
        ay(j) -= dy * factor_j
        az(j) -= dz * factor_j
        j += 1
      i += 1
