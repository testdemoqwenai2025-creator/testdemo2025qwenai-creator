// ============================================================================
// RLEIndex.scala — O(log N) "what is the i-th element?" lookup over RLE
// ============================================================================
// Phase 3 deliverable per skills.md §2 Phase 3.
//
// Once we've encoded a Vector[A] as Vector[Run[A]], naive decoding to look
// up element i would be O(n) — defeating the whole point of compression.
// RLEIndex precomputes a prefix-sum array of run lengths so that "what is
// the i-th element?" becomes a binary search:
//
//   prefixSum = [0, run[0].count, run[0].count + run[1].count, ...]
//   prefixSum(k) = total length of runs 0..k-1 (cumulative)
//
// To find element i, binary-search prefixSum for the largest k such that
// prefixSum(k) <= i. Then runs(k).value is the answer.
//
// Time complexity:
//   Construction:   O(runs)         — single pass to build prefixSum
//   Lookup:         O(log runs)     — binary search
//   vs. naive:      O(decoded-len)  — full decode + index
//
// For a 1M-body dataset that compresses to 1000 runs, lookup goes from
// ~1M operations to ~10 — a 100,000× speedup. This is the engine of
// Pillar 5 (Computational Arbitrage) at the index level.
//
// Phase 4 will extend this to a two-level JumpIndex that achieves
// O(log log N) via two stacked binary searches.
// ============================================================================

package nbody.Phase3_RLE

import RLE.Run

final class RLEIndex[A] private (
  private val runs:      Vector[Run[A]],
  private val prefixSum: Vector[Long]   // length = runs.length + 1; prefixSum(0) = 0
):
  // Total number of decoded elements
  def length: Long = prefixSum.last

  // Number of encoded runs (the compressed size)
  def runCount: Int = runs.length

  // Compression ratio (decoded / encoded)
  def compressionRatio: Double = RLE.compressionRatio(runs)

  // ── at: O(log runs) lookup of the i-th decoded element ────────────────
  // Precondition: 0 <= i < length
  // Returns:       the value of the run that contains position i
  def at(i: Long): A =
    require(i >= 0 && i < length,
      s"RLEIndex.at: index $i out of bounds [0, $length)")
    // Binary search for the largest k such that prefixSum(k) <= i.
    // Invariant: prefixSum(lo) <= i < prefixSum(hi)
    var lo = 0
    var hi = prefixSum.length - 1
    while hi - lo > 1 do
      val mid = (lo + hi) >>> 1
      if prefixSum(mid) <= i then lo = mid
      else hi = mid
    runs(lo).value
  end at

  // ── atOption: total version of `at` ────────────────────────────────────
  // Returns Some(value) for in-bounds i, None for out-of-bounds.
  // Useful when the precondition cannot be statically guaranteed.
  def atOption(i: Long): Option[A] =
    if i >= 0 && i < length then Some(at(i)) else None

  // ── runAt: which run contains position i, and what's the offset? ──────
  // Returns (runIndex, offsetWithinRun). Useful for Phase 5 force folding:
  // if you want to compute "force contribution from bodies 1000..2000" you
  // first locate the run covering position 1000, then walk runs.
  def runAt(i: Long): (Int, Long) =
    require(i >= 0 && i < length,
      s"RLEIndex.runAt: index $i out of bounds [0, $length)")
    var lo = 0
    var hi = prefixSum.length - 1
    while hi - lo > 1 do
      val mid = (lo + hi) >>> 1
      if prefixSum(mid) <= i then lo = mid
      else hi = mid
    (lo, i - prefixSum(lo))
  end runAt

  // ── slice: extract a sub-range without full decode ────────────────────
  // Returns Vector[A] for the decoded range [from, until).
  // For long sub-ranges this is O(range-length), same as naive — but for
  // short sub-ranges inside long runs it's O(log runs + range-length).
  // Phase 5 will use this for streaming windowed force computation.
  def slice(from: Long, until: Long): Vector[A] =
    require(from >= 0 && from <= until && until <= length,
      s"RLEIndex.slice: range [$from, $until) out of bounds [0, $length)")
    val builder = Vector.newBuilder[A]
    var i = from
    while i < until do
      val (runIdx, offset) = runAt(i)
      val run = runs(runIdx)
      // How many elements of this run are still in our range?
      val remaining = until - i
      val available = run.count.toLong - offset
      val take = math.min(remaining, available).toInt
      var k = 0
      while k < take do
        builder += run.value
        k += 1
      i += take.toLong
    builder.result()
  end slice

  // Materialize the full decoded Vector (loses the compression benefit)
  def toVector: Vector[A] = RLE.decode(runs)

  override def toString: String =
    s"RLEIndex(runCount=$runCount, length=$length, ratio=${compressionRatio}%.2f)"

object RLEIndex:
  // Smart constructor: build prefixSum at construction time.
  def apply[A](runs: Vector[Run[A]]): RLEIndex[A] =
    // Build prefix sum: prefixSum(k) = sum of runs(0..k-1).count
    // prefixSum(0) = 0, prefixSum(runs.length) = total length
    val ps = Vector.newBuilder[Long]
    ps += 0L
    var acc = 0L
    runs.foreach { r => acc += r.count; ps += acc }
    new RLEIndex(runs, ps.result())

  // Build directly from a decoded Vector — convenience for testing.
  def fromVector[A](as: Vector[A])(using E: Eq[A]): RLEIndex[A] =
    apply(RLE.encode(as))
