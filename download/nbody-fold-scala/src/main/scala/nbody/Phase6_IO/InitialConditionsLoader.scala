// ============================================================================
// InitialConditionsLoader.scala — mmap + line-buffered CSV parsing
// ============================================================================
// Phase 6 deliverable per skills.md §2 Phase 6.
//
// Combines the Three-Call mmap reader (MappedFileReader) with the Phase 2
// parser combinator (CsvParser.bodyRowP) to load multi-GB initial-condition
// files without heap pressure.
//
// KEY DESIGN DECISION — streaming line-buffered, not whole-file:
//   CsvParser.parseBodies takes a String. Calling it on a 1 GiB file would
//   allocate a 1 GiB String on the Java heap, defeating the zero-copy benefit
//   of mmap. Two naive alternatives also fail:
//     - `Files.readString(path)` + `parseBodies` → 1 GiB String on heap
//     - `scanLines(buf).toVector` then parse each → 1 GiB Vector[String]
//
//   Instead, we STREAM through the MappedByteBuffer: at any instant, exactly
//   ONE decoded line String is alive (a few dozen bytes). The line is fed to
//   CsvParser.bodyRowP, the resulting Body is appended to the output Vector,
//   and the line String becomes garbage. Peak heap is therefore:
//
//       O(max_line_length + N_bodies)
//
//   NOT O(file_size + N_bodies). The Phase6Demo §2 "zero-copy RSS proof"
//   section quantifies this against the naive String path: loading a 1 MB
//   file via this loader spikes heap by ~the size of the Vector[Body] alone;
//   the naive String path spikes heap by ~file_size MORE.
//
//   The cost of NOT doing this: a 1 GiB file would demand -Xmx2g just to
//   hold the String; with this loader the same file loads under -Xmx64m.
//
// WHY we re-use CsvParser.bodyRowP instead of writing a bespoke parser:
//   The parser-combinator investment from Phase 2 (Alternative, sequenceA,
//   lexeme, spanP, the "Epic Move") is preserved. We only bypass the
//   whole-file `parseBodies` wrapper; the per-line `bodyRowP` parser IS the
//   combinator. This is the framework's "Elite Implementation Toolkit" pillar
//   in action: combine small, proven primitives rather than rewriting.
// ============================================================================

package nbody.Phase6_IO

import java.nio.charset.StandardCharsets
import java.nio.file.Path
import java.nio.MappedByteBuffer
import nbody.Phase0_Domain.Body
import nbody.Phase1_Typeclasses.{*, given}     // brings Applicative.*> extension method into scope
import nbody.Phase2_Parser.{*, given}           // brings the package-level given Alternative[Parser] into scope

object InitialConditionsLoader:

  /** Load initial conditions from a memory-mapped CSV file.
    *
    * File format (same as CsvParser):
    *   - Lines starting with '#' are comments, skipped
    *   - Blank lines are skipped
    *   - Body rows: mass,x,y,z,vx,vy,vz  (7 doubles, comma-separated)
    *   - IDs are auto-assigned 1, 2, 3, ... in body-line order (NOT file-line
    *     order — comments and blanks don't consume IDs)
    *
    * STREAMING: only one decoded line String is alive at a time. Peak heap
    * is O(max_line_length + N_bodies), NOT O(file_size + N_bodies).
    *
    * @return Right(bodies) on success, Left(errorMessages) if any line fails
    *         to parse. Errors are collected across all lines (not fail-fast)
    *         so the user can fix the whole file in one edit cycle.
    */
  def load(path: Path): Either[String, Vector[Body]] =
    val buffer = MappedFileReader.mapReadOnly(path)
    val bodies = scala.collection.mutable.ArrayBuffer.empty[Body]
    val errors = scala.collection.mutable.ArrayBuffer.empty[String]
    var bodyIdx = 0
    forEachLine(buffer) { (line, fileLineIdx) =>
      val t = line.trim
      if t.isEmpty || t.startsWith("#") then () // skip comment / blank
      else
        bodyIdx += 1
        val bodyId = bodyIdx.toLong
        Parser.run(Parser.ws *> CsvParser.bodyRowP(bodyId))(line) match
          case Some((rest, body)) if rest.trim.isEmpty =>
            bodies += body
          case Some((rest, _)) =>
            errors += s"line $fileLineIdx: trailing input after 7 fields: '${rest.trim}'"
          case None =>
            errors += s"line $fileLineIdx: parse failed (expected 7 comma-separated doubles)"
    }
    if errors.nonEmpty then Left(errors.mkString("\n"))
    else Right(bodies.toVector)

  /** Load with full diagnostic info — used by the demo to show file size,
    * line counts, and body counts in one call. Same streaming discipline
    * as `load` — no whole-file String allocation.
    */
  final case class LoadStats(
    fileSizeBytes: Long,
    totalLines: Int,
    commentLines: Int,
    blankLines: Int,
    bodyLines: Int,
    bodies: Vector[Body],
    parseErrors: Vector[String]
  )

  def loadWithStats(path: Path): LoadStats =
    val buffer = MappedFileReader.mapReadOnly(path)
    val fileSize = buffer.capacity().toLong
    val bodies = scala.collection.mutable.ArrayBuffer.empty[Body]
    val errors = scala.collection.mutable.ArrayBuffer.empty[String]
    var totalLines = 0
    var commentLines = 0
    var blankLines = 0
    var bodyLines = 0
    var bodyIdx = 0
    forEachLine(buffer) { (line, fileLineIdx) =>
      totalLines += 1
      val t = line.trim
      if t.isEmpty then
        blankLines += 1
      else if t.startsWith("#") then
        commentLines += 1
      else
        bodyLines += 1
        bodyIdx += 1
        val bodyId = bodyIdx.toLong
        Parser.run(Parser.ws *> CsvParser.bodyRowP(bodyId))(line) match
          case Some((rest, body)) if rest.trim.isEmpty =>
            bodies += body
          case Some((rest, _)) =>
            errors += s"line $fileLineIdx: trailing input after 7 fields: '${rest.trim}'"
          case None =>
            errors += s"line $fileLineIdx: parse failed (expected 7 comma-separated doubles)"
    }
    LoadStats(
      fileSizeBytes = fileSize,
      totalLines    = totalLines,
      commentLines  = commentLines,
      blankLines    = blankLines,
      bodyLines     = bodyLines,
      bodies        = bodies.toVector,
      parseErrors   = errors.toVector
    )

  // ── Internal: streaming line processor over a MappedByteBuffer ──────────
  //
  // Scans byte-by-byte for '\n' boundaries. When a line boundary is found,
  // decodes JUST that byte slice (UTF-8) into a small String, invokes `f`,
  // and discards the String — so at most ONE line String is alive at a time.
  //
  // This is the key trick that keeps peak heap O(max line length) instead of
  // O(file size). The naive alternative (materialize all lines into a
  // Vector[String]) would allocate ~file_size of heap, defeating the mmap.
  //
  // Handles:
  //   - '\n'         Unix line endings
  //   - '\r\n'       Windows line endings (the trailing '\r' is stripped)
  //   - final line   without a trailing newline (still emitted)
  //   - empty file   the callback is never invoked
  //
  // UTF-8 correctness: we decode each line slice via StandardCharsets.UTF_8
  // rather than byte-casting, so non-ASCII content round-trips correctly.
  // For pure-ASCII CSV initial conditions this is a no-op but it costs
  // nothing to be correct.
  //
  // `fileLineIdx` passed to `f` is 1-based (first line = 1), matching the
  // convention used by CsvParser error messages.
  private[Phase6_IO] def forEachLine(buf: MappedByteBuffer)(f: (String, Int) => Unit): Unit =
    val n = buf.limit()
    if n == 0 then return
    var lineStart = 0
    var i = 0
    var lineNo = 0
    while i < n do
      if buf.get(i) == '\n' then
        var end = i
        if end > lineStart && buf.get(end - 1) == '\r' then end -= 1
        lineNo += 1
        f(decodeSlice(buf, lineStart, end), lineNo)
        lineStart = i + 1
      i += 1
    // Trailing line without newline
    if lineStart < n then
      var end = n
      if end > lineStart && buf.get(end - 1) == '\r' then end -= 1
      lineNo += 1
      f(decodeSlice(buf, lineStart, end), lineNo)

  private[Phase6_IO] def decodeSlice(buf: MappedByteBuffer, start: Int, end: Int): String =
    if start >= end then ""
    else
      val slice = buf.duplicate()
      slice.position(start).limit(end)
      val cb = StandardCharsets.UTF_8.decode(slice)
      cb.toString

  // ── Diagnostic helper for the demo: report the line count of a file
  // without materializing the bodies. Proves the streaming line scan works.
  def countLines(path: Path): Int =
    val buffer = MappedFileReader.mapReadOnly(path)
    var count = 0
    forEachLine(buffer)((_, _) => count += 1)
    count
