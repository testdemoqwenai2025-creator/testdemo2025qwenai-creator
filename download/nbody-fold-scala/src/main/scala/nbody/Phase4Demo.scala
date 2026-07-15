// ============================================================================
// Phase4Demo.scala — Demonstrates Pillar 5 DoubleRLE + JumpIndex
// ============================================================================
// Shows:
//   1. Basic encode2/decode2 round-trip
//   2. Property tests: round-trip identity, length preservation, span invariant
//   3. Worked paper example: 1M-body periodic structure → ~1000 entries
//   4. JumpIndex.jumpTo — exhaustive check on 10k dataset
//   5. JumpIndex.slice — sub-range without full decode
//   6. Compression comparison: RLE vs DoubleRLE on periodic vs unstructured data
//   7. Micro-benchmark: jumpTo vs direct index vs RLEIndex.at
//
// Run with:  sbt "runMain nbody.Phase4Demo"
// ============================================================================

package nbody

import nbody.Phase0_Domain.*
import nbody.Phase3_RLE.*
import nbody.Phase3_RLE.RLE.Run
import nbody.Phase3_RLE.{Eq, given}
import nbody.Phase4_DoubleRLE.*
import nbody.Phase4_DoubleRLE.DoubleRLE.DoubleRun

object Phase4Demo:

  private var passed = 0
  private var failed = 0
  private def check(label: String, cond: Boolean, detail: String = ""): Unit =
    if cond then
      passed += 1
      println(s"  [PASS] $label")
    else
      failed += 1
      println(s"  [FAIL] $label  $detail")

  def main(args: Array[String]): Unit =

    println("=== Phase 4: DoubleRLE (Mathematical Jumping) Demo ===")
    println()

    // ── 1. Basic encode2/decode2 round-trip ──────────────────────────────
    println("--- 1. Basic encode2/decode2 round-trip ---")
    // IMPORTANT MATHEMATICAL FACT about standard DoubleRLE (RLE ∘ RLE):
    //
    // RLE always produces runs where ADJACENT entries have DIFFERENT values
    // (otherwise they'd be merged). So adjacent entries in the runs Vector
    // always differ in value, hence can NEVER be equal under (value, count)
    // equality. The second RLE pass therefore always produces outerCount=1
    // for every entry — NO compression at the second level.
    //
    // This is by design: standard DoubleRLE is a no-op asymptotically.
    // The JumpIndex data structure is still useful because:
    //   1. It's equivalent to RLEIndex (no harm)
    //   2. It has a cleaner API for range queries (slice uses double-run spans)
    //   3. The two-level prefix sum enables O(1) skip-ahead in Phase 5's
    //      force aggregation when combined with coarser Eq instances
    //
    // For genuine L2 compression, the second pass would need a different
    // equality (e.g., count-only) plus auxiliary value storage — that's
    // beyond the spec's `encode2[A: Eq]` signature.
    val periodic = Vector(1,1,1, 2,2,  1,1,1, 2,2,  1,1,1, 2,2)
    val doubleRuns = DoubleRLE.encode2(periodic)
    val back = DoubleRLE.decode2(doubleRuns)
    println(s"  input       = $periodic")
    println(s"  encode2     = ${doubleRuns.mkString(", ")}")
    println(s"  decode2     = $back")
    println(s"  single runs = ${RLE.encode(periodic).length}  (after 1 RLE pass)")
    println(s"  double runs = ${doubleRuns.length}  (after 2 RLE passes)")
    println(s"  (Note: L2 never compresses standard RLE output — see comment above)")
    check("round-trip identity", back == periodic, s"got $back")
    // L2 never compresses: double-run count == single-run count, all outerCounts = 1
    check("double-run count == single-run count (L2 is a no-op on RLE output)",
      doubleRuns.length == RLE.encode(periodic).length,
      s"got ${doubleRuns.length}")
    check("all outerCounts == 1 (mathematical invariant of RLE ∘ RLE)",
      doubleRuns.forall(_.outerCount == 1))
    check("first double-run is ((1, 3), 1)",
      doubleRuns.head == DoubleRun(1, 3, 1), s"got ${doubleRuns.head}")
    println()

    // ── 2. Property tests ────────────────────────────────────────────────
    println("--- 2. Property tests (laws) ---")
    val testCases = List(
      Vector.empty[Int],
      Vector(42),
      Vector(1, 2, 3, 4, 5),               // no runs at all
      Vector(7, 7, 7, 7, 7, 7, 7),         // single run, single double-run
      Vector(1, 1, 1, 2, 2, 3, 1, 1, 1, 1),// non-periodic
      Vector(1,1,1, 2,2,  1,1,1, 2,2,  1,1,1, 2,2)  // periodic (L2 still no-op)
    )
    testCases.foreach { tc =>
      check(s"round-trip on $tc",
        DoubleRLE.decode2(DoubleRLE.encode2(tc)) == tc)
    }
    testCases.foreach { tc =>
      val drs = DoubleRLE.encode2(tc)
      val total = DoubleRLE.decodedLength2(drs)
      check(s"length preserved on $tc (got $total, expected ${tc.length})",
        total == tc.length)
    }
    // Span invariant: sum of DoubleRun.span == decoded length
    testCases.foreach { tc =>
      val drs = DoubleRLE.encode2(tc)
      val spanSum = drs.map(_.span).sum
      val expected = tc.length.toLong
      check(s"span sum == length on $tc (got $spanSum, expected $expected)",
        spanSum == expected)
    }
    // Edge cases
    check("encode2(Nil) == Nil", DoubleRLE.encode2(Vector.empty[Int]).isEmpty)
    check("encode2(Vector(42)) == Vector(DoubleRun(42, 1, 1))",
      DoubleRLE.encode2(Vector(42)) == Vector(DoubleRun(42, 1, 1)))
    println()

    // ── 3. Worked paper example: 1M-body periodic structure ──────────────
    println("--- 3. Worked paper example: 1M-body periodic structure ---")
    // Construct a 1M-element Vector with periodic spatial structure:
    // 100 distinct cell values, each cell has 1000 identical bodies,
    // and the cell pattern repeats 10 times.
    //   N = 100 × 1000 × 10 = 1,000,000
    //   single RLE: 100 × 10 = 1000 runs (100 distinct cells × 10 repeats)
    //   double RLE: 1000 double-runs (L2 never compresses standard RLE)
    //   combined ratio: 1000× (all from L1; L2 contributes 1×)
    //
    // The spec's "~1000 entries" target IS achieved — entirely by the
    // first RLE pass. The second pass is a no-op but JumpIndex still
    // provides the same O(log 1000) ≈ 10-step lookup as RLEIndex.
    val cells = 100
    val bodiesPerCell = 1000
    val repeats = 10
    val N = cells * bodiesPerCell * repeats
    val oneCycle: Vector[Int] = (0 until cells).flatMap(c => Vector.fill(bodiesPerCell)(c)).toVector
    val million: Vector[Int] = (0 until repeats).flatMap(_ => oneCycle).toVector
    val (singleRatio, doubleRatio, combinedRatio) = DoubleRLE.compressionBreakdown(million)
    val singleRuns = RLE.encode(million).length
    val drs = DoubleRLE.encode2(million)
    val drCount = drs.length
    println(s"  N (original length)         = $N")
    println(s"  single RLE runs             = $singleRuns")
    println(s"  double RLE runs             = $drCount  (== single runs; L2 is no-op)")
    println(f"  single compression ratio    = $singleRatio%.1f×  (1000× — all compression from L1)")
    println(f"  double compression ratio    = $doubleRatio%.1f×  (L2 contributes nothing)")
    println(f"  combined compression ratio  = $combinedRatio%.1f×")
    println(s"  → 1M bodies compressed to $drCount entries (meets spec's ~1000 target via L1)")
    println()
    check("single runs = 1000 (100 cells × 10 repeats)",
      singleRuns == 1000, s"got $singleRuns")
    check("double runs = 1000 (L2 is no-op on standard RLE)",
      drCount == 1000, s"got $drCount")
    check("combined ratio = 1000× (1M → 1000 entries, all from L1)",
      math.abs(combinedRatio - 1000.0) < 0.01,
      s"got $combinedRatio")
    check("all outerCounts == 1 (mathematical invariant)",
      drs.forall(_.outerCount == 1))
    println()

    // ── 4. JumpIndex.jumpTo — exhaustive check on 10k dataset ────────────
    println("--- 4. JumpIndex.jumpTo — exhaustive check on 10k dataset ---")
    // 10k Vector: 100 cells × 100 bodies, no repeats (worst case for L2).
    // We'll then check a periodic 10k variant too.
    val smallN = 10000
    val smallCells = 100
    val smallPerCell = 100
    val smallData: Vector[Int] =
      (0 until smallCells).flatMap(c => Vector.fill(smallPerCell)(c)).toVector
    val smallIdx = JumpIndex.fromVector(smallData)
    val (smallSingleRuns, smallDoubleRuns, smallSpeedup) = smallIdx.speedupVsRLEIndex
    println(s"  data.length             = $smallN")
    println(s"  JumpIndex.doubleRunCount= $smallDoubleRuns")
    println(s"  JumpIndex.singleRuns    = $smallSingleRuns")
    println(f"  speedup vs RLEIndex     = $smallSpeedup%.1f×  (fewer binary-search steps)")
    println()
    // Exhaustive check: jumpTo(i) == data(i) for ALL i in [0, N)
    val allMatch = smallData.indices.forall(i => smallIdx.jumpTo(i.toLong) == smallData(i))
    check(s"jumpTo(i) == data(i) for ALL $smallN positions", allMatch)
    // Spot-checks at known boundaries
    check("jumpTo(0)     == 0", smallIdx.jumpTo(0)     == 0)
    check("jumpTo(99)    == 0", smallIdx.jumpTo(99)    == 0)
    check("jumpTo(100)   == 1", smallIdx.jumpTo(100)   == 1)
    check("jumpTo(9999)  == 99", smallIdx.jumpTo(9999) == 99)
    // Out-of-bounds
    check("jumpToOption(-1)     == None", smallIdx.jumpToOption(-1).isEmpty)
    check("jumpToOption(smallN) == None", smallIdx.jumpToOption(smallN.toLong).isEmpty)
    println()

    // ── 5. JumpIndex.slice — sub-range extraction ────────────────────────
    println("--- 5. JumpIndex.slice (sub-range extraction) ---")
    // Slice [95, 205) crosses two cell boundaries (0→1→2)
    val sliced = smallIdx.slice(95L, 205L)
    val expectedSlice = smallData.slice(95, 205)
    println(s"  slice(95, 205) length = ${sliced.length}  (expected 110)")
    check("slice(95, 205) == data.slice(95, 205)",
      sliced == expectedSlice)
    check("slice(95, 205) starts with five 0s (positions 95..99)",
      sliced.take(5).forall(_ == 0))
    check("slice(95, 205) ends with five 2s (positions 200..204)",
      sliced.takeRight(5).forall(_ == 2))
    println()

    // ── 6. Compression comparison: periodic vs unstructured data ─────────
    println("--- 6. Compression comparison: periodic vs unstructured ---")
    // Periodic 10k: 50 cells × 100 bodies × 2 repeats.
    // L1 compresses 100× (10000 → 100 single-runs: 50 cells × 2 repeats).
    // L2 does NOT compress (mathematical invariant: adjacent runs differ in value).
    val periodicWithRepeats: Vector[Int] =
      (0 until 50).flatMap(c => Vector.fill(100)(c)).toVector ++
      (0 until 50).flatMap(c => Vector.fill(100)(c)).toVector
    val (pSingle, pDouble, pCombined) = DoubleRLE.compressionBreakdown(periodicWithRepeats)
    val pDrCount = DoubleRLE.encode2(periodicWithRepeats).length
    println(s"  periodic (50 cells × 100 × 2 repeats):")
    println(f"    single ratio    = $pSingle%.1f×  (10000 → 100 single-runs)")
    println(f"    double ratio    = $pDouble%.1f×  (L2 is no-op — invariant)")
    println(f"    combined ratio  = $pCombined%.1f×")
    println(s"    double-run count = $pDrCount  (== single-run count, all outerCounts = 1)")
    check("periodic: 100 single-runs, 100 double-runs (L2 no-op)",
      DoubleRLE.encode2(periodicWithRepeats).length == 100 &&
      RLE.encode(periodicWithRepeats).length == 100)
    check("periodic: all outerCounts == 1",
      DoubleRLE.encode2(periodicWithRepeats).forall(_.outerCount == 1))
    println()
    // Unstructured: random ints — almost no compression at either level
    val rng = new scala.util.Random(42)
    val unstructured: Vector[Int] = Vector.fill(1000)(rng.nextInt(10))
    val (uSingle, uDouble, uCombined) = DoubleRLE.compressionBreakdown(unstructured)
    println(s"  unstructured (1000 random ints in [0, 10)):")
    println(f"    single ratio    = $uSingle%.2f×  (mostly length-1 runs)")
    println(f"    double ratio    = $uDouble%.2f×  (almost no second-level compression)")
    println(f"    combined ratio  = $uCombined%.2f×")
    check("unstructured: combined ratio < 2.0 (low compression)",
      uCombined < 2.0, s"got $uCombined")
    println()

    // ── 7. Micro-benchmark: jumpTo vs direct index vs RLEIndex.at ────────
    println("--- 7. Micro-benchmark: jumpTo vs RLEIndex.at vs direct index ---")
    // Build a 100k periodic dataset for benchmarking
    val benchN = 100000
    val benchRepeats = 100
    val benchCycleLen = 1000
    val benchCycle: Vector[Int] = (0 until 100).flatMap(c => Vector.fill(10)(c)).toVector
    val benchData: Vector[Int] = (0 until benchRepeats).flatMap(_ => benchCycle).toVector
    val benchRLEIdx = RLEIndex.fromVector(benchData)
    val benchJumpIdx = JumpIndex.fromVector(benchData)
    println(s"  benchData.length        = ${benchData.length}")
    println(s"  RLEIndex.runCount       = ${benchRLEIdx.runCount}")
    val (benchSR, benchDR, _) = benchJumpIdx.speedupVsRLEIndex
    println(s"  JumpIndex.doubleRunCount= $benchDR  (singleRuns = $benchSR)")
    println()

    // Random lookup indices (so we don't just hit cache-friendly sequential positions)
    val lookupCount = 100000
    val lookups: Vector[Long] = Vector.fill(lookupCount)(rng.nextInt(benchN).toLong)

    // Warm up JIT
    var warmup = 0
    for _ <- 0 until 10000 do
      warmup += benchJumpIdx.jumpTo(lookups(warmup & (lookupCount - 1))).hashCode()

    // Direct index (baseline)
    // NOTE: use java.lang.System explicitly because the local name `System`
    // is shadowed by nbody.Phase0_Domain.System (the simulation universe
    // class). Same family of namespace collision bug Phase 0 hit with `sys`.
    val tDirect0 = java.lang.System.nanoTime()
    var sumDirect = 0
    lookups.foreach { i => sumDirect += benchData(i.toInt) }
    val tDirect = java.lang.System.nanoTime() - tDirect0

    // RLEIndex.at
    val tRLE0 = java.lang.System.nanoTime()
    var sumRLE = 0
    lookups.foreach { i => sumRLE += benchRLEIdx.at(i).hashCode() }
    val tRLE = java.lang.System.nanoTime() - tRLE0

    // JumpIndex.jumpTo
    val tJump0 = java.lang.System.nanoTime()
    var sumJump = 0
    lookups.foreach { i => sumJump += benchJumpIdx.jumpTo(i).hashCode() }
    val tJump = java.lang.System.nanoTime() - tJump0

    val directMs = tDirect / 1e6
    val rleMs    = tRLE    / 1e6
    val jumpMs   = tJump   / 1e6
    val jumpVsRLE = tRLE.toDouble / tJump.toDouble
    val jumpVsDirect = tDirect.toDouble / tJump.toDouble
    println(f"  $lookupCount%,d random lookups on $benchN%,d-element dataset:")
    println(f"    direct index:       $directMs%.2f ms  (${tDirect / lookupCount} ns/lookup)")
    println(f"    RLEIndex.at:        $rleMs%.2f ms  (${tRLE / lookupCount} ns/lookup)")
    println(f"    JumpIndex.jumpTo:   $jumpMs%.2f ms  (${tJump / lookupCount} ns/lookup)")
    println(f"    jumpTo / RLEIndex = $jumpVsRLE%.2f×  (informational — JIT noise)")
    println(f"    jumpTo / direct   = $jumpVsDirect%.2f×  (direct wins on raw access)")
    println()
    // Performance is reported, NOT asserted — micro-benchmarks are noisy
    // (JIT warmup, cache state, branch prediction all affect the ratio).
    // On periodic data JumpIndex is typically competitive with or faster
    // than RLEIndex; on unstructured data they're equivalent (same number
    // of prefix-sum entries to binary-search over).
    //
    // The ONLY hard correctness assertion: all three methods agree on values.
    check("all three methods agree on lookup sums (correctness)",
      sumDirect == sumRLE && sumRLE == sumJump,
      s"direct=$sumDirect, rle=$sumRLE, jump=$sumJump")

    // ── Final summary ────────────────────────────────────────────────────
    println()
    println("=== Phase 4 self-checks summary ===")
    println(s"  Passed: $passed")
    println(s"  Failed: $failed")
    if failed == 0 then
      println()
      println("Phase 4 DoubleRLE (Mathematical Jumping) verified. Ready for Phase 5 (N-Body Engine).")
    else
      println()
      println(s"⚠ $failed self-check(s) failed — fix before proceeding.")
      sys.exit(1)
