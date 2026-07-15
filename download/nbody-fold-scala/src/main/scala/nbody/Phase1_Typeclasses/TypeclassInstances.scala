// ============================================================================
// TypeclassInstances.scala — given instances tying typeclasses to domain types
// ============================================================================
// Phase 1 deliverable per skills.md §2 Phase 1.
//
// This file is the bridge between Phase 0 (domain model) and Phase 1
// (typeclass abstractions). It defines:
//
//   1. given Monoid[Vec3]      — vector addition is the monoid operation
//   2. given Monoid[Body]      — merge accelerations (Phase 5 force accumulation)
//   3. given Monoid[Mass]      — mass addition
//   4. given BodyFoldable[Component], BodyFoldable[ComponentVector],
//         BodyFoldable[Entity], BodyFoldable[System]
//      — the bottom-up hierarchy: each tier folds over the bodies inside it
//
// Together these let us write the Phase 5 fold:
//   system.foldMapBodies(_.forces)  // aggregates all gravitational contributions
// ============================================================================

package nbody.Phase1_Typeclasses

import nbody.Phase0_Domain.*

// ── Vec3 is a Monoid under vector addition ─────────────────────────────────
given Monoid[Vec3] with
  def empty: Vec3 = Vec3.Zero
  def combine(a: Vec3, b: Vec3): Vec3 = a + b

// ── Body Monoid: merge accelerations (Phase 5 force accumulation) ──────────
// Two Bodies with the same id combine by summing their `acc` vectors.
// This is the algebraic heart of the bottom-up force fold: each Component
// contributes a partial acceleration, and we Monoid-combine them.
given Monoid[Body] with
  def empty: Body = Body.Zero
  def combine(a: Body, b: Body): Body =
    if a == Body.Zero then b
    else if b == Body.Zero then a
    else a.withAcc(a.acc + b.acc)  // assumes same id; Phase 5 enforces this

// ── Mass Monoid under addition ─────────────────────────────────────────────
given Monoid[Mass] with
  def empty: Mass = Mass.Zero
  def combine(a: Mass, b: Mass): Mass = a + b

// ── BodyFoldable instances for the bottom-up hierarchy ─────────────────────
// Component → ComponentVector → Entity → System.
// Each tier delegates its foldMapBodies down to the tier it contains.
// This is the engine of the Phase 5 bottom-up force fold.

given BodyFoldable[Component] with
  extension [B](c: Component)
    def foldMapBodies(f: Body => B)(using M: Monoid[B]): B =
      c.bodies.foldLeft(M.empty)((acc, b) => M.combine(acc, f(b)))

given BodyFoldable[ComponentVector] with
  extension [B](cv: ComponentVector)
    def foldMapBodies(f: Body => B)(using M: Monoid[B]): B =
      val BF = summon[BodyFoldable[Component]]
      cv.components.foldLeft(M.empty) { (acc, c) =>
        M.combine(acc, BF.foldMapBodies(c)(f))
      }

given BodyFoldable[Entity] with
  extension [B](e: Entity)
    def foldMapBodies(f: Body => B)(using M: Monoid[B]): B =
      val BF = summon[BodyFoldable[ComponentVector]]
      e.componentVectors.foldLeft(M.empty) { (acc, cv) =>
        M.combine(acc, BF.foldMapBodies(cv)(f))
      }

given BodyFoldable[System] with
  extension [B](s: System)
    def foldMapBodies(f: Body => B)(using M: Monoid[B]): B =
      val BF = summon[BodyFoldable[Entity]]
      s.entities.foldLeft(M.empty) { (acc, e) =>
        M.combine(acc, BF.foldMapBodies(e)(f))
      }
