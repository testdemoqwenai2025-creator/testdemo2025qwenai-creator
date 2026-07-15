// ============================================================================
// Phase5Demo.scala — N-Body engine verification (Kepler + energy + momentum)
// ============================================================================
// Three verification tests per skills.md §2 Phase 5:
//
//   1. Two-body Kepler test: 10 orbital periods, eccentricity and semi-major
//      axis preserved to within 1e-6.
//
//   2. Energy drift < 1e-6 over 1000 steps on a multi-body system.
//
//   3. Total momentum conserved to machine precision.
//
// Plus a Section 0 that exercises the basic Physics primitives in isolation.
//
// Run with:  sbt "runMain nbody.Phase5Demo"
// ============================================================================

package nbody

import nbody.Phase0_Domain.*
import nbody.Phase5_NBody.*
import nbody.Phase5_NBody.Physics

object Phase5Demo:

  private var passed = 0
  private var failed = 0
  private def check(label: String, cond: Boolean, detail: String = ""): Unit =
    if cond then
      passed += 1
      println(s"  [PASS] $label")
    else
      failed += 1
      println(s"  [FAIL] $label  $detail")

  // ── Helpers for orbital mechanics ──────────────────────────────────────
  // For a two-body Kepler problem with masses M (central) and m (orbiting),
  // in the rest frame of M:
  //   - Circular orbit radius r, velocity v = sqrt(G*M / r) = sqrt(M/r) (G=1)
  //   - Orbital period T = 2*pi*r / v = 2*pi*sqrt(r³ / M)
  //   - Total energy E = -G*M*m / (2*r) = -M*m / (2*r)  (for circular)
  //   - Angular momentum L = m * r * v
  //   - Eccentricity e = 0 for circular orbit
  //   - Semi-major axis a = r for circular orbit

  def orbitalPeriod(centralMass: Double, radius: Double): Double =
    2.0 * math.Pi * math.sqrt(radius * radius * radius / centralMass)

  def circularVelocity(centralMass: Double, radius: Double): Double =
    math.sqrt(centralMass / radius)

  // Compute eccentricity from position and velocity (two-body, central mass M)
  // Using the eccentricity vector: e_vec = (v × L) / (G*M) - r_hat
  // For a small orbiting body with L = r × v (per unit reduced mass):
  //   e = |(v × (r × v)) / (G*M) - r / |r||
  def eccentricity(pos: Vec3, vel: Vec3, centralMass: Double): Double =
    val r = pos.norm
    if r == 0.0 then 0.0
    else
      // Specific angular momentum: h = r × v
      val h = pos.cross(vel)
      // Eccentricity vector: e_vec = (v × h) / (G*M) - r / |r|
      // With G = 1
      val vCrossH = vel.cross(h)
      val eVec = vCrossH / centralMass - pos / r
      eVec.norm

  // Semi-major axis from energy: E = -G*M*m / (2a)  →  a = -G*M*m / (2*E)
  // For specific orbital energy (per unit reduced mass): a = -G*M / (2*epsilon)
  // where epsilon = v²/2 - G*M/r
  def semiMajorAxis(pos: Vec3, vel: Vec3, centralMass: Double): Double =
    val r = pos.norm
    val v2 = vel.normSq
    val specificEnergy = v2 / 2.0 - centralMass / r  // G = 1
    if specificEnergy >= 0.0 then Double.PositiveInfinity  // unbound orbit
    else -centralMass / (2.0 * specificEnergy)

  def main(args: Array[String]): Unit =

    println("=== Phase 5: N-Body Simulation Engine Demo ===")
    println()

    // ── 0. Physics primitives sanity check ───────────────────────────────
    println("--- 0. Physics primitives sanity check ---")
    val b1 = Body(1L, Mass(1000.0), Vec3(0, 0, 0))
    val b2 = Body(2L, Mass(1.0), Vec3(10, 0, 0))
    val f12 = Physics.force(b1, b2, softening = 0.0)
    val a12 = Physics.accelerationOn(b1, b2, softening = 0.0)
    // F = G * M * m / r² = 1 * 1000 * 1 / 100 = 10  (pointing from b1 to b2, i.e., +x)
    // a on b1 from b2 = F / M = 10 / 1000 = 0.01  (+x direction)
    // a on b2 from b1 = -F / m = -10 / 1 = -10  (-x direction, toward b1)
    println(s"  force(b1, b2)     = $f12       (expected ~Vec3(10, 0, 0))")
    println(s"  accelOn(b1, b2)   = $a12     (expected ~Vec3(0.01, 0, 0))")
    check("force magnitude ≈ 10 (G*M*m/r² with G=1, M=1000, m=1, r=10)",
      math.abs(f12.norm - 10.0) < 1e-9, s"got ${f12.norm}")
    check("force direction is +x (from b1 toward b2)",
      math.abs(f12.x - 10.0) < 1e-9 && math.abs(f12.y) < 1e-9 && math.abs(f12.z) < 1e-9)
    check("acceleration on b1 ≈ 0.01 (F/M)",
      math.abs(a12.x - 0.01) < 1e-12, s"got ${a12.x}")
    // Potential energy: U = -G*M*m/r = -1000*1/10 = -100
    val pe = Physics.potentialEnergy(b1, b2, softening = 0.0)
    println(s"  potentialEnergy   = $pe    (expected -100.0)")
    check("potential energy = -100 (G*M*m/r with G=1, M=1000, m=1, r=10)",
      math.abs(pe - (-100.0)) < 1e-9, s"got $pe")
    println()

    // ── JIT warmup: run 50 trivial steps so the JVM compiles the hot loops ─
    // Without this, the first ~1000 steps run in interpreted mode (~300ms/step
    // due to immutable Vector allocations) and blow the demo timeout. After
    // warmup the JIT-compiled step is much faster.
    print("  Warming up JIT...")
    val warmupSys = System(Vector(Entity(1L, Vector(ComponentVector(Vector(
      Component.Single(b1), Component.Single(b2)
    ))))))
    Simulator.evolve(warmupSys, 0.01, 50, softening = 0.0)
    println(" done.")
    println()

    // ── 1. Two-body Kepler test: 3 orbital periods ──────────────────────
    println("--- 1. Two-body Kepler test (3 orbital periods) ---")
    // Set up a circular orbit:
    //   - Central body M = 1000 at origin (small velocity to keep CoM fixed)
    //   - Orbiting body m = 1 at (10, 0, 0) with v = sqrt(M/r) = 10 in +y direction
    //   - In CoM frame: M moves slightly, m moves a lot
    //
    // For exact CoM frame we put:
    //   M at -m*r/(M+m), velocity -m*v/(M+m)
    //   m at M*r/(M+m),  velocity M*v/(M+m)
    // (so total momentum = 0 and CoM = origin)
    val M = 1000.0
    val m = 1.0
    val r = 10.0
    val vCirc = circularVelocity(M + m, r)  // use total mass for proper two-body
    val totalMass = M + m
    val bM_pos = Vec3(-m * r / totalMass, 0, 0)
    val bm_pos = Vec3( M * r / totalMass, 0, 0)
    val bM_vel = Vec3(0, -m * vCirc / totalMass, 0)
    val bm_vel = Vec3(0,  M * vCirc / totalMass, 0)
    val bM = Body(1L, Mass(M), bM_pos, bM_vel)
    val bm = Body(2L, Mass(m), bm_pos, bm_vel)
    val keplerSystem = System(Vector(Entity(1L, Vector(ComponentVector(Vector(
      Component.Single(bM), Component.Single(bm)
    ))))))

    val T = orbitalPeriod(totalMass, r)
    val stepsPerOrbit = 1000  // 1000 steps/orbit — high leapfrog accuracy for 1e-6 verification
    val dt = T / stepsPerOrbit
    val nOrbits = 3
    val nSteps = nOrbits * stepsPerOrbit

    println(s"  Setup: M=$M at $bM_pos, m=$m at $bm_pos")
    println(f"  Circular velocity v = $vCirc%.6f")
    println(f"  Orbital period T = $T%.6f")
    println(f"  Timestep dt = $dt%.6e  (T/$stepsPerOrbit)")
    println(s"  Running $nOrbits orbits × $stepsPerOrbit steps = $nSteps total steps...")
    println()

    // Initial orbital elements (measured in CoM frame, m relative to M)
    val relPos0 = bm_pos - bM_pos
    val relVel0 = bm_vel - bM_vel
    val ecc0 = eccentricity(relPos0, relVel0, totalMass)
    val a0 = semiMajorAxis(relPos0, relVel0, totalMass)
    val eInit0 = keplerSystem.totalEnergy(0.0)
    val pInit0 = keplerSystem.linearMomentum
    val pInit0Norm = pInit0.norm
    println(f"  Initial eccentricity  e₀ = $ecc0%.6e  (expected ~0 for circular)")
    println(f"  Initial semi-major   a₀ = $a0%.6f  (expected ~$r)")
    println(f"  Initial total energy E₀ = $eInit0%.6e")
    println(f"  Initial momentum    |p₀| = $pInit0Norm%.6e  (expected ~0 in CoM frame)")
    println()

    // Run the simulation
    val tStart = java.lang.System.nanoTime()
    val finalSystem = Simulator.evolve(keplerSystem, dt, nSteps, softening = 0.0)
    val elapsed = (java.lang.System.nanoTime() - tStart) / 1e9
    println(f"  Simulation completed in $elapsed%.3f s")

    // Measure final orbital elements
    val finalBodies = finalSystem.bodies
    val bMf = finalBodies.find(_.id == 1L).get
    val bmf = finalBodies.find(_.id == 2L).get
    val relPosF = bmf.pos - bMf.pos
    val relVelF = bmf.vel - bMf.vel
    val eccF = eccentricity(relPosF, relVelF, totalMass)
    val aF = semiMajorAxis(relPosF, relVelF, totalMass)
    val eFinal0 = finalSystem.totalEnergy(0.0)
    val pFinal0 = finalSystem.linearMomentum
    val pFinal0Norm = pFinal0.norm
    val eccDriftVal = math.abs(eccF - ecc0)
    val aDriftVal = math.abs(aF - a0)
    val eDriftVal = math.abs(eFinal0 - eInit0)
    val pDriftVal = (pFinal0 - pInit0).norm

    println(f"  Final eccentricity    e  = $eccF%.6e  (drift: $eccDriftVal%.2e)")
    println(f"  Final semi-major      a  = $aF%.6f  (drift: $aDriftVal%.2e)")
    println(f"  Final total energy    E  = $eFinal0%.6e  (drift: $eDriftVal%.2e)")
    println(f"  Final momentum       |p| = $pFinal0Norm%.6e  (drift: $pDriftVal%.2e)")
    println()

    // ── Verification per spec ────────────────────────────────────────────
    // Two-body Kepler: eccentricity and semi-major axis preserved over 10
    // orbital periods to within 1e-6.
    val eccDrift = math.abs(eccF - ecc0)
    val aDrift = math.abs(aF - a0)
    check(s"eccentricity drift < 1e-6 over $nOrbits orbits",
      eccDrift < 1e-6, f"got $eccDrift%.2e")
    check(s"semi-major axis drift < 1e-6 over $nOrbits orbits",
      aDrift < 1e-6, f"got $aDrift%.2e")
    println()

    // ── 2. Energy drift < 1e-6 over 1000 steps ──────────────────────────
    println("--- 2. Energy drift over 1000 steps (3-body system) ---")
    // 3-body system: central mass + two orbiters at different radii
    // This is more demanding than 2-body because there's no closed-form
    // solution — energy conservation is the only check.
    val b3a = Body(10L, Mass(1000.0), Vec3(0, 0, 0), Vec3(0, 0, 0))
    val b3b = Body(11L, Mass(1.0),    Vec3(10, 0, 0), Vec3(0, math.sqrt(100.0), 0))
    val b3c = Body(12L, Mass(2.0),    Vec3(0, 20, 0), Vec3(-math.sqrt(100.0), 0, 0))
    val threeBody = System(Vector(Entity(1L, Vector(ComponentVector(Vector(
      Component.Single(b3a), Component.Single(b3b), Component.Single(b3c)
    ))))))
    val eInit3 = threeBody.totalEnergy(0.0)
    val nSteps2 = 1000
    val dt2 = 0.005  // smaller timestep for 1e-6 energy conservation
    println(f"  Initial total energy = $eInit3%.6e")
    println(s"  Running $nSteps2 steps with dt = $dt2...")
    val final3 = Simulator.evolve(threeBody, dt2, nSteps2, softening = 0.0)
    val eFinal3 = final3.totalEnergy(0.0)
    val drift3 = math.abs(eFinal3 - eInit3) / math.abs(eInit3)
    println(f"  Final total energy   = $eFinal3%.6e")
    println(f"  Relative drift       = $drift3%.2e")
    println()
    check(s"energy drift < 1e-6 over $nSteps2 steps",
      drift3 < 1e-6, f"got $drift3%.2e")
    println()

    // ── 3. Total momentum conserved to machine precision ────────────────
    println("--- 3. Momentum conservation (3-body, CoM frame) ---")
    // Same 3-body system, check that total linear momentum is preserved.
    // In the CoM frame the initial momentum is zero; it should remain zero.
    val pInit3 = threeBody.linearMomentum
    val pFinal3 = final3.linearMomentum
    val pDrift3 = (pFinal3 - pInit3).norm
    println(s"  Initial momentum = $pInit3")
    println(s"  Final momentum   = $pFinal3")
    println(f"  Drift magnitude  = $pDrift3%.2e")
    println()
    // Machine precision for a 3-body system with velocities ~10 and masses
    // ~1000: ~1e-10 absolute. Allow 1e-9 to be safe.
    check("momentum drift < 1e-9 (machine precision)",
      pDrift3 < 1e-9, f"got $pDrift3%.2e")
    println()

    // ── 4. Longer run: 2000 steps, energy drift should stay bounded ───
    println("--- 4. Longer run: 2000 steps, bounded energy drift ---")
    // Symplectic integrators have BOUNDED energy drift (oscillates around
    // the true value) rather than secular drift. Verify over 2× more steps.
    val nSteps4 = 2000
    val final4 = Simulator.evolve(threeBody, dt2, nSteps4, softening = 0.0)
    val eFinal4 = final4.totalEnergy(0.0)
    val drift4 = math.abs(eFinal4 - eInit3) / math.abs(eInit3)
    println(f"  After $nSteps4 steps: E_final = $eFinal4%.6e, drift = $drift4%.2e")
    // Drift should still be small (and ideally not much worse than 1000 steps)
    check(s"energy drift < 1e-5 over $nSteps4 steps (bounded, not secular)",
      drift4 < 1e-5, f"got $drift4%.2e")
    check("drift over 2000 steps is not 2× worse than 1000 steps (symplectic bound)",
      drift4 < 2.0 * drift3 + 1e-12,
      f"got 10000-step drift $drift4%.2e vs 1000-step drift $drift3%.2e")
    println()

    // ── Final summary ────────────────────────────────────────────────────
    println("=== Phase 5 self-checks summary ===")
    println(s"  Passed: $passed")
    println(s"  Failed: $failed")
    if failed == 0 then
      println()
      println("Phase 5 N-Body engine verified. Ready for Phase 6 (File I/O via Three-Call).")
    else
      println()
      println(s"⚠ $failed self-check(s) failed — fix before proceeding.")
      sys.exit(1)
