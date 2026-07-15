// ============================================================================
// Vec3.scala — 3D vector, pure value type
// ============================================================================
// Phase 0 deliverable per skills.md §2 Phase 0.
// Zero-dependency: only Scala 3 stdlib.
//
// Design notes:
//   - final case class — gives us structural equality, useful for tests
//   - Methods use symbolic operators (+, -, *) for physics readability
//   - All operations are total; no partial NaN-producing paths
//   - Vec3 forms a Monoid under addition (Phase 1 will provide the instance)
// ============================================================================

package nbody.Phase0_Domain

import scala.math.sqrt

final case class Vec3(x: Double, y: Double, z: Double):

  def +(that: Vec3): Vec3 = Vec3(this.x + that.x, this.y + that.y, this.z + that.z)
  def -(that: Vec3): Vec3 = Vec3(this.x - that.x, this.y - that.y, this.z - that.z)
  def *(s: Double):  Vec3 = Vec3(this.x * s, this.y * s, this.z * s)
  def /(s: Double):  Vec3 = Vec3(this.x / s, this.y / s, this.z / s)

  def unary_- : Vec3 = Vec3(-x, -y, -z)

  def dot(that: Vec3): Double = this.x * that.x + this.y * that.y + this.z * that.z

  def cross(that: Vec3): Vec3 = Vec3(
    this.y * that.z - this.z * that.y,
    this.z * that.x - this.x * that.z,
    this.x * that.y - this.y * that.x
  )

  def normSq: Double = x * x + y * y + z * z
  def norm:   Double = sqrt(normSq)

  def normalize: Vec3 =
    val n = norm
    if n == 0.0 then Vec3.Zero else this / n

  def lerp(that: Vec3, t: Double): Vec3 = this + (that - this) * t

  override def toString: String = f"Vec3($x%.6f, $y%.6f, $z%.6f)"

object Vec3:
  val Zero: Vec3 = Vec3(0.0, 0.0, 0.0)
  val X:    Vec3 = Vec3(1.0, 0.0, 0.0)
  val Y:    Vec3 = Vec3(0.0, 1.0, 0.0)
  val Z:    Vec3 = Vec3(0.0, 0.0, 1.0)
