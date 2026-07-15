// ============================================================================
// Functor.scala — Pillar 3 Mathematical Abstraction: "Penetration Operation"
// ============================================================================
// Phase 1 deliverable per skills.md §2 Phase 1.
//
// A Functor lets us apply a function f: A => B to the value INSIDE a
// container F[A] without unwrapping it. In the framework's terminology,
// this is the "penetration" operation — f "penetrates" the F[_] context.
//
// Zero-dependency: defined here from scratch, ~5 lines. No Cats needed.
// ============================================================================

package nbody.Phase1_Typeclasses

trait Functor[F[_]]:
  extension [A](fa: F[A])
    def map[B](f: A => B): F[B]

// Universal helper — works for any F with a given Functor
object Functor:
  // Lift a plain function A => B into F[A] => F[B]
  def lift[F[_], A, B](f: A => B)(using F: Functor[F]): F[A] => F[B] =
    fa => fa.map(f)
