// ============================================================================
// Body.scala — a single physical body
// ============================================================================
// Phase 0 deliverable per skills.md §2 Phase 0.
// A Body is the smallest physical unit in the simulation. It carries
// identity (`id`), intrinsic mass, and instantaneous kinematic state
// (position, velocity, acceleration).
//
// The `acc` field is initialized to Vec3.Zero so that a freshly-allocated
// Body is always in a valid, safe state — exemplifying the Zero
// Initialization Rule (Pillar 6).
// ============================================================================

package nbody.Phase0_Domain

final case class Body(
  id:   Long,
  mass: Mass,
  pos:  Vec3,
  vel:  Vec3,
  acc:  Vec3 = Vec3.Zero
):
  def withAcc(newAcc: Vec3): Body = copy(acc = newAcc)
  def withPos(newPos: Vec3): Body = copy(pos = newPos)
  def withVel(newVel: Vec3): Body = copy(vel = newVel)

  // Kinetic energy: ½ m v²
  def kineticEnergy: Double = 0.5 * mass.value * vel.normSq

  // Linear momentum: m v
  def momentum: Vec3 = vel * mass.value

  // Angular momentum about the origin: r × p = m (r × v)
  def angularMomentum: Vec3 = pos.cross(vel) * mass.value

  override def toString: String =
    f"Body(id=$id, m=${mass.value}%.4f, pos=$pos, vel=$vel, acc=$acc)"

object Body:
  // Zero-Initialization Rule: a body with id=0, mass=0, all-zero vectors
  // is a valid, gravitationally-neutral placeholder.
  val Zero: Body = Body(0L, Mass.Zero, Vec3.Zero, Vec3.Zero, Vec3.Zero)
