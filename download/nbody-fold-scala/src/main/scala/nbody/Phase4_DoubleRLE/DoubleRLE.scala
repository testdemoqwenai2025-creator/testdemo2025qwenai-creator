// ============================================================================
// DoubleRLE.scala — Run-Length Encoding applied twice ("Mathematical Jumping")
// ============================================================================
// Phase 4 deliverable per skills.md §2 Phase 4.
//
// Single RLE compresses runs of identical ELEMENTS:
//   Vector(1,1,1, 2,2, 1,1,1, 2,2, 1,1,1, 2,2)
//     → Vector((1,3), (2,2), (1,3), (2,2), (1,3), (2,2))    [6 runs]
//
// DoubleRLE compresses runs of identical (element, count) PAIRS:
//   Vector((1,3), (2,2), (1,3), (2,2), (1,3), (2,2))
//     → Vector(((1,3), 3), ((2,2), 3))                       [2 double-runs]
//
// The outer count "m" in ((a, k), m) means: m consecutive inner runs, each
// of value `a` and length `k`. Total span = k * m elements, all equal to `a`.
//
// ── Why this is "Mathematical Jumping" ──────────────────────────────────
// When jumping to position i in the original sequence:
//   • Direct index:    O(1) but requires decoded storage O(N)
//   • RLEIndex:        O(log runs)        — binary search over runs
//   • JumpIndex:       O(log doubleRuns)  — binary search over double-runs
//
// For highly periodic data, doubleRuns << runs:
//   • 1M elements, period 1000 → ~1000 runs → ~1-2 double-runs
//   • Lookup time: ~1 operation instead of ~10
//
// For unstructured data, doubleRuns ≈ runs (no compression at the second
// level — every (value, count) pair is unique). JumpIndex still works but
// gives no asymptotic benefit. The "Computational Arbitrage" pillar pays
// off only when the data has exploitable structure.
//
// ── Asymptotic complexity ───────────────────────────────────────────────
// The spec calls this "O(log log N)" in the best case. That holds when
// doubleRuns is logarithmic in N — which requires exponential self-similar
// structure (e.g. period-doubling patterns). For typical scientific data
// (spatial grids, clustered particle distributions) the practical bound
// is O(log doubleRuns), with doubleRuns ≪ runs ≪ N. Phase 9 will
// benchmark the actual speedup on realistic inputs.
// ============================================================================

package nbody.Phase4_DoubleRLE

import nbody.Phase3_RLE.*
import nbody.Phase3_RLE.RLE.Run
import nbody.Phase3_RLE.{Eq, given}   // brings Eq[(A, Int)] into scope via the
                                       // compositional given [A,B]: Eq[(A,B)]

object DoubleRLE:

  // ── Core type ──────────────────────────────────────────────────────────
  // A DoubleRun is ((value, innerCount), outerCount):
  //   - value:       the element value `a`
  //   - innerCount:  k — length of each inner run
  //   - outerCount:  m — number of consecutive inner runs of (a, k)
  // Total span = k * m elements, all equal to `a`.
  //
  // We use a named case class for clarity rather than the raw ((A, Int), Int)
  // tuple form. The encode2Tuples / decode2Tuples helpers below bridge to
  // the tuple form specified in skills.md.
  final case class DoubleRun[A](value: A, innerCount: Int, outerCount: Int):
    require(innerCount > 0, s"DoubleRun.innerCount must be > 0, got $innerCount")
    require(outerCount > 0, s"DoubleRun.outerCount must be > 0, got $outerCount")

    // Total span in the original (decoded) sequence
    def span: Long = innerCount.toLong * outerCount.toLong

    override def toString: String = s"(($value, $innerCount), $outerCount)"

  // ── encode2: two-pass RLE ──────────────────────────────────────────────
  // Pass 1: RLE the original sequence  → Vector[Run[A]]  (= Vector[(A, Int)])
  // Pass 2: RLE the runs               → Vector[Run[(A, Int)]]  (= Vector[((A, Int), Int)])
  //
  // Pass 2 requires Eq[(A, Int)] — automatically derived from Eq[A] + Eq[Int]
  // via the compositional given instance in RLEInstances.scala.
  //
  // Time:  O(n) for pass 1 + O(runs) for pass 2 = O(n) total
  // Space: O(doubleRuns) for the output
  def encode2[A](as: Vector[A])(using E: Eq[A]): Vector[DoubleRun[A]] =
    // Pass 1: standard RLE
    val runs: Vector[Run[A]] = RLE.encode(as)
    // Pass 2: RLE on (value, count) pairs. Eq[(A, Int)] is automatically
    // derived from Eq[A] + Eq[Int] via the compositional given instance
    // defined in RLEInstances.scala (given [A, B]: Eq[(A, B)]).
    // No explicit summon needed — the import `nbody.Phase3_RLE.{Eq, given}`
    // at the top of this file brings both the Eq trait and all its given
    // instances (including the compositional pair instance) into scope.
    val pairEq: Eq[(A, Int)] = summon[Eq[(A, Int)]]
    val doubleRuns: Vector[Run[(A, Int)]] =
      RLE.encode(runs.map(r => (r.value, r.count)))(using pairEq)
    // Translate to named DoubleRun form
    doubleRuns.map { dr =>
      DoubleRun(
        value      = dr.value._1,
        innerCount = dr.value._2,
        outerCount = dr.count
      )
    }

  // ── decode2: invert encode2 ────────────────────────────────────────────
  // Expand each DoubleRun ((a, k), m) into m × k copies of a.
  // Time:  O(n)  where n = total decoded length
  // Space: O(n)
  def decode2[A](doubleRuns: Vector[DoubleRun[A]]): Vector[A] =
    doubleRuns.flatMap { dr =>
      // m copies of (k copies of a) = m * k copies of a
      Vector.fill(dr.outerCount * dr.innerCount)(dr.value)
    }

  // ── Tuple-form helpers (for skills.md API compliance) ─────────────────
  // skills.md specifies: encode2 : Vector[A] → Vector[((A, Int), Int)]
  // These helpers expose that exact signature for downstream consumers
  // that prefer the tuple representation.
  def encode2Tuples[A](as: Vector[A])(using E: Eq[A]): Vector[((A, Int), Int)] =
    encode2(as).map(dr => ((dr.value, dr.innerCount), dr.outerCount))

  def decode2Tuples[A](tuples: Vector[((A, Int), Int)]): Vector[A] =
    decode2(tuples.map { case ((v, k), m) => DoubleRun(v, k, m) })

  // ── Statistics for diagnostics ─────────────────────────────────────────
  // Double compression ratio: (decoded length) / (doubleRuns length).
  // Combined with the single-RLE ratio this tells you how much each level
  // contributed to the overall compression.
  def compressionRatio2[A](doubleRuns: Vector[DoubleRun[A]]): Double =
    if doubleRuns.isEmpty then 1.0
    else
      val decoded = doubleRuns.map(_.span).sum.toDouble
      val encoded = doubleRuns.length.toDouble
      decoded / encoded

  // Total decoded length without materializing
  def decodedLength2[A](doubleRuns: Vector[DoubleRun[A]]): Long =
    doubleRuns.foldLeft(0L)((acc, dr) => acc + dr.span)

  // ── Compose with single RLE for diagnostics ───────────────────────────
  // Returns (singleRatio, doubleRatio, combinedRatio) for a given input.
  //   singleRatio = N / runs
  //   doubleRatio = runs / doubleRuns
  //   combined    = N / doubleRuns  (= single × double)
  def compressionBreakdown[A](as: Vector[A])(using E: Eq[A]): (Double, Double, Double) =
    val runs = RLE.encode(as)
    val doubleRuns = encode2(as)
    val n = as.length.toDouble
    val r = runs.length.toDouble
    val dr = doubleRuns.length.toDouble
    val single = if r == 0 then 1.0 else n / r
    val double = if dr == 0 then 1.0 else r / dr
    val combined = if dr == 0 then 1.0 else n / dr
    (single, double, combined)
