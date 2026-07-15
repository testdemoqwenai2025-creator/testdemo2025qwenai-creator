// ============================================================================
// RLE.scala — Run-Length Encoding over Vector[A]
// ============================================================================
// Phase 3 deliverable per skills.md §2 Phase 3.
//
// Run-Length Encoding (RLE) compresses a sequence by replacing each maximal
// run of consecutive identical elements with a single (element, count) pair.
//
//   Vector(1, 1, 1, 2, 2, 3)  →  Vector((1, 3), (2, 2), (3, 1))
//
// The compression ratio depends on the input: random data compresses 1:1
// (every run is length 1, so we double the storage); highly repetitive
// data compresses dramatically. For Phase 5's N-Body engine this is the
// first half of "Computational Arbitrage" (Pillar 5): if 1000 bodies in
// a far cluster have identical (or near-identical) acceleration contributions
// to a near body, we compute ONE force and apply it 1000 times — turning
// O(N²) into O(runs × cost-per-run).
//
// Compression algorithm: single-pass tail-recursive scan. O(n) time, O(runs)
// space. No mutation, no allocation beyond the result Vector.
//
// Decompression algorithm: single-pass flatMap. O(n) time, O(n) space.
//
// Laws (property tests in Phase3Demo):
//   1. decode(encode(xs)) == xs                  (round-trip identity)
//   2. encode(xs).map(_._2).sum == xs.length     (length preserved)
//   3. encode(xs).map(_._1).distinct.length <= xs.length  (no spurious runs)
//   4. encode(Nil) == Nil                        (empty input)
//   5. encode(Vector(x)) == Vector((x, 1))       (singleton)
// ============================================================================

package nbody.Phase3_RLE

object RLE:

  // ── Core types ─────────────────────────────────────────────────────────
  // A run is (element, count). We use a named case class rather than a Tuple2
  // for clarity in pattern matching and for self-documenting signatures.
  final case class Run[A](value: A, count: Int):
    require(count > 0, s"RLE.Run.count must be > 0, got $count")
    override def toString: String = s"($value, $count)"

  // ── encode ─────────────────────────────────────────────────────────────
  // Scan a Vector[A], collapsing maximal runs of equal elements (per Eq[A])
  // into Run[A] pairs. Empty input → empty output.
  //
  // Time:  O(n)
  // Space: O(runs) for the output Vector
  def encode[A](as: Vector[A])(using E: Eq[A]): Vector[Run[A]] =
    if as.isEmpty then Vector.empty
    else
      // Tail-recursive scan: walk through `as` building up runs.
      // `acc` is built in reverse (cons to head) for O(1) append, then
      // reversed at the end. Standard functional-programming idiom.
      @scala.annotation.tailrec
      def loop(remaining: Vector[A], current: A, runLen: Int,
               acc: Vector[Run[A]]): Vector[Run[A]] =
        if remaining.isEmpty then
          acc :+ Run(current, runLen)
        else
          val next = remaining.head
          if E.eqv(current, next) then
            loop(remaining.tail, current, runLen + 1, acc)
          else
            loop(remaining.tail, next, 1, acc :+ Run(current, runLen))
      end loop

      loop(as.tail, as.head, 1, Vector.empty)
  end encode

  // ── decode ─────────────────────────────────────────────────────────────
  // Expand a Vector[Run[A]] back into Vector[A]. The dual of `encode`.
  //
  // Time:  O(n)  where n = total decoded length
  // Space: O(n)
  def decode[A](runs: Vector[Run[A]]): Vector[A] =
    runs.flatMap { case Run(v, n) => Vector.fill(n)(v) }

  // ── Convenience: encode/decode on plain Tuple2 form ────────────────────
  // Some consumers (e.g. Phase 4's DoubleRLE) prefer the unboxed Tuple2
  // representation to avoid the Run[A] wrapper. We provide translations.

  def encodeTuples[A](as: Vector[A])(using E: Eq[A]): Vector[(A, Int)] =
    encode(as).map(r => (r.value, r.count))

  def decodeTuples[A](tuples: Vector[(A, Int)]): Vector[A] =
    decode(tuples.map { case (v, n) => Run(v, n) })

  // ── Statistics for diagnostics ─────────────────────────────────────────
  // Compression ratio: decoded-length / encoded-length. >1 means we saved
  // space; <1 means we inflated (e.g. on random data).
  def compressionRatio[A](runs: Vector[Run[A]]): Double =
    if runs.isEmpty then 1.0
    else
      val decoded = runs.map(_.count).sum.toDouble
      val encoded = runs.length.toDouble
      decoded / encoded

  // Total decoded length without materializing the decode
  def decodedLength[A](runs: Vector[Run[A]]): Long =
    runs.foldLeft(0L)((acc, r) => acc + r.count)
