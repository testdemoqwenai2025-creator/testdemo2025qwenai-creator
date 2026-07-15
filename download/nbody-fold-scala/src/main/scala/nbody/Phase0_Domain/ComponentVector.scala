// ============================================================================
// ComponentVector.scala — spatial vector of Components
// ============================================================================
// Phase 0 deliverable per skills.md §2 Phase 0.
//
// NOTE on naming: skills.md originally suggested "Vector3D.scala — a spatial
// vector of Components (not to be confused with Vec3)". We renamed this to
// `ComponentVector` to eliminate the confusion outright — the framework's
// own principle of clarity ("Insight first" — Pillar 4 literate clarity)
// takes precedence over the literal naming suggestion.
//
// A ComponentVector is the second tier in the hierarchy
// (Component → ComponentVector → Entity → System). It groups Components
// that share a spatial neighborhood, allowing Phase 5's force fold to
// treat the whole vector as a single gravitational source for distant
// observers (Barnes-Hut style).
// ============================================================================

package nbody.Phase0_Domain

final case class ComponentVector(components: Vector[Component]):
  require(components.nonEmpty, "ComponentVector must contain ≥1 Component")

  def totalMass: Mass = components.foldLeft(Mass.Zero) { (acc, c) => acc + c.totalMass }

  def centerOfMass: Vec3 =
    val total = totalMass.value
    if total == 0.0 then Vec3.Zero
    else
      val weighted = components.foldLeft(Vec3.Zero) { (acc, c) =>
        acc + (c.centerOfMass * c.totalMass.value)
      }
      weighted / total

  def bodies: Vector[Body] = components.flatMap(_.bodies)

  // Used by Phase 5 fold to short-circuit force computation on far-away targets
  def size: Int = components.length

object ComponentVector:
  // Smart constructor: wrap a single Component automatically
  def apply(c: Component): ComponentVector = ComponentVector(Vector(c))
  def apply(b: Body):       ComponentVector = ComponentVector(Vector(Component.Single(b)))
