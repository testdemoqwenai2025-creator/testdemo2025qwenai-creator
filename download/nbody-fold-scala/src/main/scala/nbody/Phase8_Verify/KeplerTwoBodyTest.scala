package nbody.Phase8_Verify

import nbody.Phase0_Domain.*
import nbody.Phase5_NBody.{Simulator, Physics}

object KeplerTwoBodyTest:
  /** Compute orbital eccentricity from relative position and velocity. */
  def eccentricity(relPos: Vec3, relVel: Vec3, totalMass: Double): Double =
    val r = relPos.norm
    if r == 0.0 then 0.0
    else
      val h = relPos.cross(relVel)         // specific angular momentum
      val vCrossH = relVel.cross(h)
      val eVec = vCrossH / totalMass - relPos / r  // eccentricity vector
      eVec.norm

  def run(): (Boolean, String) =
    val M = 1000.0
    val m = 1.0
    val r = 10.0
    val totalMass = M + m
    val vCirc = math.sqrt(totalMass / r)   // circular orbit velocity
    // CoM frame: both bodies orbit the CoM
    val bM = Body(1L, Mass(M),
      Vec3(-m * r / totalMass, 0, 0),
      Vec3(0, -m * vCirc / totalMass, 0))
    val bm = Body(2L, Mass(m),
      Vec3(M * r / totalMass, 0, 0),
      Vec3(0, M * vCirc / totalMass, 0))
    val system = System(Vector(Entity(1L, Vector(ComponentVector(
      Vector(Component.Single(bM), Component.Single(bm))
    )))))
    val relPos0 = bm.pos - bM.pos
    val relVel0 = bm.vel - bM.vel
    val ecc0 = eccentricity(relPos0, relVel0, totalMass)
    // Orbital period T = 2π sqrt(r³ / (M+m))
    val T = 2.0 * math.Pi * math.sqrt(r * r * r / totalMass)
    val stepsPerOrbit = 1000
    val dt = T / stepsPerOrbit
    val nOrbits = 10
    val nSteps = nOrbits * stepsPerOrbit
    val finalSystem = Simulator.evolve(system, dt, nSteps, softening = 0.0)
    val bMf = finalSystem.bodies.find(_.id == 1L).get
    val bmf = finalSystem.bodies.find(_.id == 2L).get
    val relPosF = bmf.pos - bMf.pos
    val relVelF = bmf.vel - bMf.vel
    val eccF = eccentricity(relPosF, relVelF, totalMass)
    val drift = math.abs(eccF - ecc0)
    val passed = drift < 1e-6
    val detail = f"eccentricity drift = $drift%.2e (threshold 1e-6) over $nOrbits orbits, e_init=$ecc0%.6e, e_final=$eccF%.6e"
    (passed, detail)
