// ============================================================================
// Mass.scala — newtype-style wrapper for mass values
// ============================================================================
// Phase 0 deliverable per skills.md §2 Phase 0.
// Avoids "primitive obsession": mass is conceptually distinct from a
// dimensionless Double. Using `opaque type` gives us:
//   - zero runtime overhead (erased to Double)
//   - compile-time protection against passing arbitrary Doubles
//   - an extension method `.value` for the rare occasions we need the raw
// ============================================================================

package nbody.Phase0_Domain

opaque type Mass = Double

object Mass:
  inline def apply(d: Double): Mass = d
  val Zero: Mass = Mass(0.0)

  extension (m: Mass)
    inline def value: Double = m
    def +(that: Mass): Mass = Mass(m + that.value)
    def -(that: Mass): Mass = Mass(m - that.value)
    def *(s: Double):  Mass = Mass(m * s)
    def /(s: Double):  Mass = Mass(m / s)
    def >(that: Mass): Boolean = m > that.value
    def <(that: Mass): Boolean = m < that.value

  // Sentinel for "no body" / placeholder mass — used by Zero Initialization Rule.
  // A mass of exactly 0.0 produces zero gravitational force, so it's a safe default.
  val SafeZero: Mass = Zero
