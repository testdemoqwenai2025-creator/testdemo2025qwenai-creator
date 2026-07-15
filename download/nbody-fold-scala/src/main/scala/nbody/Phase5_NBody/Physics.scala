// ============================================================================
// Physics.scala — Newtonian gravitational force with softening
// ============================================================================
// Phase 5 deliverable per skills.md §2 Phase 5.
//
// Newton's law of gravitation:
//   F = G * m_a * m_b * (r_b - r_a) / |r_b - r_a|³
//
// With Plummer softening ε to avoid the singularity at r → 0:
//   F = G * m_a * m_b * (r_b - r_a) / (|r_b - r_a|² + ε²)^(3/2)
//
// The softening ε is a small positive length that prevents infinite forces
// when two bodies are at the same position. It also models extended mass
// distributions (a body within ε of another feels a softened, finite pull).
// Typical choice: ε ≈ mean inter-particle spacing.
//
// Units: G = 1 (natural units, matching System.scala's convention).
// This is standard for N-body simulations — the absolute scale of G only
// matters when comparing to physical observations, not for internal
// consistency checks like energy conservation.
//
// Force on body A from body B (vector pointing from A toward B):
//   F_AB = G * m_a * m_b * dr / (|dr|² + ε²)^(3/2)
// where dr = r_b - r_a
//
// Acceleration on body A from body B (force divided by m_a):
//   a_AB = G * m_b * dr / (|dr|² + ε²)^(3/2)
//
// Pairwise computation: F_AB = -F_BA (Newton's third law). The Simulator
// exploits this to halve the work — for each unordered pair (i, j), add
// a_ij to body i and subtract a_ji from body j (where a_ij = -a_ji because
// the masses differ but the direction reverses).
// ============================================================================

package nbody.Phase5_NBody

import nbody.Phase0_Domain.*

object Physics:

  // Gravitational constant — natural units (G = 1) matching System.scala
  val G: Double = 1.0

  // Default softening — small enough not to affect Kepler tests, large
  // enough to prevent NaN on close encounters. Phase 9 will tune this.
  val DefaultSoftening: Double = 1.0e-6

  // ── Pairwise force: F on body A from body B ─────────────────────────────
  // Vector pointing FROM a TOWARD b, magnitude = G * m_a * m_b / r² (softened)
  def force(a: Body, b: Body, softening: Double = DefaultSoftening): Vec3 =
    val dr      = b.pos - a.pos          // vector from a to b
    val distSq  = dr.normSq + softening * softening
    val invDist = 1.0 / math.sqrt(distSq)
    val invDist3 = invDist * invDist * invDist
    // F = G * m_a * m_b * dr / (|dr|² + ε²)^(3/2)
    dr * (G * a.mass.value * b.mass.value * invDist3)

  // ── Pairwise acceleration: a on body A from body B ─────────────────────
  // = force(a, b) / m_a = G * m_b * dr / (|dr|² + ε²)^(3/2)
  // This is what the integrator needs — accelerations, not forces.
  def accelerationOn(a: Body, b: Body, softening: Double = DefaultSoftening): Vec3 =
    val dr       = b.pos - a.pos
    val distSq   = dr.normSq + softening * softening
    val invDist  = 1.0 / math.sqrt(distSq)
    val invDist3 = invDist * invDist * invDist
    dr * (G * b.mass.value * invDist3)

  // ── Pairwise potential energy: U(a, b) = -G * m_a * m_b / r ────────────
  // Total potential of a system = sum over all UNORDERED pairs.
  // Softened: U = -G * m_a * m_b / sqrt(|dr|² + ε²)
  def potentialEnergy(a: Body, b: Body, softening: Double = DefaultSoftening): Double =
    val dr      = b.pos - a.pos
    val distSq  = dr.normSq + softening * softening
    val r       = math.sqrt(distSq)
    -G * a.mass.value * b.mass.value / r

  // ── Kinetic energy of a single body: ½ m v² ────────────────────────────
  def kineticEnergy(b: Body): Double = b.kineticEnergy  // delegate to Body

  // ── Total acceleration on body A from a collection of OTHER bodies ─────
  // This is the core of the O(N²) force computation: for each body, sum
  // the acceleration contributions from all other bodies.
  // Used by the Simulator's pairwise force loop.
  def totalAccelerationOn(a: Body, others: Vector[Body],
                          softening: Double = DefaultSoftening): Vec3 =
    // Imperative loop for performance — avoids Vector allocation per pair
    var ax = 0.0
    var ay = 0.0
    var az = 0.0
    val n = others.length
    var i = 0
    while i < n do
      val b = others(i)
      // Skip self-interaction (a body doesn't gravitate itself)
      if b.id != a.id then
        val dr      = b.pos - a.pos
        val distSq  = dr.normSq + softening * softening
        val invDist = 1.0 / math.sqrt(distSq)
        val invDist3 = invDist * invDist * invDist
        val factor  = G * b.mass.value * invDist3
        ax += dr.x * factor
        ay += dr.y * factor
        az += dr.z * factor
      i += 1
    Vec3(ax, ay, az)

  // ── Compute accelerations for ALL bodies (pairwise, O(N²)) ─────────────
  // Returns a Vector[Vec3] of accelerations, indexed the same as the input.
  // Uses Newton's third law to halve the work: for each unordered pair
  // (i, j), add a_ij to body i and -a_ji * (m_j / m_i) to body j.
  // Wait — that's wrong. Let me think again.
  //
  // Actually Newton's third law says F_ij = -F_ji (forces are equal and
  // opposite). So a_ij = F_ij / m_i and a_ji = F_ji / m_j = -F_ij / m_j.
  // The accelerations are NOT equal and opposite (unless m_i == m_j);
  // only the forces are.
  //
  // For the halving optimization we compute the FORCE once per pair and
  // then add a = F/m to each body. This avoids recomputing the softened
  // distance twice. The function below implements this.
  def computeAccelerations(bodies: Vector[Body],
                           softening: Double = DefaultSoftening): Vector[Vec3] =
    val n = bodies.length
    val accs = new Array[Vec3](n)
    var i = 0
    while i < n do accs(i) = Vec3.Zero; i += 1
    i = 0
    while i < n do
      var j = i + 1
      while j < n do
        val a = bodies(i)
        val b = bodies(j)
        val dr      = b.pos - a.pos
        val distSq  = dr.normSq + softening * softening
        val invDist = 1.0 / math.sqrt(distSq)
        val invDist3 = invDist * invDist * invDist
        // F on i from j = G * m_i * m_j * dr / r³  (dr points from i to j)
        val Fmag = G * a.mass.value * b.mass.value * invDist3
        val F = dr * Fmag
        // a on i from j = F / m_i  →  dr * (G * m_j * invDist3)
        // a on j from i = -F / m_j →  dr * (-G * m_i * invDist3)
        accs(i) = accs(i) + dr * (G * b.mass.value * invDist3)
        accs(j) = accs(j) - dr * (G * a.mass.value * invDist3)
        j += 1
      i += 1
    // Convert Array[Vec3] to Vector[Vec3]
    var result = Vector.newBuilder[Vec3]
    i = 0
    while i < n do result += accs(i); i += 1
    result.result()

  // ── Total potential energy of a body collection ────────────────────────
  // Sum over unordered pairs. Matches System.potentialEnergy but exposed
  // here as a utility for arbitrary body collections.
  def totalPotentialEnergy(bodies: Vector[Body],
                           softening: Double = DefaultSoftening): Double =
    val n = bodies.length
    var sum = 0.0
    var i = 0
    while i < n do
      var j = i + 1
      while j < n do
        sum += potentialEnergy(bodies(i), bodies(j), softening)
        j += 1
      i += 1
    sum
