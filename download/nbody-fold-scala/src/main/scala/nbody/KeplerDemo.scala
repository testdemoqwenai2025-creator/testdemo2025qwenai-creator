// ============================================================================
// KeplerDemo.scala — minimal sanity demo for Phase 0 domain model
// ============================================================================
// This is NOT a simulation yet (no integrator — that's Phase 5).
// It constructs a two-body system at the start of a Kepler orbit,
// verifies the bottom-up aggregation works (mass, CoM, energy, momentum),
// and prints the diagnostics. Used as a smoke test that the domain model
// compiles and behaves sensibly before any physics is wired in.
//
// Run with:  sbt "runMain nbody.KeplerDemo"
// ============================================================================

package nbody

import nbody.Phase0_Domain.*
import scala.math.{sqrt, Pi}

object KeplerDemo:

  // Two-body Kepler problem in natural units (G = 1).
  // Heavy central mass M, light orbiting mass m.
  // Circular orbit radius r, orbital speed v = sqrt(G*M/r).
  def main(args: Array[String]): Unit =

    val G    = 1.0
    val M    = Mass(1000.0)
    val m    = Mass(1.0)
    val r    = 10.0
    val v    = sqrt(G * M.value / r)   // circular orbit speed

    // Body 1 (heavy): at origin, at rest
    val b1 = Body(id = 1L, mass = M, pos = Vec3.Zero, vel = Vec3.Zero)
    // Body 2 (light): at (r, 0, 0), velocity (0, v, 0)
    val b2 = Body(id = 2L, mass = m, pos = Vec3(r, 0.0, 0.0), vel = Vec3(0.0, v, 0.0))

    // Build the hierarchy bottom-up
    val c1   = Component.Single(b1)
    val c2   = Component.Single(b2)
    val cv1  = ComponentVector(Vector(c1))
    val cv2  = ComponentVector(Vector(c2))
    val star = Entity(id = 1L, componentVectors = Vector(cv1))
    val plnt = Entity(id = 2L, componentVectors = Vector(cv2))
    val sys  = System(Vector(star, plnt))

    // ── Print the system snapshot ─────────────────────────────────────────
    println("=== nbody-fold-scala — Phase 0 Kepler Demo ===")
    println()
    println(sys)
    println()
    println(s"  Body 1: ${b1}")
    println(s"  Body 2: ${b2}")
    println()

    // ── Sanity checks ─────────────────────────────────────────────────────
    val expectedTotalMass = M.value + m.value
    val expectedCoM = b2.pos * (m.value / expectedTotalMass)  // CoM offset from heavy body
    val expectedL   = m.value * r * v                          // angular momentum magnitude

    println("--- Diagnostics ---")
    println(f"  Total mass        : ${sys.totalMass.value}%.4f  (expected $expectedTotalMass%.4f)")
    println(f"  Center of mass    : ${sys.centerOfMass}  (expected $expectedCoM)")
    println(f"  Kinetic energy    : ${sys.kineticEnergy}%.6e")
    println(f"  Potential energy  : ${sys.potentialEnergy(softening = 0.001)%.6e")
    println(f"  Total energy      : ${sys.totalEnergy(softening = 0.001)%.6e")
    println(f"  Linear momentum   : ${sys.linearMomentum}  (expected Vec3.Zero)")
    println(f"  Angular momentum  : ${sys.angularMomentum}  (magnitude expected $expectedL%.6e)")
    println()

    // ── Verify the bottom-up aggregation matches direct body computation ──
    val massOK   = math.abs(sys.totalMass.value - expectedTotalMass) < 1e-12
    val momOK    = sys.linearMomentum.norm < 1e-9
    val angOK    = math.abs(sys.angularMomentum.norm - expectedL) / expectedL < 1e-9
    val bodyCntOK = sys.countBodies == 2

    println("--- Self-checks ---")
    println(s"  [${if massOK   then "PASS" else "FAIL"}] total mass matches M + m")
    println(s"  [${if momOK    then "PASS" else "FAIL"}] linear momentum ≈ 0 (CoM frame)")
    println(s"  [${if angOK    then "PASS" else "FAIL"}] |L| = m·r·v for circular orbit")
    println(s"  [${if bodyCntOK then "PASS" else "FAIL"}] body count = 2")

    if !(massOK && momOK && angOK && bodyCntOK) then
      sys.error("Phase 0 self-check failed — domain model is inconsistent.")
    else
      println()
      println("Phase 0 domain model verified. Ready for Phase 1 (typeclasses).")
