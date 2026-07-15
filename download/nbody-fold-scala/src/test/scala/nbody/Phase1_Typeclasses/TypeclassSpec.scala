// ============================================================================
// TypeclassSpec.scala — Phase 1 typeclass tests (zero-dependency)
// ============================================================================

package nbody.Phase1_Typeclasses

import nbody.Phase0_Domain.*
// Given instances (Monoid[Vec3], Monoid[Body], Monoid[Mass], BodyFoldable[…])
// are at package level in this same package — already in scope, no import needed.

object TypeclassSpec:

  def check(name: String)(cond: Boolean): Unit =
    if cond then println(s"  [PASS] $name")
    else
      println(s"  [FAIL] $name")
      sys.error(s"Test failed: $name")

  def runAll(): Unit =
    println("=== Phase 1 Typeclass Tests ===")

    // Test 1: Monoid[Vec3]
    val v1 = Vec3(1.0, 2.0, 3.0)
    val v2 = Vec3(4.0, 5.0, 6.0)
    val M = summon[Monoid[Vec3]]
    check("Monoid[Vec3].empty = Vec3.Zero")(M.empty == Vec3.Zero)
    check("Monoid[Vec3].combine = vector addition")(M.combine(v1, v2) == Vec3(5.0, 7.0, 9.0))
    check("Monoid[Vec3].combine(v, empty) = v")(M.combine(v1, M.empty) == v1)
    check("Monoid[Vec3].combine(empty, v) = v")(M.combine(M.empty, v2) == v2)

    // Test 2: Monoid[Double]
    val MD = summon[Monoid[Double]]
    check("Monoid[Double].empty = 0.0")(MD.empty == 0.0)
    check("Monoid[Double].combine = addition")(MD.combine(3.0, 4.0) == 7.0)

    // Test 3: Monoid[Option[Long]] — the "Min" Monoid for indexing
    val MO = summon[Monoid[Option[Long]]]
    check("Min: None + None = None")(MO.combine(None, None) == None)
    check("Min: None + Some(5) = Some(5)")(MO.combine(None, Some(5L)) == Some(5L))
    check("Min: Some(3) + Some(7) = Some(3)")(MO.combine(Some(3L), Some(7L)) == Some(3L))
    check("Min: Some(9) + Some(2) = Some(2)")(MO.combine(Some(9L), Some(2L)) == Some(2L))

    // Test 4: BodyFoldable[Component] — fold over bodies in a Component
    val c = Component.Cluster(Vector(
      Body(1L, Mass(1.0), Vec3(0, 0, 0)),
      Body(2L, Mass(2.0), Vec3(1, 0, 0)),
      Body(3L, Mass(3.0), Vec3(0, 1, 0))
    ))
    val BFC = summon[BodyFoldable[Component]]
    check("BodyFoldable[Component].foldMapBodies(_.mass.value) = 6.0")(
      math.abs(BFC.foldMapBodies(c)(_.mass.value) - 6.0) < 1e-12
    )
    check("BodyFoldable[Component].bodyCount = 3")(BFC.bodyCount(c) == 3)

    // Test 5: BodyFoldable[System] — bottom-up aggregation across all tiers
    val sys = System(Vector(
      Entity(1L, Vector(ComponentVector(Vector(Component.Single(
        Body(1L, Mass(10.0), Vec3(0, 0, 0))
      ))))),
      Entity(2L, Vector(ComponentVector(Vector(
        Component.Single(Body(2L, Mass(20.0), Vec3(1, 0, 0))),
        Component.Single(Body(3L, Mass(30.0), Vec3(0, 1, 0)))
      ))))
    ))
    val BFS = summon[BodyFoldable[System]]
    check("BodyFoldable[System].foldMapBodies(_.mass.value) = 60.0")(
      math.abs(BFS.foldMapBodies(sys)(_.mass.value) - 60.0) < 1e-12
    )
    check("BodyFoldable[System].bodyCount = 3")(BFS.bodyCount(sys) == 3)

    // Test 6: Foldable[List] — the general typeclass for type constructors
    val FL = summon[Foldable[List]]
    check("Foldable[List].foldMap(List(1,2,3))(_ + 1) = 9")(
      FL.foldMap(List(1, 2, 3))(_ + 1) == 9
    )
    check("Foldable[List].size(List(1,2,3,4)) = 4")(
      FL.size(List(1, 2, 3, 4)) == 4
    )

    // Test 7: sequenceA — the "Epic Move" — on Option
    given Applicative[Option] with
      def pure[A](a: A): Option[A] = Some(a)
      extension [A](oa: Option[A])
        def ap[B](of: Option[A => B]): Option[B] = of.flatMap(f => oa.map(f))
    val someList: List[Option[Int]] = List(Some(1), Some(2))
    val noneList: List[Option[Int]] = List(Some(1), None, Some(3))
    check("sequenceA([Some(1), Some(2)]) = Some(List(1, 2))")(
      Applicative.sequenceA(someList) == Some(List(1, 2))
    )
    check("sequenceA([Some(1), None]) = None")(
      Applicative.sequenceA(noneList) == None
    )
    check("sequenceA([]) = Some(Nil)")(
      Applicative.sequenceA(List.empty[Option[Int]]) == Some(Nil)
    )

    println("All Phase 1 tests passed.")

object TypeclassSpecRunner:
  def main(args: Array[String]): Unit = TypeclassSpec.runAll()
