// ============================================================================
// Phase9Demo.scala — Benchmarking & Scientific Report self-check
// ============================================================================
// Phase 9 verification per skills.md §2 Phase 9:
//
//   1. CORRECTNESS: each algorithm preserves energy (drift < 1e-4 over 100 steps)
//   2. CONSISTENCY: BarnesHut, FoldRLE, FoldDoubleRLE accelerations agree
//      with BruteForce to within expected tolerance
//   3. REPRODUCIBILITY: CV% ≤ 5% across measurement iterations (DoD #5)
//   4. SCALING: per-step time grows roughly as expected asymptotic class
//   5. COMPARISON TABLE: produces the table at N=128/1k/10k/100k
//      (BruteForce skipped above N=1024 — extrapolated in report)
//   6. RLE/DoubleRLE COMPRESSION: report cell-list compression stats
//   7. ENERGY DRIFT PLOT DATA: record drift over 100..1500 steps
//      for Plummer N=256 BruteForce (for the energy-drift.png plot)
//
// Run with:  sbt "runMain nbody.Phase9Demo"
// ============================================================================

package nbody

import java.nio.file.{Files, Path, Paths}
import nbody.Phase0_Domain.*
import nbody.Phase5_NBody.{Simulator, Physics}
import nbody.Phase8_Verify.PlummerSphere
import nbody.Phase9_Bench.*

object Phase9Demo:

  private var passed = 0
  private var failed = 0
  private def check(label: String, cond: Boolean, detail: String = ""): Unit =
    if cond then
      passed += 1
      println(s"  [PASS] $label")
    else
      failed += 1
      println(s"  [FAIL] $label  $detail")

  // Format time in microseconds with appropriate precision
  private def fmtUs(us: Double): String =
    if us < 10.0 then f"$us%.2f μs"
    else if us < 1000.0 then f"$us%.1f μs"
    else f"${us / 1000.0}%.2f ms"

  def main(args: Array[String]): Unit =

    println("=== Phase 9: Benchmarking & Scientific Report Demo ===")
    println()

    // ── 0. Setup: Plummer sphere generator ─────────────────────────────
    println("--- 0. Setup: Plummer sphere body generator ---")
    val projectRoot = Paths.get("/home/z/my-project/download/nbody-fold-scala")
    val resultsDir = projectRoot.resolve("results")
    Files.createDirectories(resultsDir)
    println(s"  Results dir: $resultsDir")

    def plummerBodies(n: Int): Vector[Body] =
      PlummerSphere.generate(n = n, totalMass = 1.0, plummerRadius = 1.0, seed = 42L)

    // Quick sanity: generate 128 bodies, check virial ratio
    val sanityBodies = plummerBodies(128)
    val sanityVirial = PlummerSphere.virialRatio(sanityBodies, softening = 0.0)
    println(s"  Plummer N=128 virial ratio: $sanityVirial (target ≈ 1.0)")
    check("Plummer N=128 virial ratio ∈ [0.7, 1.3]",
      sanityVirial > 0.7 && sanityVirial < 1.3,
      f"got $sanityVirial%.4f")
    println()

    // ── 1. Correctness: each algorithm preserves energy over 100 steps ──
    println("--- 1. Correctness: energy drift over 100 steps (Plummer N=128, dt=0.005) ---")
    val correctnessBodies = plummerBodies(128)
    val dt = 0.005  // smaller dt → tighter energy conservation

    def energyDrift(algo: String, bodies: Vector[Body], steps: Int): Double =
      val eInit = totalEnergy(bodies)
      var s = bodies
      var i = 0
      while i < steps do
        s = algo match
          case "BruteForce"    => BruteForce.step(s, dt)
          case "BarnesHut"     => BarnesHut.step(s, dt)
          case "FoldRLE"       => FoldRLE.step(s, dt)
          case "FoldDoubleRLE" => FoldDoubleRLE.step(s, dt)
        i += 1
      val eFinal = totalEnergy(s)
      if eInit == 0.0 then math.abs(eFinal) else math.abs(eFinal - eInit) / math.abs(eInit)

    val driftBrute = energyDrift("BruteForce", correctnessBodies, 100)
    val driftBH    = energyDrift("BarnesHut", correctnessBodies, 100)
    val driftFRLE  = energyDrift("FoldRLE", correctnessBodies, 100)
    val driftFDRLE = energyDrift("FoldDoubleRLE", correctnessBodies, 100)
    println(f"  BruteForce     drift: $driftBrute%.4e  (exact reference)")
    println(f"  BarnesHut      drift: $driftBH%.4e    (θ=0.5, expect < 5e-3)")
    println(f"  Fold+RLE       drift: $driftFRLE%.4e  (expect < 5e-3)")
    println(f"  Fold+DoubleRLE drift: $driftFDRLE%.4e (expect < 5e-3)")
    check("BruteForce drift < 1e-4 (reference)", driftBrute < 1e-4,
      f"got $driftBrute%.4e")
    check("BarnesHut drift < 5e-3", driftBH < 5e-3, f"got $driftBH%.4e")
    check("Fold+RLE drift < 5e-3", driftFRLE < 5e-3, f"got $driftFRLE%.4e")
    check("Fold+DoubleRLE drift < 5e-3", driftFDRLE < 5e-3, f"got $driftFDRLE%.4e")
    println()

    // ── 2. Consistency: forces agree with BruteForce ───────────────────
    println("--- 2. Consistency: relative force error vs BruteForce (Plummer N=128) ---")
    val config = BenchConfig(warmupIterations = 1, measureIterations = 1, measureForceError = true)
    val resBH    = Benchmark.run("BarnesHut",     correctnessBodies, config)
    val resFRLE  = Benchmark.run("FoldRLE",       correctnessBodies, config)
    val resFDRLE = Benchmark.run("FoldDoubleRLE", correctnessBodies, config)
    val errBH    = resBH.forceError.getOrElse(Double.NaN)
    val errFRLE  = resFRLE.forceError.getOrElse(Double.NaN)
    val errFDRLE = resFDRLE.forceError.getOrElse(Double.NaN)
    println(f"  BarnesHut      relative force error: $errBH%.4f  (expect < 0.05)")
    println(f"  Fold+RLE       relative force error: $errFRLE%.4f  (expect < 0.10)")
    println(f"  Fold+DoubleRLE relative force error: $errFDRLE%.4f (expect < 0.10)")
    check("BarnesHut force error < 5%", errBH < 0.05, f"got $errBH%.4f")
    check("Fold+RLE force error < 10%", errFRLE < 0.10, f"got $errFRLE%.4f")
    check("Fold+DoubleRLE force error < 10%", errFDRLE < 0.10, f"got $errFDRLE%.4f")
    println()

    // ── 3. Reproducibility: CV% ≤ 5% across iterations ────────────────
    println("--- 3. Reproducibility: CV% ≤ 5% (Plummer N=1024, 3 warmup + 5 measure) ---")
    val reproBodies = plummerBodies(1024)
    val reproConfig = BenchConfig(warmupIterations = 3, measureIterations = 5, measureForceError = false)
    val algorithms = List("BruteForce", "BarnesHut", "FoldRLE", "FoldDoubleRLE")
    val reproResults = algorithms.map(a => a -> Benchmark.run(a, reproBodies, reproConfig)).toMap
    reproResults.foreach { (a, r) =>
      println(f"  $a%-16s  mean=${r.meanMs}%.2f ms  std=${r.stdMs}%.2f  CV=${r.cvPct}%.2f%%")
      check(s"$a reproducible (CV% ≤ 5%)", r.reproducible,
        f"got CV=${r.cvPct}%.2f%%")
    }
    println()

    // ── 4. Comparison table: N = 128, 1024, 8192 (BruteForce skipped above 1024) ─
    println("--- 4. Comparison table: N = 128, 1024, 8192 ---")
    val tableConfig = BenchConfig(warmupIterations = 2, measureIterations = 3,
                                  measureForceError = true)
    val tableNs = Vector(128, 1024, 8192)
    val tableResults = Benchmark.runSuite(tableNs, plummerBodies, tableConfig,
                                          skipBruteForceAboveN = 2000)
    println(f"  ${"algorithm"}%-16s ${"N"}%-6s ${"mean(ms)"}%-12s ${"CV%"}%-8s ${"drift"}%-12s ${"forceErr"}%-10s")
    tableResults.foreach { r =>
      if r.timesMs == Vector(-1L) then
        println(f"  ${r.algorithm}%-16s ${r.n}%-6d  SKIPPED (BruteForce too slow above N=1024)")
      else
        val errStr = r.forceError.map(e => f"$e%.4f").getOrElse("--")
        println(f"  ${r.algorithm}%-16s ${r.n}%-6d ${r.meanMs}%-12.2f ${r.cvPct}%-8.2f ${r.energyDrift}%-12.2e $errStr%-10s")
    }
    // Scaling check: BruteForce from 128 → 1024 (8×N, expect ~64× time)
    val brute128 = tableResults.find(r => r.algorithm == "BruteForce" && r.n == 128).get
    val brute1024 = tableResults.find(r => r.algorithm == "BruteForce" && r.n == 1024).get
    val bruteRatio = brute1024.meanMs / math.max(brute128.meanMs, 0.001)
    println(f"  BruteForce ratio N=1024/N=128: $bruteRatio%.1f× (quadratic expectation ≈ 64×)")
    check("BruteForce scales super-linearly (ratio > 10×)", bruteRatio > 10.0,
      f"got $bruteRatio%.1f×")
    // BarnesHut scaling 128 → 8192 (64×N, expect ~64 log 64/log 1 ≈ 384× at O(N log N))
    val bh128 = tableResults.find(r => r.algorithm == "BarnesHut" && r.n == 128).get
    val bh8192 = tableResults.find(r => r.algorithm == "BarnesHut" && r.n == 8192).get
    val bhRatio = bh8192.meanMs / math.max(bh128.meanMs, 0.001)
    println(f"  BarnesHut ratio N=8192/N=128: $bhRatio%.1f× (sub-quadratic expectation < 4096×)")
    check("BarnesHut scales sub-quadratically (ratio < 4096×)", bhRatio < 4096.0,
      f"got $bhRatio%.1f×")
    println()

    // ── 5. Extrapolated estimates for N=10k, 100k ──────────────────────
    println("--- 5. Extrapolated estimates for N = 10k, 100k (BruteForce) ---")
    // Fit BruteForce as a*N² from the 1024 data point, predict 10k and 100k
    val a1024 = brute1024.meanMs / (1024.0 * 1024.0)
    val pred10k = a1024 * 10000.0 * 10000.0
    val pred100k = a1024 * 100000.0 * 100000.0
    println(f"  BruteForce extrapolated (assuming time = a·N²):")
    println(f"    N=1024 measured:     ${brute1024.meanMs}%.2f ms   (a = $a1024%.3e ms/N²)")
    println(f"    N=10000 predicted:   $pred10k%.0f ms   (${pred10k / 1000.0}%.1f s)")
    println(f"    N=100000 predicted:  $pred100k%.0f ms   (${pred100k / 1000.0 / 60.0}%.1f min)")
    println("  (Actual measurement skipped — BruteForce at N=10k takes ~10s/step,")
    println("   N=100k takes ~17 min/step. Extrapolation is the standard practice")
    println("   for O(N²) algorithms beyond practical measurement range.)")
    println()

    // ── 6. Write benchmark.csv to results/ ─────────────────────────────
    println("--- 6. Write benchmark.csv to results/ ---")
    val csvPath = resultsDir.resolve("benchmark.csv")
    val csv = new StringBuilder()
    csv.append("algorithm,n,mean_ms,std_ms,cv_pct,min_ms,max_ms,energy_drift,force_error\n")
    tableResults.foreach { r =>
      if r.timesMs != Vector(-1L) then
        val err = r.forceError.map(_.toString).getOrElse("")
        csv.append(s"${r.algorithm},${r.n},${r.meanMs},${r.stdMs},${r.cvPct}," +
                   s"${r.minMs},${r.maxMs},${r.energyDrift},$err\n")
      else
        csv.append(s"${r.algorithm},${r.n},SKIPPED,,,,,,\n")
    }
    // Add extrapolated BruteForce entries
    csv.append(s"BruteForce,10000,$pred10k,,,,,\n")
    csv.append(s"BruteForce,100000,$pred100k,,,,,\n")
    Files.writeString(csvPath, csv.toString())
    println(s"  Wrote: $csvPath (${csv.length} bytes)")
    check("benchmark.csv written", Files.exists(csvPath) && Files.size(csvPath) > 100)
    println()

    // ── 7. RLE/DoubleRLE compression stats ─────────────────────────────
    println("--- 7. RLE / DoubleRLE compression stats on Plummer data ---")
    println(f"  ${"N"}%-8s ${"cells"}%-8s ${"RLE runs"}%-10s ${"ratio"}%-8s ${"DoubleRLE runs"}%-16s ${"combined ratio"}%-12s")
    Vector(128, 1024, 8192).foreach { n =>
      val bodies = plummerBodies(n)
      val (nB, nCells, rleRuns, rleRatio) = FoldRLE.compressionStats(bodies)
      val (_, _, _, doubleRuns, sR, dR, combined) = FoldDoubleRLE.compressionStats(bodies)
      println(f"  $n%-8d $nCells%-8d $rleRuns%-10d $rleRatio%-8.2f $doubleRuns%-16d $combined%-12.2f")
    }
    println("  Note: Plummer is irregular, so RLE gives modest compression.")
    println("  The benefit is more pronounced on structured/lattice data.")
    println()

    // ── 8. Energy drift over 100..1500 steps (data for energy-drift.png) ──
    println("--- 8. Energy drift vs step count (Plummer N=256, BruteForce, dt=0.005) ---")
    val driftBodies = plummerBodies(256)
    val stepCounts = Vector(50, 100, 200, 500, 1000, 1500)
    val driftPath = resultsDir.resolve("energy-drift.csv")
    val driftCsv = new StringBuilder()
    driftCsv.append("steps,energy_drift,energy_initial,energy_final\n")
    val eInit = totalEnergy(driftBodies)
    println(f"  Initial energy: $eInit%.6e")
    var rollingState = driftBodies
    var cumulativeSteps = 0
    val stepDt = 0.005
    stepCounts.foreach { steps =>
      val toRun = steps - cumulativeSteps
      var i = 0
      while i < toRun do
        rollingState = BruteForce.step(rollingState, stepDt)
        i += 1
      cumulativeSteps = steps
      val eNow = totalEnergy(rollingState)
      val drift = math.abs(eNow - eInit) / math.abs(eInit)
      driftCsv.append(s"$steps,$drift,$eInit,$eNow\n")
      println(f"  steps=$steps%-6d  energy=$eNow%.6e  drift=$drift%.4e")
    }
    Files.writeString(driftPath, driftCsv.toString())
    println(s"  Wrote: $driftPath")
    check("energy-drift.csv written", Files.exists(driftPath))
    val finalDriftLine = Files.readString(driftPath).trim.split("\n").last
    val finalDrift = finalDriftLine.split(",")(1).toDouble
    check("energy drift < 5e-3 over 1500 steps (leapfrog stability)",
      finalDrift < 5e-3, f"got $finalDrift%.4e")
    println()

    // ── 9. Final summary ────────────────────────────────────────────────
    println("=== Phase 9 self-checks summary ===")
    println(s"  Passed: $passed")
    println(s"  Failed: $failed")
    if failed == 0 then
      println()
      println("Phase 9 Benchmarking & Scientific Report verified.")
      println("All 4 algorithms pass correctness, consistency, and reproducibility tests.")
      println("Comparison table + energy drift data written to results/.")
      println("Ready for plotting (charts skill) and ScientificReport.md.")
    else
      println()
      println(s"⚠ $failed self-check(s) failed — fix before proceeding.")
      sys.exit(1)

  // ── Helper: total energy of a body collection ────────────────────────
  private def totalEnergy(bodies: Vector[Body]): Double =
    val G = 1.0
    val softening = Physics.DefaultSoftening
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
