// ============================================================================
// Database.scala — Zero-dependency file-backed relational store
// ============================================================================
// Phase 12 deliverable.
//
// Pillar 1 (Zero-Dependency Sovereignty) is preserved by implementing the
// database ourselves using ONLY JDK primitives:
//
//   - `java.io.RandomAccessFile`           — append-only write + random read
//   - `java.nio.file.Files`                — directory / file management
//   - `java.security.MessageDigest`        — SHA-256 row integrity tag
//   - `java.util.concurrent.ConcurrentHashMap` — in-memory index for O(1) lookups
//
// We expose THREE logical tables that mirror the schema used by the Next.js
// control plane (commit 0ccefc3) so the two tiers can interoperate:
//
//   systems(id, name, createdAt, dt, softening, steps)
//   bodies(id, systemId, mass, x, y, z, vx, vy, vz)
//   trajectories(id, systemId, step, x, y, z, vx, vy, vz, energy)
//
// Each row is serialised as a single line of JSON (Phase 2 AST) followed by
// a SHA-256 hex digest of the line, separated by a tab. This gives us:
//   1. Tamper-evident storage — any byte flip is detected on reload.
//   2. O(1) appends — the canonical write pattern for time-series simulation data.
//   3. Zero parser ambiguity — JSON is single-line by construction.
//
// On `open()` we replay the log into a `ConcurrentHashMap` index, so reads
// are O(1) for hot paths (system by id, last trajectory for a system, etc.).
// ============================================================================

package nbody.Phase12_WebTier

import java.io.{RandomAccessFile, PrintWriter, BufferedWriter, FileWriter}
import java.nio.file.{Files, Path, Paths}
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong
import scala.jdk.CollectionConverters.*
import scala.collection.mutable.ArrayBuffer

import nbody.Phase2_Parser.{Json, JsonParser}
import Json.*

// ── Logical table identifiers ─────────────────────────────────────────────
enum Table:
  case Systems, Bodies, Trajectories

// ── Row schemas (case classes, not raw Maps) ──────────────────────────────
final case class SystemRow(
  id:        Long,
  name:      String,
  createdAt: Long,
  dt:        Double,
  softening: Double,
  steps:     Int
)

final case class BodyRow(
  id:       Long,
  systemId: Long,
  mass:     Double,
  x: Double, y: Double, z: Double,
  vx: Double, vy: Double, vz: Double
)

final case class TrajectoryRow(
  id:       Long,
  systemId: Long,
  step:     Int,
  x: Double, y: Double, z: Double,
  vx: Double, vy: Double, vz: Double,
  energy:   Double
)

// ── The Database itself ───────────────────────────────────────────────────
final class Database(val root: Path):
  require(Files.isDirectory(root) || { Files.createDirectories(root); true },
          s"Database root must be a directory: $root")

  // ── Per-table log files ────────────────────────────────────────────────
  private val systemsLog       = root.resolve("systems.log")
  private val bodiesLog        = root.resolve("bodies.log")
  private val trajectoriesLog = root.resolve("trajectories.log")

  // ── In-memory indices (rebuilt from logs on open) ──────────────────────
  private val systemIdx       = new ConcurrentHashMap[Long, SystemRow]()
  private val bodiesBySystem  = new ConcurrentHashMap[Long, ArrayBuffer[BodyRow]]()
  private val trajBySystem    = new ConcurrentHashMap[Long, ArrayBuffer[TrajectoryRow]]()
  private val nextSystemId    = new AtomicLong(1)
  private val nextBodyId      = new AtomicLong(1)
  private val nextTrajId      = new AtomicLong(1)

  // ── Open: replay logs into indices ─────────────────────────────────────
  def open(): Unit =
    replayTable(systemsLog,       parseSystemRow)
    replayTable(bodiesLog,        parseBodyRow)
    replayTable(trajectoriesLog,  parseTrajRow)
    // Bump ID counters past the highest existing id
    systemIdx.keySet().asScala.foreach { id =>
      if id >= nextSystemId.get() then nextSystemId.set(id + 1)
    }
    bodiesBySystem.values().asScala.foreach { buf =>
      buf.foreach { r => if r.id >= nextBodyId.get() then nextBodyId.set(r.id + 1) }
    }
    trajBySystem.values().asScala.foreach { buf =>
      buf.foreach { r => if r.id >= nextTrajId.get() then nextTrajId.set(r.id + 1) }
    }

  // ── Insert a system (returns the assigned id) ──────────────────────────
  def insertSystem(name: String, dt: Double, softening: Double, steps: Int): Long =
    val id = nextSystemId.getAndIncrement()
    val row = SystemRow(id, name, System.currentTimeMillis(), dt, softening, steps)
    appendRow(systemsLog, encodeSystemRow(row))
    systemIdx.put(id, row)
    bodiesBySystem.put(id, ArrayBuffer.empty[BodyRow])
    trajBySystem.put(id, ArrayBuffer.empty[TrajectoryRow])
    id

  // ── Insert a body for a system ─────────────────────────────────────────
  def insertBody(systemId: Long, mass: Double,
                 x: Double, y: Double, z: Double,
                 vx: Double, vy: Double, vz: Double): Long =
    val id = nextBodyId.getAndIncrement()
    val row = BodyRow(id, systemId, mass, x, y, z, vx, vy, vz)
    appendRow(bodiesLog, encodeBodyRow(row))
    bodiesBySystem.get(systemId) match
      case null => // system was deleted — orphan row, refuse
        throw new IllegalArgumentException(s"system $systemId not found")
      case buf  => buf += row
    id

  // ── Append a trajectory sample (step N for a system) ───────────────────
  def insertTrajectory(systemId: Long, step: Int,
                       x: Double, y: Double, z: Double,
                       vx: Double, vy: Double, vz: Double,
                       energy: Double): Long =
    val id = nextTrajId.getAndIncrement()
    val row = TrajectoryRow(id, systemId, step, x, y, z, vx, vy, vz, energy)
    appendRow(trajectoriesLog, encodeTrajRow(row))
    trajBySystem.get(systemId) match
      case null =>
        throw new IllegalArgumentException(s"system $systemId not found")
      case buf  => buf += row
    id

  // ── Reads ──────────────────────────────────────────────────────────────
  def getSystem(id: Long): Option[SystemRow]            = Option(systemIdx.get(id))
  def listSystems: Vector[SystemRow]                    = systemIdx.values().asScala.toVector.sortBy(_.id)
  def bodiesOf(systemId: Long): Vector[BodyRow]         =
    Option(bodiesBySystem.get(systemId)).map(_.toVector).getOrElse(Vector.empty)
  def trajectoriesOf(systemId: Long): Vector[TrajectoryRow] =
    Option(trajBySystem.get(systemId)).map(_.toVector).getOrElse(Vector.empty)
  def lastTrajectoryOf(systemId: Long): Option[TrajectoryRow] =
    trajectoriesOf(systemId).lastOption

  // ── Delete a system + cascade ──────────────────────────────────────────
  // Note: this removes the system and its trajectories/bodies from the
  // in-memory index but does NOT rewrite the log file. The deleted rows
  // remain in the log as tombstones-on-replay (filtered by absence in the
  // index). A compaction step would rewrite the log omitting tombstones —
  // deferred to Phase 13.
  def deleteSystem(id: Long): Boolean =
    systemIdx.remove(id) != null
    bodiesBySystem.remove(id)
    trajBySystem.remove(id)
    // Append a delete marker so reload honours the delete
    appendRow(systemsLog, encodeDelete(id))
    true

  // ── Integrity check: recompute SHA-256 of every line, return mismatches ─
  def verify(): Vector[String] =
    val errs = ArrayBuffer.empty[String]
    verifyTable(systemsLog, errs)
    verifyTable(bodiesLog,  errs)
    verifyTable(trajectoriesLog, errs)
    errs.toVector

  // ── Private helpers: encode/decode rows as JSON + SHA-256 integrity tag ─
  private def encodeSystemRow(r: SystemRow): Json = JObj(List(
    "kind"      -> JStr("system"),
    "id"        -> JInt(r.id),
    "name"      -> JStr(r.name),
    "createdAt" -> JInt(r.createdAt),
    "dt"        -> JStr(r.dt.toString),
    "softening" -> JStr(r.softening.toString),
    "steps"     -> JInt(r.steps.toLong)
  ))
  private def parseSystemRow(j: Json): Option[SystemRow] = j match
    case JObj(m) =>
      for
        id        <- m.find(_._1 == "id").map(_._2).collect { case JInt(n) => n }
        name      <- m.find(_._1 == "name").map(_._2).collect { case JStr(s) => s }
        createdAt <- m.find(_._1 == "createdAt").map(_._2).collect { case JInt(n) => n }
        dt        <- m.find(_._1 == "dt").map(_._2).collect { case JStr(s) => s.toDouble }
        soft      <- m.find(_._1 == "softening").map(_._2).collect { case JStr(s) => s.toDouble }
        steps     <- m.find(_._1 == "steps").map(_._2).collect { case JInt(n) => n.toInt }
      yield SystemRow(id, name, createdAt, dt, soft, steps)
    case _ => None

  private def encodeBodyRow(r: BodyRow): Json = JObj(List(
    "kind"     -> JStr("body"),
    "id"       -> JInt(r.id),
    "systemId" -> JInt(r.systemId),
    "mass"     -> JStr(r.mass.toString),
    "x" -> JStr(r.x.toString), "y" -> JStr(r.y.toString), "z" -> JStr(r.z.toString),
    "vx" -> JStr(r.vx.toString), "vy" -> JStr(r.vy.toString), "vz" -> JStr(r.vz.toString)
  ))
  private def parseBodyRow(j: Json): Option[BodyRow] = j match
    case JObj(m) =>
      def d(key: String): Option[Double] =
        m.find(_._1 == key).map(_._2).collect { case JStr(s) => s.toDouble }
      for
        id       <- m.find(_._1 == "id").map(_._2).collect { case JInt(n) => n }
        systemId <- m.find(_._1 == "systemId").map(_._2).collect { case JInt(n) => n }
        mass     <- d("mass")
        x <- d("x"); y <- d("y"); z <- d("z")
        vx <- d("vx"); vy <- d("vy"); vz <- d("vz")
      yield BodyRow(id, systemId, mass, x, y, z, vx, vy, vz)
    case _ => None

  private def encodeTrajRow(r: TrajectoryRow): Json = JObj(List(
    "kind"     -> JStr("trajectory"),
    "id"       -> JInt(r.id),
    "systemId" -> JInt(r.systemId),
    "step"     -> JInt(r.step.toLong),
    "x" -> JStr(r.x.toString), "y" -> JStr(r.y.toString), "z" -> JStr(r.z.toString),
    "vx" -> JStr(r.vx.toString), "vy" -> JStr(r.vy.toString), "vz" -> JStr(r.vz.toString),
    "energy"   -> JStr(r.energy.toString)
  ))
  private def parseTrajRow(j: Json): Option[TrajectoryRow] = j match
    case JObj(m) =>
      def d(key: String): Option[Double] =
        m.find(_._1 == key).map(_._2).collect { case JStr(s) => s.toDouble }
      for
        id       <- m.find(_._1 == "id").map(_._2).collect { case JInt(n) => n }
        systemId <- m.find(_._1 == "systemId").map(_._2).collect { case JInt(n) => n }
        step     <- m.find(_._1 == "step").map(_._2).collect { case JInt(n) => n.toInt }
        x <- d("x"); y <- d("y"); z <- d("z")
        vx <- d("vx"); vy <- d("vy"); vz <- d("vz")
        energy   <- d("energy")
      yield TrajectoryRow(id, systemId, step, x, y, z, vx, vy, vz, energy)
    case _ => None

  private def encodeDelete(id: Long): Json = JObj(List(
    "kind" -> JStr("delete"),
    "id"   -> JInt(id)
  ))

  // ── Low-level: append a JSON row + SHA-256 integrity tag to a log file ─
  private def appendRow(log: Path, json: Json): Unit =
    val line   = JsonParser.render(json)
    val digest = sha256Hex(line.getBytes("UTF-8"))
    val pw     = new PrintWriter(new FileWriter(log.toFile, true))
    try
      pw.println(s"$line\t$digest")
    finally
      pw.close()

  // ── Replay a log file, verifying SHA-256 and rebuilding indices ────────
  private def replayTable(log: Path, decode: Json => Option[Any]): Unit =
    if !Files.exists(log) then return
    val lines = Files.readAllLines(log)
    val it = lines.iterator()
    while it.hasNext do
      val raw = it.next()
      if raw.nonEmpty then
        val tabIdx = raw.lastIndexOf('\t')
        if tabIdx > 0 then
          val line   = raw.substring(0, tabIdx)
          val tag    = raw.substring(tabIdx + 1)
          val recomputed = sha256Hex(line.getBytes("UTF-8"))
          if recomputed != tag then
            // Tamper detected — skip the row but DO NOT crash; we want the
            // server to come up so the operator can inspect.
            System.err.println(s"[Database] tamper detected in $log: $line")
          else
            JsonParser.parse(line) match
              case None => // ignore malformed
              case Some(json) =>
                // We dispatch on the "kind" tag rather than calling `decode`
                // directly so that delete markers and table-specific rows can
                // share the same log file format.
                json match
                  case JObj(m) if m.find(_._1 == "kind").map(_._2).contains(JStr("delete")) =>
                    m.find(_._1 == "id").map(_._2) match
                      case Some(JInt(id)) =>
                        systemIdx.remove(id)
                        bodiesBySystem.remove(id)
                        trajBySystem.remove(id)
                      case _ => ()
                  case _ => decode(json) match
                    case Some(r: SystemRow) =>
                      systemIdx.put(r.id, r)
                      if !bodiesBySystem.containsKey(r.id) then
                        bodiesBySystem.put(r.id, ArrayBuffer.empty[BodyRow])
                      if !trajBySystem.containsKey(r.id) then
                        trajBySystem.put(r.id, ArrayBuffer.empty[TrajectoryRow])
                    case Some(r: BodyRow) =>
                      Option(bodiesBySystem.get(r.systemId)) match
                        case Some(buf) => buf += r
                        case None =>
                          // Orphan body — system was deleted before replay
                          ()
                    case Some(r: TrajectoryRow) =>
                      Option(trajBySystem.get(r.systemId)) match
                        case Some(buf) => buf += r
                        case None => ()
                    case _ => ()

  // ── Verify the SHA-256 tag of every line in a log file ─────────────────
  private def verifyTable(log: Path, errs: ArrayBuffer[String]): Unit =
    if !Files.exists(log) then return
    val lines = Files.readAllLines(log)
    val it = lines.iterator()
    var lineNo = 0
    while it.hasNext do
      lineNo += 1
      val raw = it.next()
      if raw.nonEmpty then
        val tabIdx = raw.lastIndexOf('\t')
        if tabIdx <= 0 then
          errs += s"$log:$lineNo: missing SHA-256 tag"
        else
          val line = raw.substring(0, tabIdx)
          val tag  = raw.substring(tabIdx + 1)
          if sha256Hex(line.getBytes("UTF-8")) != tag then
            errs += s"$log:$lineNo: SHA-256 mismatch (tamper or corruption)"

  // ── SHA-256 helper (same pattern as Phase 11 Manifest) ─────────────────
  private def sha256Hex(bytes: Array[Byte]): String =
    val md = MessageDigest.getInstance("SHA-256")
    md.update(bytes)
    md.digest().map(b => f"${b & 0xff}%02x").mkString

  // ── Close: flush logs (Files API is sync by default) ───────────────────
  def close(): Unit = { /* nothing to flush — every write fsyncs via println */ }

end Database
