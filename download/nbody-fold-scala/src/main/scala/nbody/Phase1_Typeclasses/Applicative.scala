// ============================================================================
// Applicative.scala — Pillar 3: "Chaining and the Epic Move sequenceA"
// ============================================================================
// Phase 1 deliverable per skills.md §2 Phase 1.
//
// Applicative extends Functor by allowing us to chain computations where
// the function itself is inside the context (F[A => B]). It also gives
// us `pure` for lifting a plain value into the context.
//
// The "Epic Move" — `sequenceA` — turns a List[F[A]] into F[List[A]].
// For Parsers this means: "a list of parsers" becomes "a parser of a
// list". This is the canonical tool for inverting layers of effects,
// used heavily in Phase 2 (JSON object/array parsing).
//
// Zero-dependency: ~12 lines. No Cats needed.
// ============================================================================

package nbody.Phase1_Typeclasses

trait Applicative[F[_]] extends Functor[F]:
  // Lift a plain value into the context
  def pure[A](a: A): F[A]

  // Apply a function inside the context to a value inside the context
  extension [A](fa: F[A])
    def ap[B](ff: F[A => B]): F[B]

  // Default `map` derived from `pure` + `ap`
  extension [A](fa: F[A])
    override def map[B](f: A => B): F[B] =
      fa.ap(pure(f))

  // Sequencing helper: discard left, keep right (used by `*>` and `<*`)
  // IMPORTANT: ap runs `pf` first, then `pa` on the rest. So to sequence
  // `fa` then `fb`, we need `fb.ap(fa.map(a => b => f(a, b)))` — fa runs
  // first (as pf), fb runs second (as pa).
  extension [A](fa: F[A])
    def map2[B, C](fb: F[B])(f: (A, B) => C): F[C] =
      fb.ap(fa.map(a => (b: B) => f(a, b)))

  // Sequence two effects, keep the LEFT result (discard right)
  extension [A](fa: F[A])
    def <* [B](fb: F[B]): F[A] = fa.map2(fb)((a, _) => a)

  // Sequence two effects, keep the RIGHT result (discard left)
  extension [A](fa: F[A])
    def *> [B](fb: F[B]): F[B] = fa.map2(fb)((_, b) => b)

object Applicative:

  // ─── The "Epic Move" — sequenceA ──────────────────────────────────────
  // Turns F[A] × F[A] × ... × F[A]  (a List of effects)
  //  into F[List[A]]                  (an effect containing a list)
  def sequenceA[F[_], A](fas: List[F[A]])(using F: Applicative[F]): F[List[A]] =
    fas match
      case Nil    => F.pure(Nil)
      case h :: t => h.map2(sequenceA(t))(_ :: _)

  // Replicate a single effect n times into F[List[A]]
  def replicateA[F[_], A](n: Int, fa: F[A])(using F: Applicative[F]): F[List[A]] =
    if n <= 0 then F.pure(Nil)
    else fa.map2(replicateA(n - 1, fa))(_ :: _)
