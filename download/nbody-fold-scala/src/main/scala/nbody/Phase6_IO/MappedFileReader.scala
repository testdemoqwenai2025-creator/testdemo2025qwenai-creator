// ============================================================================
// MappedFileReader.scala — Three-Call mmap file reader
// ============================================================================
// Phase 6 deliverable per skills.md §2 Phase 6.
//
// The "Three-Call" pattern is Pillar 6 (Elite Toolkit) of the framework. It is
// the JVM analogue of the POSIX `open → fstat → mmap` idiom: three syscalls
// turn a file on disk into a region of the process address space backed by the
// OS page cache, with NO heap allocation proportional to file size.
//
//   call 1 — open  : FileChannel.open(path, READ)
//   call 2 — size  : channel.size()               (fstat equivalent)
//   call 3 — map   : channel.map(READ_ONLY, 0, size)
//   then           : channel.close()
//
// Why this is "zero-copy":
//   - The returned MappedByteBuffer is a direct view onto the OS page cache.
//   - Reading buffer.get(i) does a virtual-memory access, not a heap copy.
//   - The JVM heap does NOT grow in proportion to the file size.
//   - On Linux this is literally `mmap(2)` under the hood; on macOS the same.
//
// Why closing the channel is safe:
//   - The java.nio spec guarantees the mapping outlives the channel. The OS
//     holds the mapping open until the ByteBuffer is garbage-collected (which
//     triggers the internal Cleaner → munmap). For long-running services we
//     would pair this with explicit `sun.misc.Unsafe.invokeCleaner` calls,
//     but that is internal API; for this framework we rely on GC, which is
//     the documented portable behaviour.
//
// Why we cap at Int.MaxValue bytes:
//   - MappedByteBuffer is indexed by `int position`, so a single mapping
//     cannot exceed 2 GiB. For multi-GB files, use multiple mappings via
//     `mapReadOnly(path, offset, length)`. Phase 7's streaming layer will
//     compose this for arbitrarily-large inputs.
// ============================================================================

package nbody.Phase6_IO

import java.nio.channels.FileChannel
import java.nio.file.{Path, StandardOpenOption}
import java.nio.MappedByteBuffer

object MappedFileReader:

  /** Three-Call mmap: open → size → map(READ_ONLY).
    *
    * Returns a MappedByteBuffer whose lifetime is independent of the channel
    * (the channel is closed; the mapping survives until the buffer is GC'd).
    *
    * @throws java.nio.file.NoSuchFileException if `path` does not exist
    * @throws IllegalArgumentException if the file is larger than 2 GiB
    *         (Int.MaxValue bytes) — use the offset/length overload instead
    */
  def mapReadOnly(path: Path): MappedByteBuffer =
    // ── call 1: open ──────────────────────────────────────────────────────
    val channel = FileChannel.open(path, StandardOpenOption.READ)
    try
      // ── call 2: size (fstat equivalent) ─────────────────────────────────
      val size = channel.size()
      if size > Int.MaxValue.toLong then
        throw new IllegalArgumentException(
          s"File too large for a single MappedByteBuffer (max ${Int.MaxValue} bytes): " +
          s"$size bytes — $path. Use mapReadOnly(path, offset, length) for multi-GB files."
        )
      // ── call 3: map (mmap equivalent) ───────────────────────────────────
      val buffer = channel.map(FileChannel.MapMode.READ_ONLY, 0L, size)
      buffer
    finally
      // The mapping outlives the channel per java.nio spec.
      channel.close()

  /** Three-Call mmap over a byte-range of a file. Compose multiple calls to
    * this to stream through files larger than 2 GiB.
    *
    * The file's total size is still queried (call 2) so we can validate the
    * requested range; this preserves the "fstat before mmap" discipline.
    */
  def mapReadOnly(path: Path, offset: Long, length: Long): MappedByteBuffer =
    val channel = FileChannel.open(path, StandardOpenOption.READ)         // call 1
    try
      val fileSize = channel.size()                                        // call 2
      if offset < 0L || length < 0L || offset + length > fileSize then
        throw new IllegalArgumentException(
          s"Invalid range [$offset, ${offset + length}) for file of size $fileSize — $path"
        )
      if length > Int.MaxValue.toLong then
        throw new IllegalArgumentException(
          s"Requested mapping length $length exceeds 2 GiB single-mapping limit — $path"
        )
      channel.map(FileChannel.MapMode.READ_ONLY, offset, length)          // call 3
    finally
      channel.close()

  /** Diagnostic: report the three calls as a structured string. Used by the
    * demo to make the Three-Call pattern visible. Production callers should
    * use `mapReadOnly` directly — this method just adds logging.
    */
  def mapReadOnlyWithTrace(path: Path): (MappedByteBuffer, String) =
    val channel = FileChannel.open(path, StandardOpenOption.READ)
    try
      val size = channel.size()
      if size > Int.MaxValue.toLong then
        throw new IllegalArgumentException(
          s"File too large for a single MappedByteBuffer: $size bytes — $path"
        )
      val buffer = channel.map(FileChannel.MapMode.READ_ONLY, 0L, size)
      val trace =
        s"  call 1 open  : FileChannel.open($path, READ) → channel\n" +
        s"  call 2 size  : channel.size() → $size bytes\n" +
        s"  call 3 map   : channel.map(READ_ONLY, 0, $size) → MappedByteBuffer\n" +
        s"  finally      : channel.close()  (mapping survives)"
      (buffer, trace)
    finally
      channel.close()
