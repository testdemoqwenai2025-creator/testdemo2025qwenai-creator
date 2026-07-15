// ============================================================================
// System.scala — top-level simulation universe
// ============================================================================
// Phase 0 deliverable per skills.md §2 Phase 0.
//
// System is the root of the bottom-up hierarchy
// (Component → ComponentVector → Entity → System). It is the unit that the
// Simulator.step function operates on (Phase 5).
//
// The hierarchy exists so that Phase 5's force fold can aggregate
// gravitational contributions at each tier instead of computing them
// pairwise:
//
//   System
//     └─ Entity
//          └─ ComponentVector
//               └─ Component
//                    └─ Body
//
// Energy / momentum / angular momentum are computed at the System level
// and used by Phase 8's verification suite.
// ============================================================================

package nbody.Phase0_Domain

final case class System(entities: Vector[Entity]):
  require(entities.nonEmpty, "System must contain ≥1 Entity")

  // ── Bottom-up aggregation ──────────────────────────────────────────────
  def totalMass: Mass = entities.foldLeft(Mass.Zero) { (acc, e) => acc + e.totalMass }

  def centerOfMass: Vec3 =
    val total = totalMass.value
    if total == 0.0 then Vec3.Zero
    else
      val weighted = entities.foldLeft(Vec3.Zero) { (acc, e) =>
        acc + (e.centerOfMass * e.totalMass.value)
      }
      weighted / total

  def bodies: Vector[Body] = entities.flatMap(_.bodies)

  // ── Conservation-law diagnostics (used by Phase 8 tests) ───────────────
  def kineticEnergy: Double = bodies.foldLeft(0.0) { (acc, b) => acc + b.kineticEnergy }

  def potentialEnergy(softening: Double = 0.0): Double =
    // G = 1 (natural units); softening ε prevents singularities at r → 0
    val G = 1.0
    val bs = bodies
    var sum = 0.0
    var i = 0
    while i < bs.length do
      var j = i + 1
      while j < bs.length do
        val r  = math.sqrt((bs(i).pos - bs(j).pos).normSq + softening * softening)
        sum   -= G * bs(i).mass.value * bs(j).mass.value / r
        j += 1
      i += 1
    sum

  def totalEnergy(softening: Double = 0.0): Double =
    kineticEnergy + potentialEnergy(softening)

  def linearMomentum: Vec3 =
    bodies.foldLeft(Vec3.Zero) { (acc, b) => acc + b.momentum }

  def angularMomentum: Vec3 =
    bodies.foldLeft(Vec3.Zero) { (acc, b) => acc + b.angularMomentum }

  // ── Counts (for diagnostics) ───────────────────────────────────────────
  def countEntities:        Int = entities.length
  def countComponentVectors: Int = entities.map(_.componentVectors.length).sum
  def countComponents:       Int = entities.map(_.countComponents).sum
  def countBodies:           Int = bodies.length

  override def toString: String =
    s"System(entities=${countEntities}, componentVectors=${countComponentVectors}, " +
    s"components=${countComponents}, bodies=${countBodies}, " +
    f"totalMass=${totalMass.value}%.4f, E_kin=${kineticEnergy}%.6e)"

object System:
  // Smart constructor: single Entity → System
  def apply(e: Entity): System = System(Vector(e))
