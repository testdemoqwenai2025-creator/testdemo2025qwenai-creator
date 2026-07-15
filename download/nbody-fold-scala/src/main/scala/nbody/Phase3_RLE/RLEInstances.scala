// ============================================================================
// RLEInstances.scala — Eq instances tying RLE to the domain model
// ============================================================================
// Phase 3 deliverable per skills.md §2 Phase 3.
//
// The critical instance here is `given Eq[Body]` — bodies are "equal" for
// RLE purposes iff they have the SAME ID. This is NOT structural equality:
//
//   Body(id=1, mass=1, pos=(0,0,0))  vs  Body(id=1, mass=1, pos=(5,0,0))
//
// are EQUAL under Eq[Body] (same physical entity, just at different times)
// but UNEQUAL under Scala's `==` (different positions).
//
// Why this matters for RLE:
//   In a Phase 5 simulation, we'll often have a long sequence of the same
//   body's acceleration contributions at successive timesteps. The body
//   ID stays constant; the position/velocity change. RLE should collapse
//   all of these into a single Run — and Eq[Body] makes that possible.
//
// For the simpler case of RLE on a Vector[Int] or Vector[Vec3] (e.g. a
// spatial grid), the primitive Eq instances defined in Eq.scala already
// give us value equality.
// ============================================================================

package nbody.Phase3_RLE

import nbody.Phase0_Domain.*

// Two bodies are "equal" under RLE if they have the same ID.
// Position, velocity, acceleration, and even mass are deliberately
// ignored — they're state, not identity.
given Eq[Body] with
  def eqv(a: Body, b: Body): Boolean = a.id == b.id

// Mass equality — value equality on the underlying Double.
// Needed if we ever RLE a Vector[Mass] (e.g. a sorted mass spectrum).
given Eq[Mass] with
  def eqv(a: Mass, b: Mass): Boolean = a.value == b.value

// ── Higher-kinded Eq instances ──────────────────────────────────────────
// Eq[Option[A]] — two Options are equal iff both None or both Some with
// equal contents. Useful for RLE over sparse fields.
given [A](using E: Eq[A]): Eq[Option[A]] with
  def eqv(a: Option[A], b: Option[A]): Boolean = (a, b) match
    case (None,    None)       => true
    case (Some(x), Some(y))    => E.eqv(x, y)
    case _                    => false

// Eq[(A, B)] — pair equality, component-wise.
// Useful for RLE over tagged values (e.g. (clusterId, body)).
given [A, B](using EA: Eq[A], EB: Eq[B]): Eq[(A, B)] with
  def eqv(a: (A, B), b: (A, B)): Boolean =
    EA.eqv(a._1, b._1) && EB.eqv(a._2, b._2)
