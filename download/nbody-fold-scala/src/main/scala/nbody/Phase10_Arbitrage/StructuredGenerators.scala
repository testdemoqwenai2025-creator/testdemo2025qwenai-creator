// ============================================================================
// StructuredGenerators.scala — Initial-condition generators for structured data
// ============================================================================
// Phase 10 deliverable.
//
// Phase 9 benchmarked the four solvers (BruteForce / BarnesHut / Fold+RLE /
// Fold+DoubleRLE) on Plummer spheres — an IRREGULAR distribution where every
// grid cell ends up with a distinct (count, mass) signature, so RLE on the
// cell list compresses 1:1. Phase 9's ScientificReport §4 documented this
// honestly: "DoD #3 (≥5× speedup vs BruteForce at N=10k) NOT MET on Plummer
// data … The 5× target is achievable on structured data where RLE
// compression is effective."
//
// This file provides those structured distributions:
//
//   • lattice(n)         — perfect cubic lattice, n = m³ bodies at integer
//                          sites. Every cell has (count=1, mass=1/N) →
//                          RLE on the signature list compresses to 1 run
//                          (N× compression).
//
//   • concentricShells(nShells, k) — nShells spherical shells, k bodies per
//                          shell distributed via the Fibonacci spiral.
//                          Bodies on the same shell have (count=1, mass=1/N)
//                          → moderate compression depending on grid sizing.
//
//   • bccCrystal(n)      — body-centered cubic: 2 bodies per cell at the
//                          (0,0,0) and (½,½,½) sublattice sites. Every cell
//                          has (count=2, mass=2/N) → 1 run for the entire
//                          crystal.
//
// All generators are SEEDED (java.util.Random) for reproducibility per
// Definition of Done #2.
//
// The `lattice` and `bccCrystal` generators can optionally apply a small
// `jitter` to body positions — this preserves the (count, mass) signature
// uniformity (each cell still has the same number of bodies) while breaking
// the perfect symmetry that would otherwise make the far-field force on
// every interior lattice site exactly zero. Jitter is what makes the
// simulation non-trivial: with jitter, bodies actually evolve.
// ============================================================================

package nbody.Phase10_Arbitrage

import java.util.Random
import nbody.Phase0_Domain.*

object StructuredGenerators:

  // ── Cubic lattice ──────────────────────────────────────────────────────
  /** Generate a perfect cubic lattice of m × m × m bodies, where m = ∛n.
    *
    * Bodies are placed at integer lattice sites centered at the origin:
    *   site (i, j, k) → position ((i - (m-1)/2) × spacing, ...)
    *
    * @param n           total body count, must be a perfect cube (8, 27,
    *                    64, 125, …, 4096, 8000, 10648, …)
    * @param totalMass   total mass of the system (default 1.0)
    * @param spacing     lattice constant a (default 1.0)
    * @param jitter      max random displacement applied to each body
    *                    (default 0.0 — perfect lattice). Set to ~0.05×a for
    *                    a thermal-perturbation lattice that actually evolves.
    * @param seed        RNG seed for jitter
    * @return Vector[Body] of length n, IDs 1..n, all with equal mass
    */
  def lattice(n: Int, totalMass: Double = 1.0, spacing: Double = 1.0,
              jitter: Double = 0.0, seed: Long = 42L): Vector[Body] =
    require(n > 0, s"n must be > 0, got $n")
    val m = math.round(math.cbrt(n.toDouble)).toInt
    require(m * m * m == n,
      s"n must be a perfect cube, got $n (nearest cbrt=$m, m³=${m*m*m})")
    val rng = new Random(seed)
    val perBodyMass = totalMass / n.toDouble
    val half = (m - 1) / 2.0
    Vector.tabulate(n) { i =>
      val ix = i % m
      val iy = (i / m) % m
      val iz = i / (m * m)
      val jx = if jitter > 0 then (rng.nextDouble() - 0.5) * jitter else 0.0
      val jy = if jitter > 0 then (rng.nextDouble() - 0.5) * jitter else 0.0
      val jz = if jitter > 0 then (rng.nextDouble() - 0.5) * jitter else 0.0
      val pos = Vec3(
        (ix - half) * spacing + jx,
        (iy - half) * spacing + jy,
        (iz - half) * spacing + jz
      )
      Body(
        id   = (i + 1).toLong,
        mass = Mass(perBodyMass),
        pos  = pos,
        vel  = Vec3.Zero
      )
    }

  // ── Concentric spherical shells (Fibonacci spiral) ─────────────────────
  /** Generate `nShells` concentric spherical shells, each with `k` bodies
    * distributed via the Fibonacci spiral (uniform area distribution on
    * the sphere).
    *
    * The Fibonacci spiral gives better uniformity than random sampling for
    * small k (≤ 1000), and it's deterministic (no RNG needed for the
    * positions themselves).
    *
    * @param nShells     number of shells
    * @param bodiesPerShell bodies per shell (k)
    * @param totalMass   total mass
    * @param shellSpacing radial spacing between shells (default 1.0)
    * @return Vector[Body] of length nShells × bodiesPerShell
    */
  def concentricShells(nShells: Int, bodiesPerShell: Int,
                        totalMass: Double = 1.0,
                        shellSpacing: Double = 1.0): Vector[Body] =
    require(nShells > 0, s"nShells must be > 0, got $nShells")
    require(bodiesPerShell > 0, s"bodiesPerShell must be > 0, got $bodiesPerShell")
    val n = nShells * bodiesPerShell
    val perBodyMass = totalMass / n.toDouble
    val builder = Vector.newBuilder[Body]
    var id = 1L
    val goldenAngle = math.Pi * (3.0 - math.sqrt(5.0))
    var s = 0
    while s < nShells do
      val r = (s + 1) * shellSpacing
      var b = 0
      while b < bodiesPerShell do
        // Fibonacci sphere: y goes from 1 to -1, theta advances by golden angle
        val y = if bodiesPerShell == 1 then 0.0
                else 1.0 - 2.0 * b.toDouble / (bodiesPerShell - 1)
        val radius = math.sqrt(math.max(0.0, 1.0 - y * y))
        val theta = goldenAngle * b
        val pos = Vec3(
          r * math.cos(theta) * radius,
          r * y,
          r * math.sin(theta) * radius
        )
        builder += Body(id, Mass(perBodyMass), pos, Vec3.Zero)
        id += 1
        b += 1
      s += 1
    builder.result()

  // ── Body-centered cubic (BCC) crystal ──────────────────────────────────
  /** Generate a BCC crystal: 2 bodies per unit cell at sublattice sites
    * (0,0,0) and (½,½,½). Total body count n = 2 m³ where m is the number
    * of unit cells per side.
    *
    * BCC is the crystal structure of α-iron, tungsten, chromium, and many
    * refractory metals. It's a natural test case for "structured data with
    * non-trivial sub-cell structure" — every cell has (count=2, mass=2/N),
    * so the RLE on (count, mass) signatures compresses to 1 run for the
    * entire crystal.
    *
    * @param m  number of unit cells per side (n = 2 m³)
    * @param totalMass total mass
    * @param spacing   lattice constant a (default 1.0)
    * @param jitter    max random displacement (default 0.0)
    * @param seed      RNG seed
    */
  def bccCrystal(m: Int, totalMass: Double = 1.0, spacing: Double = 1.0,
                 jitter: Double = 0.0, seed: Long = 42L): Vector[Body] =
    require(m > 0, s"m must be > 0, got $m")
    val n = 2 * m * m * m
    val rng = new Random(seed)
    val perBodyMass = totalMass / n.toDouble
    val half = (m - 1) / 2.0
    val builder = Vector.newBuilder[Body]
    var id = 1L
    var iz = 0
    while iz < m do
      var iy = 0
      while iy < m do
        var ix = 0
        while ix < m do
          // Two sublattice sites per unit cell
          val baseX = (ix - half) * spacing
          val baseY = (iy - half) * spacing
          val baseZ = (iz - half) * spacing
          val jx0 = if jitter > 0 then (rng.nextDouble() - 0.5) * jitter else 0.0
          val jy0 = if jitter > 0 then (rng.nextDouble() - 0.5) * jitter else 0.0
          val jz0 = if jitter > 0 then (rng.nextDouble() - 0.5) * jitter else 0.0
          val jx1 = if jitter > 0 then (rng.nextDouble() - 0.5) * jitter else 0.0
          val jy1 = if jitter > 0 then (rng.nextDouble() - 0.5) * jitter else 0.0
          val jz1 = if jitter > 0 then (rng.nextDouble() - 0.5) * jitter else 0.0
          builder += Body(
            id   = id,
            mass = Mass(perBodyMass),
            pos  = Vec3(baseX + jx0, baseY + jy0, baseZ + jz0),
            vel  = Vec3.Zero
          )
          id += 1
          builder += Body(
            id   = id,
            mass = Mass(perBodyMass),
            pos  = Vec3(baseX + spacing * 0.5 + jx1,
                        baseY + spacing * 0.5 + jy1,
                        baseZ + spacing * 0.5 + jz1),
            vel  = Vec3.Zero
          )
          id += 1
          ix += 1
        iy += 1
      iz += 1
    builder.result()

  // ── Helper: nearest-perfect-cube lookup ────────────────────────────────
  /** For a target N, return the largest perfect cube ≤ N. Useful for
    * sizing lattice benchmarks. */
  def nearestCubeBelow(n: Int): Int =
    val m = math.floor(math.cbrt(n.toDouble)).toInt
    m * m * m

  /** For a target N, return the smallest perfect cube ≥ N. */
  def nearestCubeAbove(n: Int): Int =
    val m = math.ceil(math.cbrt(n.toDouble)).toInt
    m * m * m
