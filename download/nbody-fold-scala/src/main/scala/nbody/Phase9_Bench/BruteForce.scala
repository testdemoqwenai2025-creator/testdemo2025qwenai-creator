// ============================================================================
// BruteForce.scala — O(N²) baseline pairwise gravity
// ============================================================================
// Phase 9 deliverable per skills.md §2 Phase 9.
//
// The "Brute Force" baseline computes all N(N-1)/2 pairwise forces directly.
// We reuse Phase 5's MutableKDK (which already implements Newton's-third-law
// halving and flat-array arithmetic) as the production-quality reference.
//
// Algorithmic complexity: O(N²) per step
//   - Outer loop: N iterations
//   - Inner loop: N-i-1 iterations (Newton-3 halves the work)
//   - Per-pair cost: ~10 floating-point ops (3 sub, 1 sqrt, 3 mul, 3 add)
//
// This is the baseline against which Barnes-Hut, Fold+RLE, and
// Fold+DoubleRLE are compared. It is the slowest asymptotically but the
// most accurate (no far-field approximation).
//
// The "Newton-3 halving" optimization is standard in all production N-body
// codes (GADGET, AREPO, REBOUND). It does NOT change the O(N²) complexity —
// it just halves the constant. We retain it here because removing it would
// make the baseline artificially slow and misrepresent the practical
// performance of "brute force" in real codes.
// ============================================================================

package nbody.Phase9_Bench

import nbody.Phase0_Domain.*
import nbody.Phase5_NBody.{Physics, MutableKDK}

object BruteForce:

  val algorithmName: String = "BruteForce-O(N^2)"

  /** Single KDK step using brute-force pairwise gravity.
    *
    * Delegates to MutableKDK.step — the same code path used by Phase 5's
    * verification suite (energy drift < 1e-6 over 1000 steps).
    *
    * Time:  O(N²)  (Newton-3 halved)
    * Space: O(N)   (flat double arrays)
    */
  def step(bodies: Vector[Body], dt: Double,
           softening: Double = Physics.DefaultSoftening): Vector[Body] =
    MutableKDK.step(bodies, dt, softening)

  /** Diagnostics: count of pairwise force evaluations per step.
    * For BruteForce this is N(N-1)/2 (Newton-3 halved). */
  def pairwiseEvaluations(n: Int): Long =
    n.toLong * (n - 1).toLong / 2L

  /** Asymptotic complexity class for the comparison table. */
  def complexityClass: String = "O(N^2)"
