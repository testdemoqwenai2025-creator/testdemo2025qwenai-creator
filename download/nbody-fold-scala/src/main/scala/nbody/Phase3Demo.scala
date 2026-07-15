// ============================================================================
// Phase3Demo.scala — Demonstrates Pillar 5 RLE engine + O(log N) index
// ============================================================================
// Shows:
//   1. Basic encode/decode round-trip on integers
//   2. Property tests: round-trip identity, length preservation, empty/singleton
//   3. Eq[Body] — same-ID bodies merge into one run despite different state
//   4. RLEIndex.at — O(log runs) "i-th element" lookup
//   5. RLEIndex.slice — sub-range extraction without full decode
//   6. Compression ratio on a realistic spatial grid (10k bodies → ~50 runs)
//
// Run with:  sbt "runMain nbody.Phase3Demo"
// ============================================================================

package nbody

import nbody.Phase0_Domain.*
import nbody.Phase3_RLE.*
import nbody.Phase3_RLE.RLE.Run
import nbody.Phase3_RLE.{*, given}

object Phase3Demo:

  // Tally of pass/fail across all self-checks
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

    println("=== Phase 3: RLE Compression Engine Demo ===")
    println()

    // ── 1. Basic encode/decode round-trip ────────────────────────────────
    println("--- 1. Basic encode/decode round-trip ---")
    val ints = Vector(1, 1, 1, 2, 2, 3, 1, 1, 1, 1)
    val runs = RLE.encode(ints)
    val back = RLE.decode(runs)
    println(s"  input  = $ints")
    println(s"  encode = ${runs.mkString(", ")}")
    println(s"  decode = $back")
    check("round-trip identity", back == ints,
      s"got $back, expected $ints")
    // RLE does NOT merge non-adjacent equal elements:
    // 1,1,1,2,2,3,1,1,1,1 → (1,3), (2,2), (3,1), (1,4)  = 4 runs
    check("run count = 4 (RLE preserves run identity, not set membership)",
      runs.length == 4, s"got ${runs.length}")
    check("first run is (1, 3)",
      runs.head == Run(1, 3), s"got ${runs.head}")
    println()

    // ── 2. Property tests ─────────────────────────────────────────────────
    println("--- 2. Property tests (laws) ---")

    // Property: decode(encode(xs)) == xs for any xs
    val testCases = List(
      Vector.empty[Int],
      Vector(42),
      Vector(1, 2, 3, 4, 5),               // no runs at all
      Vector(7, 7, 7, 7, 7, 7, 7),         // single run
      Vector(1, 1, 1, 2, 2, 3, 1, 1, 1, 1) // mixed
    )
    testCases.foreach { tc =>
      check(s"round-trip on $tc",
        RLE.decode(RLE.encode(tc)) == tc)
    }

    // Property: encode(xs).map(_.count).sum == xs.length (length preserved)
    testCases.foreach { tc =>
      val encoded = RLE.encode(tc)
      val total = encoded.map(_.count).sum
      check(s"length preserved on $tc (got $total, expected ${tc.length})",
        total == tc.length)
    }

    // Property: encode(Nil) == Nil
    check("encode(Nil) == Nil", RLE.encode(Vector.empty[Int]).isEmpty)

    // Property: encode(Vector(x)) == Vector((x, 1))
    check("encode(Vector(42)) == Vector(Run(42, 1))",
      RLE.encode(Vector(42)) == Vector(Run(42, 1)))
    println()

    // ── 3. Eq[Body] — same-ID bodies collapse into one run ───────────────
    println("--- 3. Eq[Body] (same-ID bodies merge despite different state) ---")
    // The same body (id=1) at three different positions — should compress
    // to ONE run of length 3, because Eq[Body] cares only about id.
    val body1a = Body(1L, Mass(1.0), Vec3(0, 0, 0))
    val body1b = Body(1L, Mass(1.0), Vec3(5, 0, 0))  // different position!
    val body1c = Body(1L, Mass(1.0), Vec3(10, 0, 0)) // different position!
    val body2  = Body(2L, Mass(2.0), Vec3(0, 0, 0))
    val bodies = Vector(body1a, body1b, body1c, body2)
    val bodyRuns = RLE.encode(bodies)
    println(s"  bodies        = $bodies")
    println(s"  bodyRuns      = ${bodyRuns.map(r => s"(id=${r.value.id}, n=${r.count})").mkString(", ")}")
    println(s"  (note: positions DIFFER, but IDs match → 1 run of length 3)")
    check("Eq[Body] collapses same-id bodies to one run",
      bodyRuns.length == 2, s"got ${bodyRuns.length} runs, expected 2")
    check("first body-run has count 3",
      bodyRuns.head.count == 3, s"got ${bodyRuns.head.count}")
    println()

    // ── 4. RLEIndex.at — O(log runs) lookup ──────────────────────────────
    println("--- 4. RLEIndex.at (O(log runs) i-th element lookup) ---")
    // Build a 1000-element Vector with 10 runs of length 100:
    //   100 zeros, 100 ones, 100 twos, ..., 100 nines.
    val big = (0 until 10).flatMap(i => Vector.fill(100)(i)).toVector
    val idx = RLEIndex.fromVector(big)
    println(s"  big.length = ${big.length}")
    println(s"  idx.runCount = ${idx.runCount}  (compressed from ${big.length} to ${idx.runCount})")
    println(s"  idx.length   = ${idx.length}")
    println(s"  idx.compressionRatio = ${idx.compressionRatio}")
    println()

    // Spot-check: positions 0, 99 → 0; 100, 199 → 1; ...; 900, 999 → 9
    check("idx.at(0)   == 0", idx.at(0)   == 0)
    check("idx.at(99)  == 0", idx.at(99)  == 0)
    check("idx.at(100) == 1", idx.at(100) == 1)
    check("idx.at(199) == 1", idx.at(199) == 1)
    check("idx.at(500) == 5", idx.at(500) == 5)
    check("idx.at(900) == 9", idx.at(900) == 9)
    check("idx.at(999) == 9", idx.at(999) == 9)

    // Property: idx.at(i) == big(i) for ALL i — exhaustively
    val allMatch = big.indices.forall(i => idx.at(i.toLong) == big(i))
    check(s"idx.at(i) == big(i) for ALL ${big.length} positions", allMatch)

    // Boundary: out-of-bounds returns None via atOption
    check("idx.atOption(-1)  == None", idx.atOption(-1).isEmpty)
    check("idx.atOption(1000) == None (length is 1000, last valid index 999)",
      idx.atOption(1000).isEmpty)
    println()

    // ── 5. RLEIndex.slice — sub-range without full decode ────────────────
    println("--- 5. RLEIndex.slice (sub-range extraction) ---")
    // Slice [95, 205) — crosses TWO run boundaries: 0s (positions 0..99)
    // → 1s (100..199) → 2s (200..299). So the slice ends with five 2s.
    val sliced = idx.slice(95L, 205L)
    val expectedSlice = big.slice(95, 205)
    println(s"  slice(95, 205) length = ${sliced.length}  (expected 110)")
    check("slice(95, 205) == big.slice(95, 205)",
      sliced == expectedSlice)
    check("slice(95, 205) starts with five 0s (positions 95..99)",
      sliced.take(5).forall(_ == 0))
    check("slice(95, 205) ends with five 2s (positions 200..204)",
      sliced.takeRight(5).forall(_ == 2))
    println()

    // ── 6. Compression ratio on a realistic spatial grid ─────────────────
    println("--- 6. Compression ratio on a 10k-body spatial grid ---")
    // Simulate a "spatially sorted" 10k-body Vector where each cell of a
    // 100×100 grid contains 100 identical-mass bodies. After spatial sort
    // this becomes 10000 entries with 100 distinct runs of length 100.
    // (Phase 5 will sort bodies into a Z-order curve before RLE.)
    val gridN = 10000
    val gridCells = 100
    val perCell = gridN / gridCells
    val grid = (0 until gridCells).flatMap(c => Vector.fill(perCell)(c)).toVector
    val gridIdx = RLEIndex.fromVector(grid)
    val gridRatio = gridIdx.compressionRatio
    val gridPctOfOriginal = gridIdx.runCount.toDouble * 100 / gridN
    println(s"  grid.length          = $gridN")
    println(s"  gridIdx.runCount     = ${gridIdx.runCount}")
    println(s"  gridIdx.length       = ${gridIdx.length}")
    println(f"  gridIdx.compressionRatio = $gridRatio%.1f×")
    println(f"  → $gridN bodies compressed to ${gridIdx.runCount} runs ($gridPctOfOriginal%.1f%% of original)")
    println()
    check(s"compression ratio ≈ ${perCell}.0× (10k → 100 runs)",
      math.abs(gridIdx.compressionRatio - perCell.toDouble) < 0.01,
      s"got ${gridIdx.compressionRatio}")

    // ── Final summary ────────────────────────────────────────────────────
    println("=== Phase 3 self-checks summary ===")
    println(s"  Passed: $passed")
    println(s"  Failed: $failed")
    if failed == 0 then
      println()
      println("Phase 3 RLE engine verified. Ready for Phase 4 (Double RLE).")
    else
      println()
      println(s"⚠ $failed self-check(s) failed — fix before proceeding.")
      sys.exit(1)
