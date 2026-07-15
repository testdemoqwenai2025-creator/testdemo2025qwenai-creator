// ============================================================================
// Eq.scala — Typeclass for decoupled equality
// ============================================================================
// Phase 3 deliverable per skills.md §2 Phase 3.
//
// `Eq[A]` is a typeclass that captures "what does it mean for two A values to
// be equal?" WITHOUT committing to Scala's universal `==` (which is defined
// for every type via AnyRef.equals / AnyVal ==).
//
// Why decouple from `==`?
//   For RLE we want to encode *runs of identical elements*. For `Int` and
//   `Double`, "identical" means value equality — and `==` does the right
//   thing. But for `Body`, "identical" should mean "same ID", NOT "same
//   state" — because two bodies with the same ID but different positions
//   are still the same physical entity, just at different times. Using
//   `==` for Body would compare all fields (id, mass, pos, vel, acc) and
//   fail to merge runs of the same body across timesteps.
//
//   The Eq typeclass lets us say exactly what "identical" means per type,
//   in a way the RLE encoder can consume generically.
//
// Zero-dependency: ~6 lines for the trait. No Cats needed.
// ============================================================================

package nbody.Phase3_RLE

trait Eq[A]:
  // Are a and b equal under this Eq's notion of equality?
  def eqv(a: A, b: A): Boolean

  // Convenience: neqv is the negation of eqv
  def neqv(a: A, b: A): Boolean = !eqv(a, b)

object Eq:
  // Summoner — `Eq[A]` syntax for given instances
  def apply[A](using E: Eq[A]): Eq[A] = E

  // ── Universal instance constructor ─────────────────────────────────────
  // Build an Eq from an explicit equality function — useful for one-off
  // cases where defining a `given` would be overkill.
  def instance[A](f: (A, A) => Boolean): Eq[A] = new Eq[A]:
    def eqv(a: A, b: A): Boolean = f(a, b)

  // ── Given instances for primitives ─────────────────────────────────────
  // For value types, "identical" = value equality.

  given Eq[Int] with
    def eqv(a: Int, b: Int): Boolean = a == b

  given Eq[Long] with
    def eqv(a: Long, b: Long): Boolean = a == b

  given Eq[Double] with
    def eqv(a: Double, b: Double): Boolean = a == b

  given Eq[Boolean] with
    def eqv(a: Boolean, b: Boolean): Boolean = a == b

  given Eq[String] with
    def eqv(a: String, b: String): Boolean = a == b

  // ── Structural equality for case-class-like types ─────────────────────
  // For Vec3 we want component-wise equality (NOT reference equality).
  // This is needed because RLE on a Vector[Vec3] should merge adjacent
  // equal vectors regardless of object identity.
  given Eq[nbody.Phase0_Domain.Vec3] with
    def eqv(a: nbody.Phase0_Domain.Vec3, b: nbody.Phase0_Domain.Vec3): Boolean =
      a.x == b.x && a.y == b.y && a.z == b.z
