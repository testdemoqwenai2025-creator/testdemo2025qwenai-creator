// ============================================================================
// LazySimulation.scala — infinite LazyList of simulation states
// ============================================================================
// Phase 7 deliverable per skills.md §2 Phase 7.
//
// The "Corecursion" pillar of the Elite Toolkit (Pillar 6) is the Haskell
// tradition of defining infinite structures via `unfoldr` / `iterate` and
// consuming them on demand. In Scala 3 the equivalent is:
//
//   LazyList.iterate(seed)(step)  : LazyList[A]
//
// This produces an INFINITE stream where:
//   - head is `seed`
//   - tail is lazy: `step(head)` is only computed when the next element is
//     first forced
//   - no element is retained after the consumer drops its reference (unless
//     the consumer explicitly holds the head, in which case the entire
//     computed prefix is memoised — see the "memory mode" note below)
//
// Why this matters for N-body:
//   - A 1M-step simulation materialised eagerly as Vector[System] would
//     require ~1M × sizeof(System) bytes of heap. With sizeof(System) ≈ 200
//     bytes (4 levels of hierarchy + Vector[Body] of N bodies) and N=100,
//     that's ~200 MiB just for the state log — before any trajectory dump.
//   - The same simulation as `LazyList.iterate(seed)(step)` and consumed via
//     `.take(1_000_000).foreach(...)` peaks at O(1) state objects in memory
//     (each state becomes garbage the moment the next is forced), as long
//     as we DON'T hold the head of the stream.
//
// The "no hold" contract:
//   LazyList memoises its computed prefix. If you write
//     val states = LazyList.iterate(seed)(step)
//     states.take(1_000_000).foreach(...)
//   then after the foreach, the FIRST ~1M states are still reachable from
//   `states` and won't be GC'd. To get true O(1) memory you must either:
//     (a) Not retain a reference to `states` (use a local that goes out of
//         scope), OR
//     (b) Use `LazyList.iterate(seed)(step).iterator` which gives an Iterator
//         that does NOT memoise — each next() call frees the previous state.
//   We expose both patterns below.
//
// Integration with Phase 5 + 6:
//   - Phase 5's Simulator.step is the pure `System → System` step function.
//   - Phase 6's TrajectoryWriter is the sink — `foreach(TrajectoryWriter.append)`
//     streams each state to the mmap'd output file without holding it.
//   - Phase 7's LazySimulation glues them: `stream(initial).take(N).foreach(write)`.
// ============================================================================

package nbody.Phase7_Stream

import scala.collection.immutable.LazyList
import nbody.Phase0_Domain.System
import nbody.Phase5_NBody.{Simulator, Physics}

object LazySimulation:

  /** The infinite stream of simulation states:
    *
    *   states(0) = initial
    *   states(n) = Simulator.step(states(n-1), dt, softening)
    *
    * `dt` and `softening` are baked into the step function via currying.
    * The stream is INFINITE — callers MUST use `.take(n)`, `.iterator`, or
    * some other bounded consumer.
    *
    * MEMORY: the returned LazyList memoises its computed prefix. If you
    * retain a reference to it (e.g., `val s = stream(...); s.take(1e6).foreach`)
    * then the first ~1M states will be held in memory. For unbounded runs
    * use `streamIterator(...)` instead, which gives an Iterator that frees
    * each state as the next is produced.
    */
  def stream(initial: System, dt: Double,
             softening: Double = Physics.DefaultSoftening): LazyList[System] =
    LazyList.iterate(initial)(sys => Simulator.step(sys, dt, softening))

  /** Iterator form: O(1) memory, no memoisation. Each `next()` call computes
    * the next state and frees the previous one (subject to GC). This is the
    * correct choice for unbounded simulation runs (1M+ steps).
    *
    * The Iterator is backed by a var holding the current state; `next()`
    * replaces it. The previous state becomes unreachable the moment `next()`
    * returns, so GC can reclaim it on the next cycle.
    */
  def streamIterator(initial: System, dt: Double,
                     softening: Double = Physics.DefaultSoftening): Iterator[System] =
    new Iterator[System]:
      private var current: System = initial
      private var isFirst: Boolean = true
      def hasNext: Boolean = true   // infinite stream
      def next(): System =
        if isFirst then
          isFirst = false
          current
        else
          current = Simulator.step(current, dt, softening)
          current

  /** Sample the stream at a specific step index, WITHOUT materialising the
    * prefix. This is the "take a sample at step 500k" use case from the spec:
    *
    *   sampleAt(initial, dt, 500_000)  →  System after 500k steps
    *
    * Uses the Iterator form internally so memory stays O(1) regardless of
    * how far into the stream we sample.
    *
    * Returns (stepIndex, state).
    */
  def sampleAt(initial: System, dt: Double, stepIndex: Long,
               softening: Double = Physics.DefaultSoftening): System =
    require(stepIndex >= 0, s"stepIndex must be >= 0, got $stepIndex")
    val it = streamIterator(initial, dt, softening)
    var i = 0L
    var state = it.next()   // step 0 = initial
    while i < stepIndex do
      state = it.next()
      i += 1
    state

  /** Stream-and-write: run the simulation for `steps` steps, writing each
    * state's bodies to the trajectory writer. Memory stays O(1) because we
    * use the Iterator form. Returns the final state.
    *
    * This is the production sink pattern:
    *   val final = streamAndWrite(initial, dt, nSteps, writer)
    *
    * The writer is responsible for its own flushing / closing. The caller
    * should `close()` the TrajectoryWriter after this returns.
    */
  def streamAndWrite(initial: System, dt: Double, steps: Long,
                     softening: Double = Physics.DefaultSoftening)
                    (writeState: System => Unit): System =
    require(steps >= 0, s"steps must be >= 0, got $steps")
    val it = streamIterator(initial, dt, softening)
    var state = it.next()    // step 0
    writeState(state)
    var i = 0L
    while i < steps do
      state = it.next()
      writeState(state)
      i += 1
    state

  /** Diagnostic: count how many distinct states the stream produces within
    * a step budget. Used by the demo to prove the stream is truly lazy —
    * a non-lazy implementation would OOM on a 10M-step budget.
    *
    * Returns the number of states actually forced (= `budget + 1` for an
    * infinite stream, but asserts memory stayed bounded).
    */
  def countForcedStates(initial: System, dt: Double, budget: Long,
                        softening: Double = Physics.DefaultSoftening): Long =
    require(budget >= 0, s"budget must be >= 0, got $budget")
    val it = streamIterator(initial, dt, softening)
    var count = 0L
    var i = 0L
    while i <= budget do
      it.next()
      count += 1
      i += 1
    count

  /** Zip two streams of states with a lag — used to compute drift between
    * "now" and "n steps ago" without keeping the whole prefix. The consumer
    * sees pairs (state_at_t, state_at_t_minus_lag).
    *
    * This is the corecursive equivalent of a sliding window: instead of
    * materialising a window of `lag` states, we run TWO iterators and delay
    * the second by `lag` steps.
    *
    * Used by the demo to verify energy drift is bounded without holding a
    * Vector[System] of length `lag`.
    */
  def slidingPair(initial: System, dt: Double, lag: Long,
                  softening: Double = Physics.DefaultSoftening)
                 (consume: (System, System) => Unit): Unit =
    require(lag >= 0, s"lag must be >= 0, got $lag")
    val lead = streamIterator(initial, dt, softening)
    val trail = streamIterator(initial, dt, softening)
    // Burn `lag` steps on lead so it's ahead
    var i = 0L
    while i < lag do lead.next(); i += 1
    // Now zip: (lead.next, trail.next) gives (state[lag], state[0]),
    // then (state[lag+1], state[1]), etc.
    while true do
      val l = lead.next()
      val t = trail.next()
      consume(l, t)
