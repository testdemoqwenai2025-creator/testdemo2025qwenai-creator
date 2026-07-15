// ============================================================================
// Component.scala — smallest unit in the bottom-up fold hierarchy
// ============================================================================
// Phase 0 deliverable per skills.md §2 Phase 0.
//
// Per the workflow, a Component is "the smallest unit (a single body OR
// a small fixed-size cluster)". We model this as a sealed trait so that
// pattern matching is exhaustive and the compiler will warn on missed
// cases — critical for the bottom-up fold in Phase 5.
//
// The Cluster variant exists to support the RLE optimization (Phase 3):
// identical-mass bodies in close proximity can be aggregated into a
// Cluster and treated as a single gravitational source for distant
// observers, enabling the "Mathematical Jumping" of Phase 4.
// ============================================================================

package nbody.Phase0_Domain

sealed trait Component:
  // Total mass — used by Phase 5's bottom-up force fold
  def totalMass: Mass
  // Center of mass — used by Phase 5's bottom-up force fold
  def centerOfMass: Vec3
  // Flat list of bodies — used for direct integration
  def bodies: Vector[Body]

object Component:

  final case class Single(body: Body) extends Component:
    def totalMass:   Mass = body.mass
    def centerOfMass: Vec3 = body.pos
    def bodies: Vector[Body] = Vector(body)

  final case class Cluster(bodies: Vector[Body]) extends Component:
    // Pre-validated: a Cluster must be non-empty (use Single for one body)
    require(bodies.nonEmpty, "Cluster must contain at least one body")

    def totalMass: Mass = bodies.foldLeft(Mass.Zero) { (acc, b) => acc + b.mass }

    def centerOfMass: Vec3 =
      val total = totalMass.value
      if total == 0.0 then Vec3.Zero
      else
        val weighted = bodies.foldLeft(Vec3.Zero) { (acc, b) =>
          acc + (b.pos * b.mass.value)
        }
        weighted / total

  // Smart constructor: pick Single automatically when there's only one body
  def apply(bodies: Vector[Body]): Component =
    bodies match
      case Vector() => throw new IllegalArgumentException("Component requires ≥1 body")
      case Vector(one) => Single(one)
      case many        => Cluster(many)

  // Convenience: build from a single Body
  def apply(b: Body): Component = Single(b)

  // Zero Initialization Rule: an empty Component doesn't exist (Cluster requires
  // ≥1 body), so the neutral element for Component aggregation is handled at
  // the ComponentVector level instead.
