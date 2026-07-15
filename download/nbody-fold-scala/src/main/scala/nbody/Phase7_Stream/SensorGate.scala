// ============================================================================
// SensorGate.scala — external perturbations consumed in lockstep with sim
// ============================================================================
// Phase 7 deliverable per skills.md §2 Phase 7.
//
// The "Wait for Input" pillar (Pillar 6) is about a simulation that does NOT
// run in batch — instead, it advances one step at a time, pausing for an
// external signal (a sensor reading, a probe fly-by, a user event) before
// computing the next state. The external signal can perturb the simulation:
// add a body, remove a body, apply an impulse, etc.
//
// In Haskell this is naturally expressed as a stream of (state, event)
// pairs zipped together. In Scala 3 we use the same pattern:
//
//   val events: LazyList[Perturbation] = ...
//   val states: LazyList[System] = LazySimulation.stream(initial, dt)
//   val gated  : LazyList[System] = states.zip(events).map { (s, e) => e.apply(s) }
//
// The key insight: `zip` with a LazyList PAUSES the simulation until the
// next event is available. If the event stream is itself lazy (e.g., reading
// from a BlockingQueue), the simulation naturally waits for input.
//
// Perturbation algebra:
//   A Perturbation is a pure function System → System. We model it as a
// sealed trait with concrete cases:
//     - AddBody(body)        — inject a new body (e.g., a probe fly-by)
//     - RemoveBody(id)       — delete a body by id (e.g., a body left the domain)
//     - Impulse(id, deltaV)  — apply an instantaneous velocity change
//     - NoOp                 — no perturbation this step (event stream padding)
//   Each case has an `apply(system): System` method that returns a new System.
//
// Event stream sources:
//   - From a Vector (deterministic test case) — `SensorGate.fromSeq`
//   - From a LazyList (infinite, lazy) — `SensorGate.fromLazyList`
//   - From a function (state-driven) — `SensorGate.fromFunction`
//   - From a Java BlockingQueue (live sensor ingest) — `SensorGate.fromQueue`
//   The demo uses fromSeq for reproducibility; fromQueue is documented for
//   production use.
//
// Memory: O(1) when both streams are lazy and consumed via .iterator. The
// zip produces pairs on demand; neither side is memoised if you use the
// Iterator forms.
// ============================================================================

package nbody.Phase7_Stream

import java.util.concurrent.{BlockingQueue, LinkedBlockingQueue, TimeUnit}
import scala.collection.immutable.LazyList
import nbody.Phase0_Domain.*
import nbody.Phase5_NBody.{Simulator, Physics}

// ── Perturbation algebra ──────────────────────────────────────────────────
// A Perturbation is a pure System → System function. Sealed trait + case
// objects give us exhaustive pattern matching (the compiler warns if we add
// a new case and forget to handle it).
sealed trait Perturbation:
  /** Apply this perturbation to a System, returning a new System. */
  def apply(system: System): System
  /** Human-readable label for the demo. */
  def label: String

object Perturbation:

  /** No-op: leave the system unchanged. Used to pad an event stream so its
    * length matches the simulation step count. */
  case object NoOp extends Perturbation:
    def apply(system: System): System = system
    def label: String = "NoOp"

  /** Add a new body to the system. The body's id should be unique across
    * the simulation; the demo uses a monotonic counter to ensure this. */
  final case class AddBody(body: Body) extends Perturbation:
    def apply(system: System): System =
      val newComponents = system.bodies.map(b => Component.Single(b)) :+ Component.Single(body)
      val cv = ComponentVector(newComponents)
      val entity = Entity(1L, Vector(cv))
      System(Vector(entity))
    def label: String = f"AddBody(id=${body.id}, m=${body.mass.value}%.2f)"

  /** Remove a body by id. If no body with that id exists, this is a no-op
    * (defensive — a sensor might report a body that already left). */
  final case class RemoveBody(id: Long) extends Perturbation:
    def apply(system: System): System =
      val kept = system.bodies.filter(_.id != id)
      if kept.size == system.bodies.size then system  // id not found, no-op
      else
        val components = kept.map(b => Component.Single(b))
        val cv = ComponentVector(components)
        val entity = Entity(1L, Vector(cv))
        System(Vector(entity))
    def label: String = s"RemoveBody(id=$id)"

  /** Apply an instantaneous velocity impulse to a body (Δv in m/s).
    * Models a thruster burn or a collision. If the body isn't found, no-op. */
  final case class Impulse(id: Long, deltaV: Vec3) extends Perturbation:
    def apply(system: System): System =
      val newBodies = system.bodies.map { b =>
        if b.id == id then b.withVel(b.vel + deltaV) else b
      }
      if newBodies.exists(_.id == id) then
        val components = newBodies.map(b => Component.Single(b))
        val cv = ComponentVector(components)
        val entity = Entity(1L, Vector(cv))
        System(Vector(entity))
      else system  // id not found, no-op
    def label: String = f"Impulse(id=$id, Δv=$deltaV)"

object SensorGate:

  /** Create an event stream from a finite sequence of perturbations.
    * After the sequence is exhausted, the stream emits NoOp forever — this
    * lets the simulation continue running past the end of the scheduled
    * events without breaking the zip.
    */
  def fromSeq(events: Seq[Perturbation]): LazyList[Perturbation] =
    LazyList.from(events) ++ LazyList.continually(Perturbation.NoOp)

  /** Create an event stream from a LazyList (already infinite, presumably). */
  def fromLazyList(events: LazyList[Perturbation]): LazyList[Perturbation] = events

  /** Create an event stream from a step-indexed function. The function
    * receives the current step index (0-based) and returns the perturbation
    * to apply at that step. Useful for deterministic test schedules.
    *
    * Example: every 100th step, apply a tiny impulse to body 1.
    *   fromFunction(i => if i % 100 == 0 && i > 0 then Impulse(1L, Vec3(0.01, 0, 0)) else NoOp)
    */
  def fromFunction(f: Long => Perturbation): LazyList[Perturbation] =
    LazyList.iterate(0L)(_ + 1L).map(f)

  /** Create an event stream from a Java BlockingQueue[Perturbation].
    *
    * This is the production "live sensor ingest" path: a separate thread
    * (the sensor reader) puts Perturbations onto the queue; the simulation
    * thread polls the queue for each step. If no event is available within
    * `pollTimeoutMs`, the simulation step uses NoOp and continues — this is
    * the "wait for input" semantics: the simulation pauses for the sensor,
    * but doesn't block forever if the sensor is silent.
    *
    * The returned LazyList is INFINITE: it polls the queue once per step
    * until the queue is closed (signalled by a special EndOfStream token).
    *
    * For the demo we use a bounded Vector via fromSeq; this fromQueue is
    * documented for completeness and tested lightly via a single-threaded
    * queue-then-drain test.
    */
  def fromQueue(queue: BlockingQueue[Perturbation],
                pollTimeoutMs: Long = 100L): LazyList[Perturbation] =
    // Sentinel: the producer puts this on the queue to signal end-of-stream.
    // We don't export it; the producer uses `SensorGate.endOfStream` to get it.
    LazyList.continually {
      Option(queue.poll(pollTimeoutMs, TimeUnit.MILLISECONDS)) match
        case Some(p) if p == SensorGate.EndOfStream => SensorGate.EndOfStream
        case Some(p) => p
        case None => Perturbation.NoOp  // timeout → no perturbation this step
    }.takeWhile(_ != SensorGate.EndOfStream) ++ LazyList.continually(Perturbation.NoOp)

  /** Sentinel for ending a queue-based event stream. */
  val EndOfStream: Perturbation = new Perturbation:
    def apply(system: System): System = system
    def label: String = "EndOfStream"
    // Override equals so == comparison works (anonymous class instances
    // are reference-equal by default, which is what we want here — there's
    // only one EndOfStream)
    override def equals(other: Any): Boolean = other match
      case that: AnyRef => this eq that
      case _ => false
    override def hashCode: Int = java.lang.System.identityHashCode(this)

  /** Run a simulation gated by an event stream. At each step:
    *   1. Advance the simulation by one step (Simulator.step on the
    *      PERTURBED state from the previous step — NOT on a fresh state)
    *   2. Pull the next event from the event stream
    *   3. Apply the event to the new state
    *
    * CRITICAL: the simulation state evolves through perturbations. Unlike a
    * plain `LazySimulation.streamIterator` (which always steps from the
    * UNPERTURBED previous state), the gated stream MUST feed the perturbed
    * state back into the next step. Otherwise perturbations are visible in
    * the returned state but immediately lost — the next step continues as
    * if the perturbation never happened.
    *
    * Returns an Iterator that yields one (stepIndex, state, event) triple
    * per step. The iterator is INFINITE — caller must bound it.
    *
    * Memory: O(1) — only the current state and event are held.
    */
  def gatedStream(initial: System, dt: Double,
                  events: LazyList[Perturbation],
                  softening: Double = Physics.DefaultSoftening)
                 : Iterator[(Long, System, Perturbation)] =
    val eventIt = events.iterator
    new Iterator[(Long, System, Perturbation)]:
      private var current: System = initial
      private var step: Long = 0L
      private var isFirst: Boolean = true
      def hasNext: Boolean = true   // both streams are infinite
      def next(): (Long, System, Perturbation) =
        if !isFirst then
          // Step from the (possibly perturbed) current state
          current = Simulator.step(current, dt, softening)
        isFirst = false
        val event = eventIt.next()
        val perturbed = event(current)
        current = perturbed   // FEED BACK: next step starts from perturbed state
        val result = (step, perturbed, event)
        step += 1
        result

  /** Run a gated simulation for `steps` steps, applying perturbations from
    * the event stream. Returns the final state and a log of which steps had
    * non-trivial perturbations (for the demo's verification).
    *
    * Memory: O(steps) for the perturbation log — bounded by the caller.
    * For unbounded runs, use `gatedStream(...).iterator` directly.
    */
  final case class GatedRun(
    finalState: System,
    perturbationsApplied: Vector[(Long, String)],  // (step, label)
    stepsRun: Long
  )

  def runGated(initial: System, dt: Double, steps: Long,
               events: LazyList[Perturbation],
               softening: Double = Physics.DefaultSoftening): GatedRun =
    require(steps >= 0, s"steps must be >= 0, got $steps")
    val it = gatedStream(initial, dt, events, softening)
    var state = initial
    val log = scala.collection.mutable.ArrayBuffer.empty[(Long, String)]
    var i = 0L
    while i <= steps do
      val (step, s, event) = it.next()
      state = s
      if event != Perturbation.NoOp then
        log += ((step, event.label))
      i += 1
    GatedRun(state, log.toVector, steps)

  /** Count non-trivial perturbations in an event stream segment
    * without materialising the states. Useful for verifying a schedule.
    */
  def countNonTrivial(events: LazyList[Perturbation], window: Int): Long =
    events.take(window).count(_ != Perturbation.NoOp)
