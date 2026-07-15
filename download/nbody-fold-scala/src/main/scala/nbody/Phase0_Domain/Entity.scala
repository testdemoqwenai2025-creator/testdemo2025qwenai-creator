// ============================================================================
// Entity.scala — logical entity in the bottom-up hierarchy
// ============================================================================
// Phase 0 deliverable per skills.md §2 Phase 0.
//
// An Entity is the third tier: Component → ComponentVector → Entity → System.
// It represents a logically-grouped physical object such as "a star with its
// planets" or "a globular cluster". The internal ComponentVectors may be
// spatially partitioned; the Entity as a whole can still be treated as a
// single gravitational source by very distant observers.
// ============================================================================

package nbody.Phase0_Domain

final case class Entity(
  id:                Long,
  componentVectors:  Vector[ComponentVector]
):
  require(componentVectors.nonEmpty, "Entity must contain ≥1 ComponentVector")

  def totalMass: Mass = componentVectors.foldLeft(Mass.Zero) { (acc, cv) => acc + cv.totalMass }

  def centerOfMass: Vec3 =
    val total = totalMass.value
    if total == 0.0 then Vec3.Zero
    else
      val weighted = componentVectors.foldLeft(Vec3.Zero) { (acc, cv) =>
        acc + (cv.centerOfMass * cv.totalMass.value)
      }
      weighted / total

  def bodies: Vector[Body] = componentVectors.flatMap(_.bodies)

  // Bottom-up fold helpers — Phase 1 will provide the formal Foldable instance.
  def mapComponents(f: Component => Component): Entity =
    Entity(id, componentVectors.map(cv => ComponentVector(cv.components.map(f))))

  def countComponents: Int = componentVectors.map(_.size).sum
  def countBodies:     Int = bodies.length

object Entity:
  // Smart constructor: single ComponentVector → Entity
  def apply(id: Long, cv: ComponentVector): Entity = Entity(id, Vector(cv))
  // Smart constructor: single Body → trivial Entity
  def apply(id: Long, b: Body): Entity = Entity(id, Vector(ComponentVector(Vector(Component(b)))))
