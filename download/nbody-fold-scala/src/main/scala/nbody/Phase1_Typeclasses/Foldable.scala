// ============================================================================
// Foldable.scala — Pillar 5: "Bottom-Up State Simulation via Folds"
// ============================================================================
// Phase 1 deliverable per skills.md §2 Phase 1.
//
// Two abstractions in this file:
//
//   1. Foldable[F[_]] — the standard math abstraction for containers
//      (List, Option, etc.). Used in Phase 2's Parser combinator.
//
//   2. BodyFoldable[A] — a domain-specific foldable for our hierarchy.
//      Component, ComponentVector, Entity, System are NOT type constructors
//      (they're concrete case classes holding Vector[Body]); the standard
//      Foldable[F[_]] signature doesn't fit. Rather than awkwardly making
//      them higher-kinded, we define a focused typeclass that captures
//      exactly what we need: "things that can fold over the bodies they
//      contain". This is the framework's literate-clarity principle applied.
//
// The bottom-up fold in Phase 5 uses BodyFoldable to aggregate force
// contributions across the hierarchy Component → ComponentVector →
// Entity → System.
// ============================================================================

package nbody.Phase1_Typeclasses

import nbody.Phase0_Domain.*

// ── General Foldable for type constructors (List, Option, …) ──────────────
trait Foldable[F[_]]:
  def foldLeft[A, B](fa: F[A], z: B)(f: (B, A) => B): B
  def foldRight[A, B](fa: F[A], z: B)(f: (A, B) => B): B
  def foldMap[A, B](fa: F[A])(f: A => B)(using M: Monoid[B]): B =
    foldLeft(fa, M.empty)((acc, a) => M.combine(acc, f(a)))
  def fold[A: Monoid](fa: F[A]): A = foldMap(fa)(identity)
  def size[A](fa: F[A]): Int = foldMap(fa)(_ => 1)(using summon[Monoid[Int]])

object Foldable:
  def apply[F[_]](using F: Foldable[F]): Foldable[F] = F

  // ── Standard Foldable instances for List and Option ───────────────────
  given Foldable[List] with
    def foldLeft[A, B](fa: List[A], z: B)(f: (B, A) => B): B = fa.foldLeft(z)(f)
    def foldRight[A, B](fa: List[A], z: B)(f: (A, B) => B): B = fa.foldRight(z)(f)

  given Foldable[Option] with
    def foldLeft[A, B](fa: Option[A], z: B)(f: (B, A) => B): B =
      fa match { case Some(a) => f(z, a); case None => z }
    def foldRight[A, B](fa: Option[A], z: B)(f: (A, B) => B): B =
      fa match { case Some(a) => f(a, z); case None => z }

  given Foldable[Vector] with
    def foldLeft[A, B](fa: Vector[A], z: B)(f: (B, A) => B): B = fa.foldLeft(z)(f)
    def foldRight[A, B](fa: Vector[A], z: B)(f: (A, B) => B): B = fa.foldRight(z)(f)

// ── Domain-specific BodyFoldable for our concrete hierarchy types ─────────
// Component, ComponentVector, Entity, System are case classes (not F[_]).
// This typeclass captures "things that contain bodies and can fold over them".
trait BodyFoldable[A]:
  // Fold over the bodies contained in `a`, aggregating via Monoid
  extension [B](a: A)
    def foldMapBodies(f: Body => B)(using M: Monoid[B]): B
  // Count bodies
  extension (a: A)
    def bodyCount: Int = a.foldMapBodies(_ => 1)(using summon[Monoid[Int]])

object BodyFoldable:
  def apply[A](using BF: BodyFoldable[A]): BodyFoldable[A] = BF
