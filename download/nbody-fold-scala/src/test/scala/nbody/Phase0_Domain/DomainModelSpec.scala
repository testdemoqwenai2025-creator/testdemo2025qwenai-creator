// ============================================================================
// DomainModelSpec.scala — Phase 0 self-tests
// ============================================================================
// Hand-rolled test scaffolding (no ScalaTest, no MUnit — zero-dependency).
// Uses assert + a tiny custom `check` helper. Phase 8 will introduce a
// richer test harness; for now these tests just verify the bottom-up
// aggregation math is consistent for known two-body configurations.
// ============================================================================

package nbody.Phase0_Domain

object DomainModelSpec:

  def check(name: String)(cond: Boolean): Unit =
    if cond then println(s"  [PASS] $name")
    else
      println(s"  [FAIL] $name")
      sys.error(s"Test failed: $name")

  def runAll(): Unit =
    println("=== Phase 0 Domain Model Tests ===")

    // Test 1: single body system round-trips through the hierarchy
    val b1   = Body(1L, Mass(10.0), Vec3(1.0, 2.0, 3.0), Vec3.Zero)
    val sys1 = System(Entity(1L, ComponentVector(Vector(Component.Single(b1)))))
    check("single body: countBodies == 1")(sys1.countBodies == 1)
    check("single body: totalMass == 10")(math.abs(sys1.totalMass.value - 10.0) < 1e-12)
    check("single body: CoM == (1,2,3)")(sys1.centerOfMass == Vec3(1.0, 2.0, 3.0))
    check("single body: bodies match")(sys1.bodies == Vector(b1))

    // Test 2: Cluster Component aggregates correctly
    val c = Component.Cluster(Vector(
      Body(1L, Mass(2.0), Vec3(0.0, 0.0, 0.0)),
      Body(2L, Mass(2.0), Vec3(2.0, 0.0, 0.0)),
      Body(3L, Mass(4.0), Vec3(0.0, 0.0, 0.0))
    ))
    check("cluster: totalMass == 8")(math.abs(c.totalMass.value - 8.0) < 1e-12)
    check("cluster: CoM == (0.5, 0, 0)") {
      val com = c.centerOfMass
      math.abs(com.x - 0.5) < 1e-12 && com.y == 0.0 && com.z == 0.0
    }

    // Test 3: smart constructor picks Single for one body
    val smart = Component(Vector(b1))
    check("smart ctor: Vector(b1) → Single")(smart.isInstanceOf[Component.Single])

    // Test 4: Vec3 vector arithmetic
    val v1 = Vec3(1.0, 2.0, 3.0)
    val v2 = Vec3(4.0, 5.0, 6.0)
    check("Vec3 + ")(v1 + v2 == Vec3(5.0, 7.0, 9.0))
    check("Vec3 - ")(v2 - v1 == Vec3(3.0, 3.0, 3.0))
    check("Vec3 * scalar")(v1 * 2.0 == Vec3(2.0, 4.0, 6.0))
    check("Vec3 dot")(v1.dot(v2) == 32.0)
    check("Vec3 cross")(v1.cross(v2) == Vec3(-3.0, 6.0, -3.0))
    check("Vec3 norm")(math.abs(v1.norm - math.sqrt(14.0)) < 1e-12)

    // Test 5: conservation laws for symmetric configuration
    val b3 = Body(3L, Mass(1.0), Vec3(1.0, 0.0, 0.0), Vec3(0.0,  1.0, 0.0))
    val b4 = Body(4L, Mass(1.0), Vec3(-1.0, 0.0, 0.0), Vec3(0.0, -1.0, 0.0))
    val sys2 = System(Vector(
      Entity(1L, ComponentVector(Vector(Component.Single(b3)))),
      Entity(2L, ComponentVector(Vector(Component.Single(b4))))
    ))
    check("symmetric: linear momentum ≈ 0")(sys2.linearMomentum.norm < 1e-12)
    check("symmetric: angular momentum along +z") {
      val L = sys2.angularMomentum
      math.abs(L.x) < 1e-12 && math.abs(L.y) < 1e-12 && math.abs(L.z - 2.0) < 1e-12
    }

    println("All Phase 0 tests passed.")

object DomainModelSpecRunner:
  def main(args: Array[String]): Unit = DomainModelSpec.runAll()
