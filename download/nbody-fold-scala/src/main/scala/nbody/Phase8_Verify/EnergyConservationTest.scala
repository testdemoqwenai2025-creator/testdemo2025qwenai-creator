package nbody.Phase8_Verify

import nbody.Phase0_Domain.*
import nbody.Phase5_NBody.{Simulator, Physics}

object EnergyConservationTest:
  /** Run the energy conservation test.
    * Returns (passed, detail) where detail is a human-readable summary.
    */
  def run(): (Boolean, String) =
    // 3-body system: central mass + two orbiters at different radii
    val b1 = Body(10L, Mass(1000.0), Vec3(0, 0, 0),    Vec3(0, 0, 0))
    val b2 = Body(11L, Mass(1.0),    Vec3(10, 0, 0),   Vec3(0, math.sqrt(100.0), 0))
    val b3 = Body(12L, Mass(2.0),    Vec3(0, 20, 0),   Vec3(-math.sqrt(100.0), 0, 0))
    val system = System(Vector(Entity(1L, Vector(ComponentVector(
      Vector(Component.Single(b1), Component.Single(b2), Component.Single(b3))
    )))))
    val eInit = system.totalEnergy(0.0)
    val dt = 0.005
    val steps = 1000
    val finalSystem = Simulator.evolve(system, dt, steps, softening = 0.0)
    val eFinal = finalSystem.totalEnergy(0.0)
    val drift = math.abs(eFinal - eInit) / math.abs(eInit)
    val passed = drift < 1e-6
    val detail = f"energy drift = $drift%.2e (threshold 1e-6), E_init=$eInit%.6e, E_final=$eFinal%.6e"
    (passed, detail)
