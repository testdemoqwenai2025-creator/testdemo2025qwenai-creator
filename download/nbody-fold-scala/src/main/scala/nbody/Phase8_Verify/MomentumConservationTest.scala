package nbody.Phase8_Verify

import nbody.Phase0_Domain.*
import nbody.Phase5_NBody.{Simulator, Physics}

object MomentumConservationTest:
  def run(): (Boolean, String) =
    // 3-body system in the CoM frame (total momentum = 0)
    val b1 = Body(10L, Mass(1000.0), Vec3(0, 0, 0),    Vec3(0, 0, 0))
    val b2 = Body(11L, Mass(1.0),    Vec3(10, 0, 0),   Vec3(0, math.sqrt(100.0), 0))
    val b3 = Body(12L, Mass(2.0),    Vec3(0, 20, 0),   Vec3(-math.sqrt(100.0), 0, 0))
    val system = System(Vector(Entity(1L, Vector(ComponentVector(
      Vector(Component.Single(b1), Component.Single(b2), Component.Single(b3))
    )))))
    val pInit = system.linearMomentum
    val dt = 0.005
    val steps = 1000
    val finalSystem = Simulator.evolve(system, dt, steps, softening = 0.0)
    val pFinal = finalSystem.linearMomentum
    val drift = (pFinal - pInit).norm
    val passed = drift < 1e-12
    val detail = f"momentum drift = $drift%.2e (threshold 1e-12), p_init=$pInit, p_final=$pFinal"
    (passed, detail)
