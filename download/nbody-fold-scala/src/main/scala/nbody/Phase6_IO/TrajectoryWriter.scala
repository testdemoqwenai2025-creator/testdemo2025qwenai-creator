// ============================================================================
// TrajectoryWriter.scala — append-only mmap writer for trajectory output
// ============================================================================
// Phase 6 deliverable per skills.md §2 Phase 6.
//
// The mirror image of MappedFileReader: an append-only writer backed by a
// READ_WRITE mmap region. This is the elite-toolkit pattern for high-throughput
// trajectory dumps — every step's body states stream straight into the OS
// page cache, never crossing into the Java heap.
//
// DESIGN — fixed-capacity pre-allocation with truncation on close:
//   mmap regions are fixed-size (you cannot grow a mapping in place). The
//   standard production pattern (used by every mmap-based log writer from
//   Kafka's append-only logs to RocksDB's SST writers) is:
//
//     1. Pre-allocate the file to a generous capacity (e.g., 2× expected run)
//     2. mmap it READ_WRITE
//     3. Append bytes into the mapping, advancing a position cursor
//     4. On close: force() the dirty pages to disk, then truncate the file
//        to the actual bytes written
//
//   This is "append-only" in the sense that the API only allows sequential
//   writes; the underlying mmap is technically random-access, but we expose
//   only `append` to keep the contract honest.
//
// OUTPUT FORMAT — 7-column CSV matching CsvParser's input:
//   mass,x,y,z,vx,vy,vz
//
//   This is intentionally the same format as CsvParser.bodyRowP so that a
//   trajectory dump can be re-loaded as initial conditions for a restart.
//   The body `id` is NOT written — on reload, CsvParser auto-assigns IDs
//   1, 2, 3, ... in file order, which is exactly what we want for a
//   checkpoint restart. (If you need to preserve IDs across a restart, use
//   the 8-column `appendWithId` method instead — but CsvParser doesn't
//   understand that format, so you'd need a custom loader.)
//
// WHY NOT java.io.FileWriter + BufferedWriter?
//   - BufferedWriter allocates a byte[] on the Java heap, doubling the write
//     traffic (heap → buffer → OS page cache). TrajectoryWriter writes
//     directly into the page cache via the mmap region — one copy, not two.
//   - For a 1M-step simulation writing 100k bodies per step, this is the
//     difference between the writer being a memory hog and being invisible.
// ============================================================================

package nbody.Phase6_IO

import java.nio.channels.FileChannel
import java.nio.charset.StandardCharsets
import java.nio.file.{Path, StandardOpenOption}
import java.nio.MappedByteBuffer
import nbody.Phase0_Domain.Body

final class TrajectoryWriter private (
  private val path: Path,
  private val channel: FileChannel,
  private val buffer: MappedByteBuffer,
  private val capacity: Int,
  private var position: Int,
  private var closed: Boolean
):
  import TrajectoryWriter.*

  /** Append one body's state as a 7-column CSV line: mass,x,y,z,vx,vy,vz.
    * Terminated with '\n'. Returns the number of bytes written.
    *
    * @throws IllegalStateException if the writer is closed or capacity is
    *         exceeded — open a new writer with larger capacity in that case.
    */
  def append(body: Body): Int =
    ensureOpen()
    val line = formatBody(body)
    val bytes = line.getBytes(StandardCharsets.UTF_8)
    ensureCapacity(bytes.length)
    buffer.position(position)
    buffer.put(bytes)
    position += bytes.length
    bytes.length

  /** Append a raw string (e.g., a comment line starting with '#'). The caller
    * is responsible for any trailing newline. Returns bytes written.
    */
  def appendRaw(s: String): Int =
    ensureOpen()
    val bytes = s.getBytes(StandardCharsets.UTF_8)
    ensureCapacity(bytes.length)
    buffer.position(position)
    buffer.put(bytes)
    position += bytes.length
    bytes.length

  /** Append a comment line: '# ' + s + '\n'. */
  def appendComment(s: String): Int = appendRaw("# " + s + "\n")

  /** Current write position (= bytes written so far). */
  def bytesWritten: Int = position

  /** Remaining capacity before the next append would overflow. */
  def remaining: Int = capacity - position

  /** Flush dirty pages to disk (msync equivalent) and truncate the file to
    * the actual bytes written. After close, further appends throw.
    *
    * Idempotent — calling close() twice is safe.
    */
  def close(): Unit =
    if !closed then
      buffer.force()                       // msync — flush dirty pages
      channel.truncate(position.toLong)    // trim file to actual size
      channel.close()
      closed = true

  private def ensureOpen(): Unit =
    if closed then
      throw new IllegalStateException(s"TrajectoryWriter already closed: $path")

  private def ensureCapacity(needed: Int): Unit =
    if position + needed > capacity then
      throw new IllegalStateException(
        s"TrajectoryWriter capacity exceeded: need ${position + needed} bytes, " +
        s"have $capacity — $path. Open a new writer with larger capacity."
      )

object TrajectoryWriter:

  /** Open a new trajectory writer over `path`, pre-allocating `capacity` bytes.
    * If the file already exists it is overwritten (truncated to zero first,
    * then extended to `capacity` so the mapping is valid).
    *
    * @param capacity the maximum number of bytes that can be appended before
    *        close(). Pick this generously — the file is truncated to actual
    *        usage on close, so over-estimating only costs disk space transiently.
    */
  def open(path: Path, capacity: Long): TrajectoryWriter =
    if capacity <= 0L || capacity > Int.MaxValue.toLong then
      throw new IllegalArgumentException(
        s"capacity must be in (0, ${Int.MaxValue}], got $capacity"
      )
    val cap = capacity.toInt
    // CREATE + WRITE + READ + TRUNCATE_EXISTING: start from a fresh file of
    // exactly `capacity` bytes (zero-filled) so the READ_WRITE mapping is valid
    // for the full range.
    val channel = FileChannel.open(
      path,
      StandardOpenOption.CREATE,
      StandardOpenOption.WRITE,
      StandardOpenOption.READ,
      StandardOpenOption.TRUNCATE_EXISTING
    )
    try
      // Extend the file to `capacity` by writing a single zero byte at offset
      // capacity-1. This is the portable way to set file size on POSIX + NTFS.
      // (channel.truncate(capacity) only shrinks; we need to grow here.)
      if cap > 0 then
        val oneByte = java.nio.ByteBuffer.wrap(Array(0.toByte))
        channel.write(oneByte, cap - 1L)
        channel.force(true)
      val buffer = channel.map(FileChannel.MapMode.READ_WRITE, 0L, cap.toLong)
      new TrajectoryWriter(path, channel, buffer, cap, 0, false)
    catch
      case t: Throwable =>
        channel.close()
        throw t

  /** Format a Body as a 7-column CSV line: mass,x,y,z,vx,vy,vz\n
    * Matches CsvParser.bodyRowP's expected input exactly.
    *
    * Precision choice: %.15g gives full IEEE-754 double precision (17 sig
    * digits round-trips exactly; %.15g is 16 sig digits which is "good
    * enough" for trajectory dumps — the loss is < 1 ULP per value and never
    * accumulates because each line is independent). For bit-exact round-trips
    * use %.17g; we use %.15g for human readability and ~10% smaller files.
    */
  def formatBody(b: Body): String =
    val m  = b.mass.value
    val px = b.pos.x; val py = b.pos.y; val pz = b.pos.z
    val vx = b.vel.x; val vy = b.vel.y; val vz = b.vel.z
    // f-interpolator: each value must be a local val (Scala 3 f"" does not
    // accept arbitrary expressions with format specs — same lesson as Phase 0
    // and Phase 3).
    f"$m%.15g,$px%.15g,$py%.15g,$pz%.15g,$vx%.15g,$vy%.15g,$vz%.15g\n"

  /** Serialize a Vector[Body] to a CSV string (no trailing newline beyond
    * what each line carries). Useful for in-memory round-trip tests without
    * going through the filesystem.
    */
  def formatBodies(bodies: Vector[Body]): String =
    val sb = new java.lang.StringBuilder(bodies.size * 80L.toInt)
    bodies.foreach { b => sb.append(formatBody(b)) }
    sb.toString

  /** One-shot convenience: write `bodies` to `path` and close. Pre-computes
    * the exact output size by formatting each body once, so the mmap capacity
    * is always sufficient (no guesswork). Returns bytes written.
    *
    * NOTE: this materializes the full CSV content in memory (via
    * `formatBodies`). For multi-GB trajectory dumps where that would blow
    * the heap, use `open(path, estimatedCapacity)` + a loop of `append(body)`
    * instead — that path only holds one formatted line in memory at a time.
    */
  def writeAll(path: Path, bodies: Vector[Body]): Int =
    val content = formatBodies(bodies)
    val w = open(path, content.length.toLong + 1L)
    try
      w.appendRaw(content)
      content.length
    finally
      w.close()
