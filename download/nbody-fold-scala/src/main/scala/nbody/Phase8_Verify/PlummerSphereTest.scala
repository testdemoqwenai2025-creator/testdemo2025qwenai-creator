package nbody.Phase8_Verify

import nbody.Phase0_Domain.*
import nbody.Phase5_NBody.{Simulator, Physics}

object PlummerSphereTest:
  def run(): (Boolean, String) =
    val n = 500
    val totalMass = 1.0
    val plummerRadius = 1.0
    val seed = 42L
    val bodies = PlummerSphere.generate(n, totalMass, plummerRadius, seed)
    val virial = PlummerSphere.virialRatio(bodies, softening = 0.0)
    // For N=500 the sampling noise is ~5-8%. Allow 10% tolerance.
    val passed = virial > 0.9 && virial < 1.1
    val detail = f"virial ratio 2K/|U| = $virial%.4f (target 1.0, tolerance ±0.1), N=$n bodies, seed=$seed"
    (passed, detail)
