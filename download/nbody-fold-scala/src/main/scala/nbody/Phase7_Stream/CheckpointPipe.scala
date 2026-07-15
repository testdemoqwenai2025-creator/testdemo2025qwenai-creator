// ============================================================================
// CheckpointPipe.scala — periodic snapshot for fault recovery
// ============================================================================
// Phase 7 deliverable per skills.md §2 Phase 7.
//
// A "checkpoint pipe" is a stream transformer that, every N steps,
// materialises a snapshot of the simulation state to disk. The snapshot is
// a complete System (or just its Vector[Body]) written via Phase 6's
// TrajectoryWriter. On fault recovery, the simulation can resume from the
// most recent checkpoint rather than from step 0.
//
// Design — compositional stream transformer:
//   The CheckpointPipe wraps a base Iterator[System] and exposes the same
//   Iterator interface. Every `period` calls to `next()`, it ALSO writes
//   the state to a checkpoint file. The consumer code is unchanged — it
//   still sees a stream of states; the checkpointing is a side effect.
//
//   This is the "Pipe" pattern from streaming libraries: a transformation
//   on streams that can inject side effects (logging, checkpointing,
//   telemetry) without changing the data shape.
//
// Checkpoint file naming:
//   Each snapshot goes to `dir/checkpoint-<step>.csv` where <step> is the
//   0-based step index. The most recent checkpoint is also symlinked (or
//   copied) to `dir/checkpoint-latest.csv` for easy recovery.
//
// Recovery:
//   To resume from the latest checkpoint:
//     1. Find the highest-numbered `checkpoint-*.csv` in `dir`
//     2. Load it via InitialConditionsLoader.load
//     3. Wrap in a System and resume the LazySimulation from there
//   The demo includes a `resume` test that proves this works.
//
// Memory: O(1) — the pipe holds only the current state and the writer.
// Each checkpoint file is written incrementally via TrajectoryWriter's
// append-only mmap, so even a 1M-body snapshot doesn't spike the heap.
// ============================================================================

package nbody.Phase7_Stream

import java.nio.file.{Files, Path, Paths}
import nbody.Phase0_Domain.{Body, System}
import nbody.Phase5_NBody.Physics
import nbody.Phase6_IO.{InitialConditionsLoader, TrajectoryWriter}

final class CheckpointPipe private (
  private val underlying: Iterator[System],
  private val checkpointDir: Path,
  private val period: Long,
  private var stepIndex: Long,
  private var nextStep: Long,
  private var closed: Boolean
):
  import CheckpointPipe.*

  /** Advance to the next state. Every `period` steps, also writes the state
    * to `<dir>/checkpoint-<step>.csv`. Returns the new state.
    */
  def next(): System =
    if closed then throw new IllegalStateException("CheckpointPipe closed")
    val state = underlying.next()
    if stepIndex == nextStep then
      writeCheckpoint(state, stepIndex)
      nextStep += period
    stepIndex += 1
    state

  /** HasNext is always true for an infinite simulation stream. */
  def hasNext: Boolean = underlying.hasNext

  /** Manually force a checkpoint of the most recently returned state.
    * Useful for clean shutdown: call this before `close()` to ensure the
    * final state is recoverable.
    */
  def checkpointNow(state: System): Path =
    writeCheckpoint(state, stepIndex)

  /** Close the pipe. Does NOT close the underlying iterator (which is
    * typically infinite and has no resource to close). Idempotent.
    */
  def close(): Unit =
    if !closed then closed = true

  /** Current step index (0-based; the state returned by the most recent
    * `next()` call is at this index). Returns 0 before any `next()` call.
    */
  def currentStep: Long = stepIndex

  /** Number of checkpoints written so far. */
  def checkpointsWritten: Long =
    if stepIndex == 0 then 0L
    else (stepIndex + period - 1) / period   // ceil(stepIndex / period)

  private def writeCheckpoint(state: System, step: Long): Path =
    val filename = f"checkpoint-$step%012d.csv"
    val path = checkpointDir.resolve(filename)
    TrajectoryWriter.writeAll(path, state.bodies)
    // Also update "latest" pointer as a copy (symlinks are non-portable)
    val latest = checkpointDir.resolve("checkpoint-latest.csv")
    Files.copy(path, latest, java.nio.file.StandardCopyOption.REPLACE_EXISTING)
    path

object CheckpointPipe:

  /** Wrap an existing simulation iterator with checkpointing.
    *
    * @param underlying the base simulation stream (e.g., from
    *        LazySimulation.streamIterator)
    * @param checkpointDir directory to write checkpoint files. Created if
    *        it doesn't exist.
    * @param period write a checkpoint every `period` steps. Step 0 is
    *        always checkpointed (the initial state); subsequent checkpoints
    *        happen at steps `period`, `2*period`, etc.
    */
  def wrap(underlying: Iterator[System], checkpointDir: Path,
           period: Long): CheckpointPipe =
    require(period > 0, s"period must be > 0, got $period")
    Files.createDirectories(checkpointDir)
    new CheckpointPipe(underlying, checkpointDir, period, 0L, 0L, false)

  /** One-shot convenience: run a simulation for `steps` steps with
    * checkpointing every `period` steps. Returns the final state and the
    * list of checkpoint paths written.
    */
  final case class CheckpointedRun(
    finalState: System,
    checkpointPaths: Vector[Path],
    stepsRun: Long
  )

  def runWithCheckpoints(initial: System, dt: Double, steps: Long, period: Long,
                         checkpointDir: Path,
                         softening: Double = Physics.DefaultSoftening): CheckpointedRun =
    require(steps >= 0, s"steps must be >= 0, got $steps")
    require(period > 0, s"period must be > 0, got $period")
    Files.createDirectories(checkpointDir)
    val base = LazySimulation.streamIterator(initial, dt, softening)
    val pipe = wrap(base, checkpointDir, period)
    val paths = scala.collection.mutable.ArrayBuffer.empty[Path]
    var state = initial
    var i = 0L
    // Step 0 (initial state) — pipe.next() will checkpoint it because
    // stepIndex == nextStep == 0
    while i <= steps do
      state = pipe.next()
      i += 1
    // Collect all checkpoint files we wrote
    val files = Files.list(checkpointDir).toArray
      .map(_.asInstanceOf[Path])
      .filter { p =>
        val name = p.getFileName.toString
        name.startsWith("checkpoint-") && name != "checkpoint-latest.csv"
      }
      .toVector
      .sortBy(_.getFileName.toString)
    pipe.close()
    CheckpointedRun(state, files, steps)

  /** List all checkpoint files in a directory, sorted by step index.
    * Excludes the "checkpoint-latest.csv" pointer file.
    */
  def listCheckpoints(dir: Path): Vector[Path] =
    Files.list(dir).toArray
      .map(_.asInstanceOf[Path])
      .filter { p =>
        val name = p.getFileName.toString
        name.startsWith("checkpoint-") && name != "checkpoint-latest.csv"
      }
      .toVector
      .sortBy(_.getFileName.toString)

  /** Find the most recent checkpoint (highest step index) in a directory.
    * Returns None if no checkpoints exist.
    */
  def latestCheckpoint(dir: Path): Option[Path] =
    listCheckpoints(dir).lastOption

  /** Load a checkpoint file as a System, ready to resume simulation.
    * Wraps the loaded Vector[Body] in a flat System hierarchy.
    */
  def loadCheckpoint(path: Path): Either[String, System] =
    InitialConditionsLoader.load(path).map { bodies =>
      // Wrap in the same flat hierarchy Simulator.rebuildSystem produces
      val components = bodies.map(b => nbody.Phase0_Domain.Component.Single(b))
      val cv = nbody.Phase0_Domain.ComponentVector(components)
      val entity = nbody.Phase0_Domain.Entity(1L, Vector(cv))
      nbody.Phase0_Domain.System(Vector(entity))
    }

  /** Extract the step index from a checkpoint filename.
    * "checkpoint-000000000123.csv" → 123L
    */
  def stepFromFilename(filename: String): Long =
    val stripped = filename.stripPrefix("checkpoint-").stripSuffix(".csv")
    stripped.toLong

  /** Extract the step index from a checkpoint Path. */
  def stepFromPath(path: Path): Long = stepFromFilename(path.getFileName.toString)
