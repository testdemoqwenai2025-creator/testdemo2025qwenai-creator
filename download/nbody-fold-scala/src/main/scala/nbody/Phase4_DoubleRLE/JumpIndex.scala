// ============================================================================
// JumpIndex.scala — O(log doubleRuns) "Mathematical Jumping" lookup
// ============================================================================
// Phase 4 deliverable per skills.md §2 Phase 4.
//
// JumpIndex is the DoubleRLE analogue of Phase 3's RLEIndex. Where RLEIndex
// answers "what is the i-th element?" in O(log runs), JumpIndex answers the
// same question in O(log doubleRuns).
//
// ── The key insight ─────────────────────────────────────────────────────
// A DoubleRun ((a, k), m) spans k * m elements, ALL EQUAL TO a. So once
// we know which DoubleRun contains position i, we're done — no second-level
// search inside the DoubleRun is needed. The "two-level" in the spec refers
// to CONSTRUCTION (prefix-sum of runs, then prefix-sum of double-runs), not
// to LOOKUP. Lookup is a single binary search.
//
// ── Algorithm ───────────────────────────────────────────────────────────
// Construction:
//   For each DoubleRun dr, compute dr.span = innerCount * outerCount.
//   Build prefixSum: prefixSum(j) = total span of DoubleRuns 0..j-1.
//   prefixSum(0) = 0; prefixSum(doubleRuns.length) = total decoded length.
//
// jumpTo(i):
//   Binary-search prefixSum for the largest j such that prefixSum(j) <= i.
//   Return doubleRuns(j).value.
//
// Time:  O(log doubleRuns) per lookup
// Space: O(doubleRuns) for prefixSum
//
// ── When does this beat RLEIndex? ───────────────────────────────────────
// When doubleRuns < runs. For data where adjacent runs rarely repeat the
// same (value, count) pair, doubleRuns ≈ runs and JumpIndex offers no
// benefit. For periodic data (e.g. a 1M-body spatial grid with 1000
// repeated cells), doubleRuns ≪ runs and the speedup is dramatic.
//
// JumpIndex supports a graceful fallback: if doubleRuns == runs (no
// second-level compression), the result is identical to RLEIndex — the
// caller doesn't need to pick between them at the API boundary.
// ============================================================================

package nbody.Phase4_DoubleRLE

import DoubleRLE.DoubleRun

final class JumpIndex[A] private (
  private val doubleRuns: Vector[DoubleRun[A]],
  private val prefixSum:  Vector[Long]    // length = doubleRuns.length + 1; prefixSum(0) = 0
):
  // Total number of decoded elements (the original N)
  def length: Long = prefixSum.last

  // Number of DoubleRun entries (the compressed size)
  def doubleRunCount: Int = doubleRuns.length

  // Double compression ratio (decoded / doubleRuns)
  def compressionRatio: Double = DoubleRLE.compressionRatio2(doubleRuns)

  // ── jumpTo: O(log doubleRuns) i-th element lookup ─────────────────────
  // Precondition: 0 <= i < length
  // Returns:      the value of the DoubleRun that contains position i
  //
  // Why this is a single binary search (not two):
  //   A DoubleRun ((a, k), m) spans k*m elements, ALL EQUAL TO a.
  //   Once we locate the DoubleRun, we know the value — no inner search.
  def jumpTo(i: Long): A =
    require(i >= 0 && i < length,
      s"JumpIndex.jumpTo: index $i out of bounds [0, $length)")
    // Binary search for the largest j such that prefixSum(j) <= i.
    // Invariant: prefixSum(lo) <= i < prefixSum(hi)
    var lo = 0
    var hi = prefixSum.length - 1
    while hi - lo > 1 do
      val mid = (lo + hi) >>> 1
      if prefixSum(mid) <= i then lo = mid
      else hi = mid
    doubleRuns(lo).value
  end jumpTo

  // Total version of jumpTo
  def jumpToOption(i: Long): Option[A] =
    if i >= 0 && i < length then Some(jumpTo(i)) else None

  // ── doubleRunAt: locate which DoubleRun contains position i ───────────
  // Returns (doubleRunIdx, offsetWithinDoubleRun). Useful for diagnostic
  // introspection and for Phase 5's force aggregation: if you want to
  // "skip the next m identical contributions", you can read m directly
  // from doubleRuns(idx).outerCount.
  def doubleRunAt(i: Long): (Int, Long) =
    require(i >= 0 && i < length,
      s"JumpIndex.doubleRunAt: index $i out of bounds [0, $length)")
    var lo = 0
    var hi = prefixSum.length - 1
    while hi - lo > 1 do
      val mid = (lo + hi) >>> 1
      if prefixSum(mid) <= i then lo = mid
      else hi = mid
    (lo, i - prefixSum(lo))
  end doubleRunAt

  // ── slice: extract a sub-range without full decode ────────────────────
  // Returns Vector[A] for the decoded range [from, until).
  // Long ranges are O(range-length); short ranges inside long double-runs
  // are O(log doubleRuns + range-length).
  def slice(from: Long, until: Long): Vector[A] =
    require(from >= 0 && from <= until && until <= length,
      s"JumpIndex.slice: range [$from, $until) out of bounds [0, $length)")
    val builder = Vector.newBuilder[A]
    var i = from
    while i < until do
      val (drIdx, offset) = doubleRunAt(i)
      val dr = doubleRuns(drIdx)
      val remaining = until - i
      val available = dr.span - offset
      val take = math.min(remaining, available).toInt
      var k = 0
      while k < take do
        builder += dr.value
        k += 1
      i += take.toLong
    builder.result()
  end slice

  // Materialize the full decoded Vector (loses the compression benefit)
  def toVector: Vector[A] = DoubleRLE.decode2(doubleRuns)

  // ── Diagnostic: report the "Mathematical Jumping" speedup vs. RLEIndex ─
  // Returns (singleRunCount, doubleRunCount, speedupFactor) where
  // speedupFactor = singleRunCount / doubleRunCount (how many fewer binary
  // search steps in the best case).
  def speedupVsRLEIndex: (Int, Int, Double) =
    // Reconstruct the single-RLE run count: each DoubleRun with outerCount=m
    // contributes m single-runs.
    val singleRunCount = doubleRuns.map(_.outerCount).sum
    val speedup = if doubleRunCount == 0 then 1.0
                  else singleRunCount.toDouble / doubleRunCount.toDouble
    (singleRunCount, doubleRunCount, speedup)

  override def toString: String =
    val (sr, dr, sp) = speedupVsRLEIndex
    f"JumpIndex(doubleRuns=$dr, singleRuns=$sr, length=$length, speedup=${sp}%.1f×)"

object JumpIndex:
  // Smart constructor: build prefixSum at construction time.
  def apply[A](doubleRuns: Vector[DoubleRun[A]]): JumpIndex[A] =
    val ps = Vector.newBuilder[Long]
    ps += 0L
    var acc = 0L
    doubleRuns.foreach { dr => acc += dr.span; ps += acc }
    new JumpIndex(doubleRuns, ps.result())

  // Build directly from a decoded Vector — convenience for testing.
  def fromVector[A](as: Vector[A])(using E: nbody.Phase3_RLE.Eq[A]): JumpIndex[A] =
    apply(DoubleRLE.encode2(as))
