// ============================================================================
// PlummerSphere.scala — Plummer model initial-conditions generator
// ============================================================================
// Phase 8 deliverable per skills.md §2 Phase 8 (PlummerSphereTest).
//
// The Plummer model is the standard test case for N-body codes. Its density
// profile is:
//
//   ρ(r) = (M / (4π a³)) × (1 + (r/a)²)^(-5/2)
//
// where M is the total mass and a is the Plummer radius (scale length). The
// corresponding potential is:
//
//   Φ(r) = -G M / sqrt(r² + a²)
//
// The cumulative mass distribution gives a closed-form inverse CDF for the
// radius, which we use to sample positions. Velocities are sampled via the
// rejection method from the Plummer velocity distribution.
//
// VIRIAL THEOREM: for a self-gravitating system in equilibrium, 2K + U = 0,
// where K is total kinetic energy and U is total potential energy. Thus:
//   2K / |U| = 1.0
// The Plummer model is an equilibrium solution, so a freshly-generated Plummer
// sphere should satisfy this ratio (within sampling noise for finite N).
//
// ALGORITHM (Aarseth, Henon, Wielen 1974):
//   1. Sample radius r from the inverse CDF:
//        u ~ Uniform(0,1)
//        r = a / sqrt(u^(-2/3) - 1)
//   2. Sample position on the unit sphere (isotropic):
//        Random direction via three Gaussian-normalized coordinates
//   3. Sample speed via rejection:
//        q = |v| / v_esc(r),  where v_esc(r) = sqrt(2 G M) × (1 + (r/a)²)^(-1/4)
//        g(q) = q² (1 - q²)^(5/2)  for 0 ≤ q ≤ 1
//        Rejection: sample q uniform in [0,1], g_uniform in [0, g_max],
//        accept if g(q) > g_uniform
//   4. Random velocity direction (isotropic)
//
// REPRODUCIBILITY: uses a seeded java.util.Random so the same seed always
// produces the same bodies (Definition of Done #2: "Same initial conditions
// + same seed ⇒ bit-identical trajectories").
// ============================================================================

package nbody.Phase8_Verify

import java.util.Random
import nbody.Phase0_Domain.*

object PlummerSphere:

  /** Generate a Plummer sphere of N bodies.
    *
    * @param n number of bodies
    * @param totalMass total mass of the sphere (default 1.0; in natural units G=1)
    * @param plummerRadius scale length a (default 1.0)
    * @param seed random seed for reproducibility
    * @return Vector[Body] with positions and velocities drawn from the
    *         Plummer distribution, IDs assigned 1..n
    */
  def generate(n: Int, totalMass: Double = 1.0, plummerRadius: Double = 1.0,
               seed: Long = 42L): Vector[Body] =
    require(n > 0, s"n must be > 0, got $n")
    require(totalMass > 0, s"totalMass must be > 0, got $totalMass")
    require(plummerRadius > 0, s"plummerRadius must be > 0, got $plummerRadius")
    val rng = new Random(seed)
    val a = plummerRadius
    val M = totalMass
    val G = 1.0  // natural units
    val perBodyMass = M / n.toDouble

    Vector.tabulate(n) { i =>
      // 1. Sample radius via inverse CDF: r = a / sqrt(u^(-2/3) - 1)
      val u = rng.nextDouble()
      val r = a / math.sqrt(math.pow(u, -2.0 / 3.0) - 1.0)

      // 2. Sample isotropic position: pick a random point on the unit sphere
      //    via three Gaussian-normalized coordinates (Marsaglia method)
      var (x1, x2, x3) = (0.0, 0.0, 0.0)
      var s = 0.0
      while s >= 1.0 || s == 0.0 do
        x1 = rng.nextGaussian()
        x2 = rng.nextGaussian()
        x3 = rng.nextGaussian()
        s = x1 * x1 + x2 * x2 + x3 * x3
      val norm = r / math.sqrt(s)
      val pos = Vec3(x1 * norm, x2 * norm, x3 * norm)

      // 3. Sample speed via rejection method
      //    v_esc(r) = sqrt(2 G M) × (1 + (r/a)²)^(-1/4)
      val rOverA = r / a
      val vEsc = math.sqrt(2.0 * G * M) * math.pow(1.0 + rOverA * rOverA, -0.25)

      // The Plummer model's velocity distribution (Aarseth, Henon, Wielen 1974):
      //   g(q) = q² (1 - q²)^(7/2)   for 0 ≤ q ≤ 1,  where q = v / v_esc
      // The exponent 7/2 (not 5/2) is specific to the Plummer model's
      // distribution function. The maximum of g(q) is at q_opt = sqrt(2/9).
      //
      // Derivation: dg/dq = 2q(1-q²)^(7/2) + q²×(7/2)(1-q²)^(5/2)×(-2q) = 0
      //   → 2(1-q²) = 7q²  →  q² = 2/9  →  q_opt = sqrt(2/9) ≈ 0.4714
      val exponent = 3.5   // 7/2
      val qOpt = math.sqrt(2.0 / 9.0)
      val gMax = qOpt * qOpt * math.pow(1.0 - qOpt * qOpt, exponent)

      var q = 0.0
      var accepted = false
      while !accepted do
        val qTry = rng.nextDouble()  // uniform in [0,1)
        val gTry = rng.nextDouble() * gMax
        val gVal = qTry * qTry * math.pow(1.0 - qTry * qTry, exponent)
        if gVal > gTry then
          q = qTry
          accepted = true

      val speed = q * vEsc

      // 4. Sample isotropic velocity direction (same Marsaglia method)
      var (v1, v2, v3) = (0.0, 0.0, 0.0)
      var sv = 0.0
      while sv >= 1.0 || sv == 0.0 do
        v1 = rng.nextGaussian()
        v2 = rng.nextGaussian()
        v3 = rng.nextGaussian()
        sv = v1 * v1 + v2 * v2 + v3 * v3
      val vnorm = speed / math.sqrt(sv)
      val vel = Vec3(v1 * vnorm, v2 * vnorm, v3 * vnorm)

      Body(
        id = (i + 1).toLong,
        mass = Mass(perBodyMass),
        pos = pos,
        vel = vel
      )
    }

  /** Compute the virial ratio 2K / |U| for a system of bodies.
    * For a system in virial equilibrium, this should be ≈ 1.0.
    *
    * K = Σ ½ m_i v_i²  (total kinetic energy)
    * U = -Σ_{i<j} G m_i m_j / r_ij  (total potential energy, negative)
    * |U| = -U  (magnitude of potential energy)
    *
    * @param bodies the body collection
    * @param softening Plummer softening for the potential (default 0)
    * @return 2K / |U| (should be ≈ 1.0 for equilibrium)
    */
  def virialRatio(bodies: Vector[Body], softening: Double = 0.0): Double =
    val G = 1.0
    // Kinetic energy
    val K = bodies.foldLeft(0.0) { (acc, b) => acc + b.kineticEnergy }
    // Potential energy (sum over unordered pairs)
    var U = 0.0
    val n = bodies.length
    var i = 0
    while i < n do
      var j = i + 1
      while j < n do
        val dr = bodies(i).pos - bodies(j).pos
        val r = math.sqrt(dr.normSq + softening * softening)
        U -= G * bodies(i).mass.value * bodies(j).mass.value / r
        j += 1
      i += 1
    // Virial ratio: 2K / |U|
    if U == 0.0 then Double.PositiveInfinity
    else 2.0 * K / math.abs(U)
