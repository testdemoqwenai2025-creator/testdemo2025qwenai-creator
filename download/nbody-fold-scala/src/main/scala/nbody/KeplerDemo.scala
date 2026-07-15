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

  // Two-body Kepler problem in natural units (G = 1), set up in the
  // CENTER-OF-MOMENTUM frame so linear momentum is exactly zero.
  //
  // For a circular orbit with separation r and total mass M+m:
  //   relative orbital speed  v = sqrt(G * (M+m) / r)
  //   heavy body position     r1 = -m/(M+m) * r̂
  //   light body position     r2 = +M/(M+m) * r̂
  //   heavy body velocity     v1 = -m/(M+m) * v_perp
  //   light body velocity     v2 = +M/(M+m) * v_perp
  def main(args: Array[String]): Unit =

    val G    = 1.0
    val M    = Mass(1000.0)
    val m    = Mass(1.0)
    val Mtot = M.value + m.value
    val r    = 10.0
    val v    = sqrt(G * Mtot / r)               // relative circular-orbit speed

    val r1 = -m.value / Mtot * r                // heavy body offset from CoM
    val r2 =  M.value / Mtot * r                // light body offset from CoM
    val v1 = -m.value / Mtot * v                // heavy body velocity
    val v2 =  M.value / Mtot * v                // light body velocity

    // Body 1 (heavy): on -x axis, moving in -y direction
    val b1 = Body(id = 1L, mass = M, pos = Vec3(r1, 0.0, 0.0), vel = Vec3(0.0, v1, 0.0))
    // Body 2 (light): on +x axis, moving in +y direction
    val b2 = Body(id = 2L, mass = m, pos = Vec3(r2, 0.0, 0.0), vel = Vec3(0.0, v2, 0.0))

    // Build the hierarchy bottom-up
    val c1   = Component.Single(b1)
    val c2   = Component.Single(b2)
    val cv1  = ComponentVector(Vector(c1))
    val cv2  = ComponentVector(Vector(c2))
    val star = Entity(id = 1L, componentVectors = Vector(cv1))
    val plnt = Entity(id = 2L, componentVectors = Vector(cv2))
    val system = System(Vector(star, plnt))

    // ── Print the system snapshot ─────────────────────────────────────────
    println("=== nbody-fold-scala — Phase 0 Kepler Demo ===")
    println()
    println(system)
    println()
    println(s"  Body 1: ${b1}")
    println(s"  Body 2: ${b2}")
    println()

    // ── Sanity checks ─────────────────────────────────────────────────────
    val expectedTotalMass = Mtot
    val expectedCoM = Vec3.Zero                                  // CoM frame ⇒ CoM at origin
    val expectedL   = m.value * M.value / Mtot * r * v           // reduced-mass L = μ·r·v, μ = mM/(M+m)

    // Extract values to locals so the f-interpolator doesn't choke on the
    // `=` inside ${expr} when followed by a format spec.
    val U = system.potentialEnergy(softening = 0.001)
    val E = system.totalEnergy(softening = 0.001)

    println("--- Diagnostics ---")
    println(f"  Total mass        : ${system.totalMass.value}%.4f  (expected $expectedTotalMass%.4f)")
    println(s"  Center of mass    : ${system.centerOfMass}  (expected $expectedCoM)")
    println(f"  Kinetic energy    : ${system.kineticEnergy}%.6e")
    println(f"  Potential energy  : $U%.6e")
    println(f"  Total energy      : $E%.6e")
    println(s"  Linear momentum   : ${system.linearMomentum}  (expected Vec3.Zero — CoM frame)")
    println(f"  Angular momentum  : ${system.angularMomentum}  (magnitude expected $expectedL%.6e)")
    println()

    // ── Verify the bottom-up aggregation matches direct body computation ──
    val massOK   = math.abs(system.totalMass.value - expectedTotalMass) < 1e-12
    val momOK    = system.linearMomentum.norm < 1e-9
    val angOK    = math.abs(system.angularMomentum.norm - expectedL) / expectedL < 1e-9
    val bodyCntOK = system.countBodies == 2

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
