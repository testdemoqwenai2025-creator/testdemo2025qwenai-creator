// ============================================================================
// Phase6Demo.scala — File I/O via Three-Call mmap verification
// ============================================================================
// Phase 6 verification per skills.md §2 Phase 6:
//
//   1. Three-Call pattern: open → size → map → close (mapping survives)
//   2. Round-trip: TrajectoryWriter writes bodies, InitialConditionsLoader
//      reads them back, positions/velocities/masses match
//   3. Zero-copy RSS proof: mmap path uses ~file_size LESS heap than the
//      naive String-load path (proves the mmap is not just a buffered copy)
//   4. Large-file smoke: load a ~1 MB CSV, verify body count + first/last
//   5. Error handling: empty file, comment-only file, malformed line
//   6. Integration with Phase 5: load initial conditions, run a few steps,
//      verify the simulator works on file-loaded data
//
// Run with:  sbt "runMain nbody.Phase6Demo"
// ============================================================================

package nbody

import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path}
import java.nio.{MappedByteBuffer, ByteBuffer}
import nbody.Phase0_Domain.*
import nbody.Phase2_Parser.CsvParser
import nbody.Phase5_NBody.Simulator
import nbody.Phase6_IO.*

object Phase6Demo:

  private var passed = 0
  private var failed = 0
  private def check(label: String, cond: Boolean, detail: String = ""): Unit =
    if cond then
      passed += 1
      println(s"  [PASS] $label")
    else
      failed += 1
      println(s"  [FAIL] $label  $detail")

  // ── Temp-file helpers ───────────────────────────────────────────────────
  // We use Files.createTempFile so the OS cleans up if the demo crashes.
  // The demo also explicitly deletes temp files at the end of each section.
  private def newTempFile(prefix: String, suffix: String = ".csv"): Path =
    Files.createTempFile(s"phase6-$prefix-", suffix)

  private def deleteQuietly(p: Path): Unit =
    try Files.deleteIfExists(p)
    catch case _: Throwable => ()

  // ── Heap measurement helpers ────────────────────────────────────────────
  // Runtime heap = totalMemory - freeMemory. This is the bytes currently
  // committed to live objects in the Java heap. It does NOT include mmap
  // regions (which live in the OS page cache, outside the Java heap) —
  // which is exactly what makes the zero-copy proof work.
  private def usedHeap(): Long =
    val rt = Runtime.getRuntime
    rt.totalMemory() - rt.freeMemory()

  // Best-effort GC. System.gc() is a hint, not a command, so we call it a
  // few times with a short sleep and watch for the heap reading to stabilise.
  // NOTE: must use java.lang.System explicitly — `System` resolves to
  // nbody.Phase0_Domain.System (the domain class) due to the wildcard import
  // of Phase0_Domain.*. Same namespace collision Phase 5 hit with nanoTime.
  private def forceGc(): Unit =
    var prev = -1L
    var stable = 0
    while stable < 3 do
      java.lang.System.gc()
      Thread.sleep(20)
      val now = usedHeap()
      if math.abs(now - prev) < 1024 then stable += 1 else stable = 0
      prev = now

  def main(args: Array[String]): Unit =

    println("=== Phase 6: File I/O via Three-Call mmap Demo ===")
    println()

    // ── 0. Three-Call pattern demonstration ──────────────────────────────
    println("--- 0. Three-Call mmap pattern (open → size → map) ---")
    val tinyPath = newTempFile("tiny")
    val tinyContent = "# comment\n1000.0,0.0,0.0,0.0,0.0,0.0,0.0\n1.0,10.0,0.0,0.0,0.0,10.0,0.0\n"
    Files.write(tinyPath, tinyContent.getBytes(StandardCharsets.UTF_8))
    val tinySize = Files.size(tinyPath)
    println(s"  Wrote temp file: $tinyPath ($tinySize bytes)")
    println("  Three-Call trace:")
    val (tinyBuf, trace) = MappedFileReader.mapReadOnlyWithTrace(tinyPath)
    println(trace)
    println(s"  MappedByteBuffer.capacity() = ${tinyBuf.capacity()} bytes")
    // Verify byte-for-byte content matches the original
    val bufBytes = new Array[Byte](tinyBuf.capacity())
    tinyBuf.position(0).get(bufBytes)
    val bufString = new String(bufBytes, StandardCharsets.UTF_8)
    check("MappedByteBuffer size == file size",
      tinyBuf.capacity() == tinySize, s"got ${tinyBuf.capacity()} vs $tinySize")
    check("MappedByteBuffer content == file content (byte-for-byte)",
      bufString == tinyContent,
      if bufString == tinyContent then "" else s"got '${bufString.take(80)}...'")
    // Verify the mapping survived channel.close() — we can still read it
    check("mapping survives channel close (read after mapReadOnly returns)",
      tinyBuf.get(0) == '#'.toByte)
    deleteQuietly(tinyPath)
    println()

    // ── 1. Round-trip: TrajectoryWriter → InitialConditionsLoader ────────
    println("--- 1. Round-trip: write bodies, load them back ---")
    val originals = Vector(
      Body(1L, Mass(1000.0), Vec3(0, 0, 0),   Vec3(0, 0, 0)),
      Body(2L, Mass(1.0),    Vec3(10, 0, 0),  Vec3(0, 10, 0)),
      Body(3L, Mass(2.0),    Vec3(0, 20, 0),  Vec3(-math.sqrt(100.0), 0, 0)),
      Body(4L, Mass(0.5),    Vec3(-5, -5, 1), Vec3(3.3, -2.1, 0.7))
    )
    val rtPath = newTempFile("roundtrip")
    val bytesWritten = TrajectoryWriter.writeAll(rtPath, originals)
    val rtFileSize = Files.size(rtPath)
    println(s"  Wrote ${originals.size} bodies → $rtPath ($bytesWritten bytes; file size $rtFileSize)")
    check("TrajectoryWriter.writeAll bytesWritten == file size",
      bytesWritten == rtFileSize, s"got $bytesWritten vs $rtFileSize")

    val loadedOrErr = InitialConditionsLoader.load(rtPath)
    loadedOrErr match
      case Left(err) =>
        check("InitialConditionsLoader.load round-trip succeeds", false, err)
      case Right(loaded) =>
        check("loaded body count matches written count",
          loaded.size == originals.size, s"got ${loaded.size} vs ${originals.size}")
        // IDs are reassigned 1..N on load (CsvParser semantics) — compare by
        // position in the vector, not by id.
        var allMatch = loaded.size == originals.size
        if allMatch then
          for (orig, ld) <- originals.zip(loaded) do
            if math.abs(orig.mass.value - ld.mass.value) > 1e-12 then allMatch = false
            if math.abs(orig.pos.x - ld.pos.x) > 1e-12 then allMatch = false
            if math.abs(orig.pos.y - ld.pos.y) > 1e-12 then allMatch = false
            if math.abs(orig.pos.z - ld.pos.z) > 1e-12 then allMatch = false
            if math.abs(orig.vel.x - ld.vel.x) > 1e-12 then allMatch = false
            if math.abs(orig.vel.y - ld.vel.y) > 1e-12 then allMatch = false
            if math.abs(orig.vel.z - ld.vel.z) > 1e-12 then allMatch = false
        check("all masses/positions/velocities match within 1e-12",
          allMatch, if !allMatch then s"loaded = $loaded" else "")
        // IDs were reassigned 1..N (CsvParser semantics)
        val idsReassigned = loaded.zipWithIndex.forall { (b, i) => b.id == (i + 1).toLong }
        check("loaded IDs reassigned 1..N (CsvParser semantics)",
          idsReassigned, s"loaded ids = ${loaded.map(_.id).mkString(",")}")
    deleteQuietly(rtPath)
    println()

    // ── 2. Zero-copy RSS proof: mmap vs naive String load ────────────────
    println("--- 2. Zero-copy RSS proof (mmap vs naive String load) ---")
    // Generate a ~1 MB CSV of synthetic bodies. At ~50 bytes/line this is
    // ~20k bodies — enough that the file-content String would dominate heap
    // if we used the naive path, but small enough that the demo runs in <2s.
    val nSynthetic = 20000
    println(s"  Generating $nSynthetic synthetic bodies...")
    val synthetic = (1 to nSynthetic).map { i =>
      val d = i.toDouble
      Body(i.toLong, Mass(1.0 + (d % 10.0)),
        Vec3(d * 0.1, d * 0.01, d * 0.001),
        Vec3(d * 0.001, d * 0.0001, -d * 0.00001))
    }.toVector
    val bigPath = newTempFile("big")
    val bigBytesWritten = TrajectoryWriter.writeAll(bigPath, synthetic)
    val bigFileSize = Files.size(bigPath)
    val fsMB = bigFileSize.toDouble / (1024.0 * 1024.0)
    println(f"  Wrote $nSynthetic bodies → $bigPath ($bigBytesWritten bytes = $fsMB%.2f MiB)")
    println()

    // ── Path A: mmap + streaming line-buffered load (Phase 6 path) ──────
    forceGc()
    val heapBeforeMmap = usedHeap()
    val tMmapStart = java.lang.System.nanoTime()
    val mmapBodies = InitialConditionsLoader.load(bigPath) match
      case Right(bs) => bs
      case Left(err) => throw new RuntimeException(s"mmap load failed: $err")
    val tMmapEnd = java.lang.System.nanoTime()
    forceGc()
    val heapAfterMmap = usedHeap()
    val mmapMs = (tMmapEnd - tMmapStart) / 1_000_000.0
    val mmapDelta = heapAfterMmap - heapBeforeMmap
    val mmapDeltaMB = mmapDelta.toDouble / (1024.0 * 1024.0)
    println(f"  Path A (mmap):    load time = $mmapMs%.1f ms")
    println(f"                    heap delta = $mmapDeltaMB%.2f MiB (baseline → after load + GC)")
    println(f"                    bodies loaded = ${mmapBodies.size}")

    // ── Path B: naive String load (Files.readString + CsvParser.parseBodies) ──
    // This is the path most Java code would write. It allocates a String
    // holding the ENTIRE file content on the heap, in addition to the
    // Vector[Body]. We expect heap delta ≈ file_size + bodies_size, vs the
    // mmap path's bodies_size alone.
    forceGc()
    val heapBeforeStr = usedHeap()
    val tStrStart = java.lang.System.nanoTime()
    val wholeFileString = Files.readString(bigPath)
    val strBodies = CsvParser.parseBodies(wholeFileString) match
      case Right(bs) => bs
      case Left(err) => throw new RuntimeException(s"String load failed: $err")
    val tStrEnd = java.lang.System.nanoTime()
    forceGc()
    val heapAfterStr = usedHeap()
    val strMs = (tStrEnd - tStrStart) / 1_000_000.0
    val strDelta = heapAfterStr - heapBeforeStr
    val strDeltaMB = strDelta.toDouble / (1024.0 * 1024.0)
    println(f"  Path B (String):  load time = $strMs%.1f ms")
    println(f"                    heap delta = $strDeltaMB%.2f MiB (baseline → after load + GC)")
    println(f"                    bodies loaded = ${strBodies.size}")
    println()

    // ── Correctness: both paths must yield identical bodies ─────────────
    var bothEqual = mmapBodies.size == strBodies.size
    if bothEqual then
      for (a, b) <- mmapBodies.zip(strBodies) do
        if math.abs(a.mass.value - b.mass.value) > 1e-12 then bothEqual = false
        if math.abs(a.pos.x - b.pos.x) > 1e-12 then bothEqual = false
        if math.abs(a.pos.y - b.pos.y) > 1e-12 then bothEqual = false
        if math.abs(a.pos.z - b.pos.z) > 1e-12 then bothEqual = false
        if math.abs(a.vel.x - b.vel.x) > 1e-12 then bothEqual = false
        if math.abs(a.vel.y - b.vel.y) > 1e-12 then bothEqual = false
        if math.abs(a.vel.z - b.vel.z) > 1e-12 then bothEqual = false
    check("mmap path and String path produce identical bodies",
      bothEqual, if !bothEqual then "body contents differ" else "")

    // ── The zero-copy proof: mmap delta < String delta by ~file_size ─────
    // The String path must allocate ~file_size of extra heap (the whole-file
    // String). The mmap path's heap delta is just the Vector[Body] (the
    // MappedByteBuffer itself is NOT on the Java heap). So:
    //   strDelta - mmapDelta ≈ file_size
    // We assert a weaker bound: the mmap delta is strictly less than the
    // String delta. (We can't assert an exact file_size difference because
    // GC and String dedup make the exact number noisy.)
    val deltaDiff = strDelta - mmapDelta
    val deltaDiffMB = deltaDiff.toDouble / (1024.0 * 1024.0)
    println(f"  Heap delta difference (String - mmap) = $deltaDiffMB%.2f MiB")
    println(f"  (Expected ≈ file size = $fsMB%.2f MiB — the String path pays this extra)")
    check("mmap path uses STRICTLY LESS heap than String path",
      mmapDelta < strDelta,
      f"mmap=$mmapDeltaMB%.2f MiB vs String=$strDeltaMB%.2f MiB")
    // Stronger check: the difference should be at least half the file size.
    // (The String path holds the whole file as a char[]; with compact strings
    //  that's ~file_size bytes. The mmap path holds zero bytes of file content.)
    val halfFile = bigFileSize / 2
    check("heap delta difference ≥ ½ × file size (zero-copy confirmed)",
      deltaDiff >= halfFile,
      f"got $deltaDiff bytes vs threshold $halfFile bytes")
    // Sanity: mmap delta should be < file_size (bodies take some heap, but
    // the file content does NOT). We allow up to 2×file_size to account for
    // the Vector[Body] which can be larger than the CSV text (object headers
    // etc.). The key invariant is that mmap < String, proven above.
    println()

    // ── 3. Large-file smoke: body count + first/last ────────────────────
    println("--- 3. Large-file smoke (count + first/last body) ---")
    val stats = InitialConditionsLoader.loadWithStats(bigPath)
    val fsKB = stats.fileSizeBytes.toDouble / 1024.0
    println(f"  File: $fsKB%.1f KiB, ${stats.totalLines} lines " +
            f"(${stats.commentLines} comments, ${stats.blankLines} blank, ${stats.bodyLines} body)")
    check("body count matches generated count",
      stats.bodies.size == nSynthetic,
      s"got ${stats.bodies.size} vs $nSynthetic")
    check("no parse errors",
      stats.parseErrors.isEmpty,
      if stats.parseErrors.nonEmpty then stats.parseErrors.head else "")
    // First body: id=1, mass = 1.0 + (1.0 % 10.0) = 2.0, pos=(0.1, 0.01, 0.001)
    val first = stats.bodies.head
    val firstMassOk = math.abs(first.mass.value - 2.0) < 1e-12
    val firstPosOk = math.abs(first.pos.x - 0.1) < 1e-12 &&
                     math.abs(first.pos.y - 0.01) < 1e-12 &&
                     math.abs(first.pos.z - 0.001) < 1e-12
    check("first body: id=1, mass=2.0 (=1.0+(1%10)), pos=(0.1, 0.01, 0.001)",
      first.id == 1L && firstMassOk && firstPosOk,
      s"got $first")
    // Last body: id=nSynthetic
    val last = stats.bodies.last
    val lastIdx = nSynthetic.toDouble
    val lastMassOk = math.abs(last.mass.value - (1.0 + (lastIdx % 10.0))) < 1e-12
    val lastIdOk = last.id == nSynthetic.toLong
    check(s"last body: id=$nSynthetic, mass matches formula",
      lastIdOk && lastMassOk, s"got $last")
    println()

    // ── 4. Error handling: empty / comment-only / malformed ─────────────
    println("--- 4. Error handling (empty, comment-only, malformed) ---")
    // Empty file
    val emptyPath = newTempFile("empty")
    Files.write(emptyPath, Array.emptyByteArray)
    val emptyResult = InitialConditionsLoader.load(emptyPath)
    check("empty file → Right(Vector.empty)",
      emptyResult == Right(Vector.empty), s"got $emptyResult")
    deleteQuietly(emptyPath)

    // Comment-only file
    val commentPath = newTempFile("comments")
    Files.write(commentPath,
      "# this is a comment\n# another comment\n\n# yet another\n".getBytes(StandardCharsets.UTF_8))
    val commentResult = InitialConditionsLoader.load(commentPath)
    check("comment-only file → Right(Vector.empty)",
      commentResult == Right(Vector.empty), s"got $commentResult")
    deleteQuietly(commentPath)

    // Malformed: a bad number on line 2
    val badPath = newTempFile("bad")
    Files.write(badPath,
      "1.0,0,0,0,0,0,0\nnot_a_number,1,2,3,4,5,6\n3.0,0,0,0,0,0,0\n".getBytes(StandardCharsets.UTF_8))
    val badResult = InitialConditionsLoader.load(badPath)
    val badErrMsg = badResult.fold(identity, _ => "")
    check("malformed file → Left(error mentioning line 2)",
      badResult.isLeft && badErrMsg.contains("line 2"),
      s"got $badResult")
    deleteQuietly(badPath)

    // Malformed: too few fields
    val shortPath = newTempFile("short")
    Files.write(shortPath, "1.0,2.0,3.0\n".getBytes(StandardCharsets.UTF_8))
    val shortResult = InitialConditionsLoader.load(shortPath)
    check("too-few-fields file → Left(error)",
      shortResult.isLeft, s"got $shortResult")
    deleteQuietly(shortPath)
    println()

    // ── 5. Integration with Phase 5: load + run simulation ──────────────
    println("--- 5. Integration with Phase 5 (load → simulate) ---")
    // Write a 2-body Kepler system to a CSV, load it, run 100 steps, verify
    // the energy drift is small (loose threshold for demo).
    val keplerBodies = Vector(
      Body(1L, Mass(1000.0),
        Vec3(-1.0 * 10.0 / 1001.0, 0, 0),
        Vec3(0, -1.0 * math.sqrt(1001.0 / 10.0) / 1001.0, 0)),
      Body(2L, Mass(1.0),
        Vec3(1000.0 * 10.0 / 1001.0, 0, 0),
        Vec3(0, 1000.0 * math.sqrt(1001.0 / 10.0) / 1001.0, 0))
    )
    val keplerPath = newTempFile("kepler")
    TrajectoryWriter.writeAll(keplerPath, keplerBodies)
    val keplerLoaded = InitialConditionsLoader.load(keplerPath) match
      case Right(bs) => bs
      case Left(err) => throw new RuntimeException(s"kepler load failed: $err")
    // Wrap loaded bodies into a System for Simulator.evolve
    val keplerSystem = System(Vector(Entity(1L, Vector(ComponentVector(
      keplerLoaded.map(b => Component.Single(b))
    )))))
    val eInit = keplerSystem.totalEnergy(0.0)
    val dt = 0.01
    val nSteps = 100
    println(s"  Loaded ${keplerLoaded.size} bodies, initial energy = $eInit")
    println(s"  Running $nSteps steps with dt=$dt...")
    val finalSystem = Simulator.evolve(keplerSystem, dt, nSteps, softening = 0.0)
    val eFinal = finalSystem.totalEnergy(0.0)
    val drift = math.abs(eFinal - eInit) / math.abs(eInit)
    val driftVal = drift
    println(f"  Final energy = $eFinal, relative drift = $driftVal%.2e")
    // Loose threshold: 100 steps of leapfrog at dt=0.01 should keep drift
    // well under 1e-3 for a 2-body Kepler system.
    check("energy drift < 1e-3 over 100 steps on file-loaded data",
      drift < 1e-3, f"got $driftVal%.2e")
    // Also verify the loaded bodies actually evolved (positions changed)
    val moved = finalSystem.bodies.zip(keplerLoaded).forall { (fb, ob) =>
      math.abs(fb.pos.x - ob.pos.x) > 1e-9 ||
      math.abs(fb.pos.y - ob.pos.y) > 1e-9
    }
    check("positions actually changed after 100 steps (simulator ran on loaded data)",
      moved, "bodies did not move")
    deleteQuietly(keplerPath)
    deleteQuietly(bigPath)
    println()

    // ── Final summary ────────────────────────────────────────────────────
    println("=== Phase 6 self-checks summary ===")
    println(s"  Passed: $passed")
    println(s"  Failed: $failed")
    if failed == 0 then
      println()
      println("Phase 6 File I/O verified. Ready for Phase 7 (Corecursion & Streaming).")
    else
      println()
      println(s"⚠ $failed self-check(s) failed — fix before proceeding.")
      sys.exit(1)
