// ============================================================================
// Monoid.scala — Pillar 3: "Identity and Indexing"
// ============================================================================
// Phase 1 deliverable per skills.md §2 Phase 1.
//
// A Monoid is a set with an associative binary operation and an identity
// element. It's the algebra that makes `fold` work.
//
// The framework uses Monoids in two ways:
//   1. Indexing/positioning — `Min` Monoid tracks earliest token position
//      for granular error reporting (Phase 2 will use this).
//   2. Aggregation — the bottom-up force fold in Phase 5 aggregates
//      gravitational contributions using `Monoid[Vec3]` (vector addition)
//      and `Monoid[Double]` (sum of energy contributions).
//
// Zero-dependency: ~6 lines for the trait. No Cats needed.
// ============================================================================

package nbody.Phase1_Typeclasses

trait Monoid[A]:
  // Identity element: combine(x, empty) == x == combine(empty, x)
  def empty: A
  // Associative binary operation
  def combine(a: A, b: A): A

object Monoid:
  // Summoner — `Monoid[A]` syntax for given instances
  def apply[A](using M: Monoid[A]): Monoid[A] = M

  // ── Given instances ────────────────────────────────────────────────────

  // Double forms a Monoid under addition — used to aggregate energy, mass, etc.
  given Monoid[Double] with
    def empty: Double = 0.0
    def combine(a: Double, b: Double): Double = a + b

  // Int forms a Monoid under addition — used for body counts
  given Monoid[Int] with
    def empty: Int = 0
    def combine(a: Int, b: Int): Int = a + b

  // List[A] forms a Monoid under concatenation — universal fallback
  given [A]: Monoid[List[A]] with
    def empty: List[A] = Nil
    def combine(a: List[A], b: List[A]): List[A] = a ++ b

  // ── The "Min" Monoid for indexing/positioning (Pillar 3 §IV) ───────────
  // Used to track the minimum starting index of a token in the input stream,
  // enabling granular error reporting. None = "no position seen yet".
  given Monoid[Option[Long]] with
    def empty: Option[Long] = None
    def combine(a: Option[Long], b: Option[Long]): Option[Long] = (a, b) match
      case (None,    y)       => y
      case (x,       None)    => x
      case (Some(x), Some(y)) => Some(math.min(x, y))
