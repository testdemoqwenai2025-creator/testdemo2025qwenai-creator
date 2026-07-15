// ============================================================================
// Phase1Demo.scala — Demonstrates Pillar 3 typeclasses on the domain model
// ============================================================================
// Shows:
//   1. Monoid[Vec3]   — vector addition as monoid
//   2. Monoid[Double] — energy aggregation
//   3. Foldable[System] — bottom-up fold over the hierarchy
//   4. sequenceA — the "Epic Move", here on Option (a simpler context than Parser)
//
// Run with:  sbt "runMain nbody.Phase1Demo"
// ============================================================================

package nbody

import nbody.Phase0_Domain.*
import nbody.Phase1_Typeclasses.*
import nbody.Phase1_Typeclasses.{*, given}

object Phase1Demo:

  def main(args: Array[String]): Unit =

    println("=== Phase 1: Typeclass Foundations Demo ===")
    println()

    // ── 1. Monoid[Vec3] — combine a list of vectors ─────────────────────
    println("--- 1. Monoid[Vec3] (vector addition as monoid) ---")
    val vecs = List(Vec3(1, 2, 3), Vec3(4, 5, 6), Vec3(-1, -1, -1))
    val sum  = vecs.foldLeft(summon[Monoid[Vec3]].empty)(summon[Monoid[Vec3]].combine)
    println(s"  vecs = $vecs")
    println(s"  sum  = $sum   (expected Vec3(4, 6, 8))")
    println()

    // ── 2. Monoid[Double] — aggregate kinetic energies ──────────────────
    println("--- 2. Monoid[Double] (energy aggregation) ---")
    val energies = List(50.0, 100.0, 150.0)
    val total    = energies.foldLeft(summon[Monoid[Double]].empty)(summon[Monoid[Double]].combine)
    println(s"  energies = $energies")
    println(s"  total    = $total   (expected 300.0)")
    println()

    // ── 3. BodyFoldable[System] — bottom-up fold over the hierarchy ──────
    println("--- 3. BodyFoldable[System] (bottom-up mass aggregation) ---")
    val b1 = Body(1L, Mass(10.0), Vec3(0, 0, 0))
    val b2 = Body(2L, Mass(20.0), Vec3(1, 0, 0))
    val b3 = Body(3L, Mass(30.0), Vec3(0, 1, 0))
    val sys = System(Vector(
      Entity(1L, Vector(ComponentVector(Vector(Component.Single(b1))))),
      Entity(2L, Vector(
        ComponentVector(Vector(Component.Single(b2), Component.Single(b3)))
      ))
    ))
    // foldMapBodies over System aggregates mass across all tiers
    val totalMass: Double = sys.foldMapBodies(_.mass.value)
    val bodyCount: Int    = sys.bodyCount
    println(s"  sys.bodies = ${sys.bodies.map(_.id)}")
    println(s"  sys.countBodies = ${sys.countBodies}")
    println(s"  foldMapBodies(_.mass.value) = $totalMass   (expected 60.0)")
    println(s"  bodyCount = $bodyCount   (expected 3)")
    println()

    // ── 4. The "Epic Move" — sequenceA on Option ────────────────────────
    // List[Option[A]] → Option[List[A]]
    // If any element is None, the whole thing becomes None.
    println("--- 4. sequenceA — the \"Epic Move\" on Option ---")
    val someList: List[Option[Int]] = List(Some(1), Some(2), Some(3))
    val noneList: List[Option[Int]] = List(Some(1), None, Some(3))
    // We need an Applicative[Option] for this — let's define one inline
    given Applicative[Option] with
      def pure[A](a: A): Option[A] = Some(a)
      extension [A](oa: Option[A])
        def ap[B](of: Option[A => B]): Option[B] =
          of.flatMap(f => oa.map(f))
    val seq1 = Applicative.sequenceA(someList)
    val seq2 = Applicative.sequenceA(noneList)
    println(s"  sequenceA([Some(1), Some(2), Some(3)]) = $seq1   (expected Some(List(1, 2, 3)))")
    println(s"  sequenceA([Some(1), None,    Some(3)]) = $seq2   (expected None)")
    println()

    println("Phase 1 typeclasses verified. Ready for Phase 2 (Parser combinator).")
