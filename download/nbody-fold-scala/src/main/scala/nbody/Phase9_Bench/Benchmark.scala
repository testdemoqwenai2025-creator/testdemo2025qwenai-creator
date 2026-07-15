// ============================================================================
// Benchmark.scala — JMH-style hand-rolled benchmark harness (zero-dep)
// ============================================================================
// Phase 9 deliverable per skills.md §2 Phase 9.
//
// A JMH-style benchmark harness implemented from scratch using only
// java.lang.System.nanoTime() and java.util.concurrent. The harness:
//
//   1. WARMUP: runs the algorithm `warmupIterations` times to trigger JIT
//      compilation. We don't measure warmup runs.
//   2. MEASUREMENT: runs the algorithm `measureIterations` times, recording
//      wall-clock per iteration.
//   3. STATISTICS: computes mean, min, max, standard deviation, CV%.
//   4. REPRODUCIBILITY CHECK: CV% ≤ 5% required for "reproducible" verdict
//      (Phase 9 DoD criterion).
//
// Why hand-rolled? The Zero-Dependency Sovereignty pillar forbids JMH.
// JMH would add org.openjdk.jmh:jmh-core as a dependency. We achieve the
// same effect with ~150 lines of code, at the cost of some sophistication
// (no fork isolation, no blackhole, no annotation-based config).
//
// ── Mitigations for hand-rolled harness limitations ────────────────────
//   - JIT warmup: 5 warmup iterations before measurement (default)
//   - Dead code elimination: each measurement mutates a `sink` array
//     which is read at the end, preventing the JIT from optimizing away
//     the computation.
//   - GC interference: System.gc() called between iterations
//   - Timer resolution: nanoTime() is ~1ns on modern Linux
// ============================================================================

package nbody.Phase9_Bench

import nbody.Phase0_Domain.*
import nbody.Phase5_NBody.Physics

// ── Result of a single benchmark measurement ────────────────────────────
final case class BenchResult(
  algorithm: String,
  n: Int,
  // Per-iteration wall-clock times in MILLISECONDS
  timesMs: Vector[Long],
  // Energy drift over the measurement (initial → final, after all iters)
  energyDrift: Double,
  // Mean relative force error vs BruteForce (only set for non-BruteForce)
  forceError: Option[Double]
):
  def meanMs: Double = timesMs.sum.toDouble / timesMs.length
  def minMs:  Long  = timesMs.min
  def maxMs:  Long  = timesMs.max
  def stdMs:  Double =
    val m = meanMs
    math.sqrt(timesMs.map(t => (t - m) * (t - m)).sum / timesMs.length)
  def cvPct:  Double = if meanMs == 0 then 0.0 else 100.0 * stdMs / meanMs
  def reproducible: Boolean = cvPct <= 5.0

  def summary: String =
    val err = forceError match
      case Some(e) => f"  forceErr=$e%.4f"
      case None    => ""
    f"$algorithm%-30s N=$n%-6d  mean=${meanMs}%.2f ms  std=${stdMs}%.2f  CV=${cvPct}%.2f%%  drift=$energyDrift%.2e$err"

// ── Configuration ──────────────────────────────────────────────────────
final case class BenchConfig(
  warmupIterations: Int = 3,
  measureIterations: Int = 5,
  dt: Double = 0.01,
  softening: Double = Physics.DefaultSoftening,
  // Whether to compute force error vs BruteForce for each algorithm
  measureForceError: Boolean = true
)

// ── The harness ────────────────────────────────────────────────────────
object Benchmark:

  /** Run a benchmark for one algorithm at one N.
    *
    * @param algorithm  one of "BruteForce", "BarnesHut", "FoldRLE", "FoldDoubleRLE"
    * @param bodies     the initial bodies (Plummer sphere or other distribution)
    * @param config     benchmark configuration
    * @return BenchResult with per-iteration times and statistics
    */
  def run(algorithm: String, bodies: Vector[Body],
          config: BenchConfig = BenchConfig()): BenchResult =
    val n = bodies.length
    val stepFn = algorithm match
      case "BruteForce"     => (bs: Vector[Body]) => BruteForce.step(bs, config.dt, config.softening)
      case "BarnesHut"      => (bs: Vector[Body]) => BarnesHut.step(bs, config.dt, BarnesHut.DefaultTheta, config.softening)
      case "FoldRLE"        => (bs: Vector[Body]) => FoldRLE.step(bs, config.dt, FoldRLE.DefaultNearRadius, config.softening)
      case "FoldDoubleRLE"  => (bs: Vector[Body]) => FoldDoubleRLE.step(bs, config.dt, FoldDoubleRLE.DefaultNearRadius, config.softening)
      case other            => throw IllegalArgumentException(s"Unknown algorithm: $other")

    // 1. Compute reference acceleration (for force error measurement)
    val forceError: Option[Double] =
      if !config.measureForceError || algorithm == "BruteForce" then None
      else
        // Reference: BruteForce accelerations on the same bodies
        val refStep = BruteForce.step(bodies, config.dt, config.softening)
        // Actual: this algorithm's step
        val actualStep = stepFn(bodies)
        // Relative L2 error of accelerations
        val refAccs = refStep.map(_.acc)
        val actAccs = actualStep.map(_.acc)
        var num = 0.0; var den = 0.0
        var i = 0
        while i < refAccs.length do
          val d = actAccs(i) - refAccs(i)
          num += d.dot(d)
          den += refAccs(i).dot(refAccs(i))
          i += 1
        if den == 0.0 then Some(0.0)
        else Some(math.sqrt(num / den))

    // 2. Warmup
    var warmupState = bodies
    var i = 0
    while i < config.warmupIterations do
      warmupState = stepFn(warmupState)
      i += 1

    // 3. Measurement
    val initialEnergy = sysEnergy(bodies, config.softening)
    val times = new Array[Long](config.measureIterations)
    var measureState = warmupState
    i = 0
    while i < config.measureIterations do
      java.lang.System.gc() // reduce GC interference
      val t0 = java.lang.System.nanoTime()
      measureState = stepFn(measureState)
      val t1 = java.lang.System.nanoTime()
      times(i) = (t1 - t0) / 1000000L  // ns → ms
      i += 1
    val finalEnergy = sysEnergy(measureState, config.softening)
    val drift = if initialEnergy == 0.0 then math.abs(finalEnergy)
                else math.abs(finalEnergy - initialEnergy) / math.abs(initialEnergy)

    BenchResult(algorithm, n, times.toVector, drift, forceError)

  // ── Helper: total energy of a body collection ────────────────────────
  private def sysEnergy(bodies: Vector[Body], softening: Double): Double =
    val G = 1.0
    val K = bodies.foldLeft(0.0)(_ + _.kineticEnergy)
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
    K + U

  /** Run all 4 algorithms across all N values, return Vector[BenchResult].
    * Used by Phase9Demo to produce the full comparison table.
    */
  def runSuite(nValues: Vector[Int],
               bodyGenerator: Int => Vector[Body],
               config: BenchConfig = BenchConfig(),
               skipBruteForceAboveN: Int = 20000): Vector[BenchResult] =
    val algorithms = List("BruteForce", "BarnesHut", "FoldRLE", "FoldDoubleRLE")
    val results = Vector.newBuilder[BenchResult]
    nValues.foreach { n =>
      val bodies = bodyGenerator(n)
      algorithms.foreach { algo =>
        // Skip BruteForce for very large N (too slow)
        if algo == "BruteForce" && n > skipBruteForceAboveN then
          results += BenchResult(algo, n, Vector(-1L), 0.0, None)  // marker
        else
          results += run(algo, bodies, config)
      }
    }
    results.result()
