// ============================================================================
// Alternative.scala — Pillar 3: "Choice Logic via <|>"
// ============================================================================
// Phase 1 deliverable per skills.md §2 Phase 1.
//
// Alternative extends Applicative by adding:
//   - empty  : the failing parser / no-result
//   - <|>    : try left; if it fails, fall back to right
//
// Used by the JSON value parser in Phase 2 to express:
//   value = nullP <|> boolP <|> intP <|> strP <|> arrP <|> objP
//
// Zero-dependency: ~8 lines. No Cats needed.
// ============================================================================

package nbody.Phase1_Typeclasses

trait Alternative[F[_]] extends Applicative[F]:
  // The empty / failing case
  def empty[A]: F[A]

  // Choice: try left first, fall back to right on failure
  extension [A](fa: F[A])
    def <|>(fb: => F[A]): F[A]

  // Convenience: alias named `orElse` for non-symbolic contexts
  extension [A](fa: F[A])
    def orElse(fb: => F[A]): F[A] = fa <|> fb

  // `many` and `some` derived from empty + <|>  (classic Alternative combo)
  extension [A](fa: F[A])
    // Zero or more fa's
    def many: F[List[A]] =
      some <|> Alternative.this.pure(Nil)
    // One or more fa's
    def some: F[List[A]] =
      fa.map2(fa.many)(_ :: _)

object Alternative:
  // Guard: succeed with unit if cond holds, else empty
  def guard[F[_], A](cond: Boolean)(using F: Alternative[F]): F[Unit] =
    if cond then F.pure(()) else F.empty
