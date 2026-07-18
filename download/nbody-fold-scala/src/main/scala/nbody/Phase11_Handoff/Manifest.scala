// ============================================================================
// Manifest.scala — Programmatic project introspection for Phase 11 handoff
// ============================================================================
// Phase 11 deliverable: a "release manifest" that captures the project's
// build-time identity — git revision, JDK/Scala/sbt versions, file inventory
// with SHA-256 hashes, total LOC, phase count. Used to:
//
//   1. Prove reproducibility (same manifest at two different times on the
//      same commit ⇒ no silent source drift).
//   2. Enable supply-chain audit (every .scala file hashed + indexed).
//   3. Generate a JSON release artifact (ReleaseArtifact.scala) that
//      downstream consumers can pin in their build manifests.
//
// All collection is performed via JDK primitives only — `java.nio.file.Files`
// for the file walk, `java.security.MessageDigest` for SHA-256, and
// `java.lang.ProcessBuilder` for git invocations. No third-party deps. This
// honours Pillar 1 (Zero-Dependency Sovereignty) and Pillar 6 (Elite Toolkit).
// ============================================================================

package nbody.Phase11_Handoff

import java.nio.file.{Files, Path, Paths}
import java.security.MessageDigest
import scala.jdk.StreamConverters.*
import scala.jdk.CollectionConverters.*

// ── Pure-data case classes ────────────────────────────────────────────────
// These are intentionally `final`-style case classes (Scala 3 gives us that
// for free) so they have structural equality — required for the round-trip
// JSON test in ReleaseArtifactSpec (parse ∘ render = identity).

object Manifest:

  /** One source file's release identity. */
  case class FileInfo(
    path: String,    // path relative to project root, POSIX-style ("/" separators)
    bytes: Long,     // file size in bytes
    sha256: String,  // lowercase hex SHA-256 of file contents
    loc: Long        // line count (newline-terminated lines)
  )

  /** Top-level project manifest. */
  case class ProjectInfo(
    name: String,                  // "nbody-fold-scala"
    version: String,               // "1.0.0" (handoff release)
    phase: Int,                    // 11 (this phase)
    gitSha: String,                // HEAD commit hash (empty if git unavailable)
    gitBranch: String,             // current branch name
    gitDirty: Boolean,             // true if working tree has uncommitted changes
    scalaVersion: String,          // from scala.util.Properties.versionString
    sbtVersion: String,            // read from project/build.properties
    jdkVersion: String,            // from java.version sys prop
    osName: String,                // from os.name sys prop
    osArch: String,                // from os.arch sys prop
    scalaFiles: Int,               // count of .scala files under src/main/scala
    totalLoc: Long,                // sum of LOC across all .scala files
    phaseCount: Int,               // number of completed phases (PhaseN_Demo.scala files)
    fileIndex: Vector[FileInfo],   // one FileInfo per .scala file, sorted by path
    sourceHashSha256: String       // SHA-256 of concatenation of all file SHA-256s (tamper seal)
  )

  // ── Public API ──────────────────────────────────────────────────────────

  /** Collect the full project manifest from `projectRoot`. */
  def collect(projectRoot: Path, phaseCount: Int): ProjectInfo =
    val scalaRoot = projectRoot.resolve("src/main/scala")
    val files = listScalaFiles(scalaRoot).sortBy(_.toString)
    val fileInfos = files.map(p => fileInfoOf(projectRoot, p))
    val sourceHash = sourceHashSeal(fileInfos)
    val (gitSha, gitBranch, gitDirty) = gitState(projectRoot)

    ProjectInfo(
      name            = "nbody-fold-scala",
      version         = "1.0.0",
      phase           = 11,
      gitSha          = gitSha,
      gitBranch       = gitBranch,
      gitDirty        = gitDirty,
      scalaVersion    = scala.util.Properties.versionString,
      sbtVersion      = readSbtVersion(projectRoot),
      jdkVersion      = sys.props.getOrElse("java.version", "?"),
      osName          = sys.props.getOrElse("os.name", "?"),
      osArch          = sys.props.getOrElse("os.arch", "?"),
      scalaFiles      = fileInfos.length,
      totalLoc        = fileInfos.map(_.loc).sum,
      phaseCount      = phaseCount,
      fileIndex       = fileInfos.toVector,
      sourceHashSha256 = sourceHash
    )

  /** Recompute the manifest's source-hash seal from its file index.
    * Used by ReleaseArtifact round-trip test to verify the seal is honest. */
  def computeSourceHashSeal(fileIndex: Vector[FileInfo]): String =
    sourceHashSeal(fileIndex)

  // ── Internals ───────────────────────────────────────────────────────────

  private def listScalaFiles(root: Path): Vector[Path] =
    if !Files.exists(root) then Vector.empty
    else
      Files.walk(root).toScala(Vector)
        .filter(Files.isRegularFile(_))
        .filter(_.toString.endsWith(".scala"))

  private def fileInfoOf(projectRoot: Path, p: Path): FileInfo =
    val bytes = Files.size(p)
    val contents = Files.readAllBytes(p)
    val sha = sha256Hex(contents)
    val relPath = projectRoot.relativize(p).iterator.asScala
                   .map(_.toString).mkString("/")
    val loc = Files.lines(p).count()
    FileInfo(relPath, bytes, sha, loc)

  private def sha256Hex(bytes: Array[Byte]): String =
    val md = MessageDigest.getInstance("SHA-256")
    val digest = md.digest(bytes)
    digest.map(b => f"${b & 0xff}%02x").mkString

  /** The "tamper seal": hash the concatenation of (path, sha256) pairs in
    * alphabetical order. Any tampering with file contents or path inventory
    * changes this seal. */
  private def sourceHashSeal(fileIndex: Vector[FileInfo]): String =
    val md = MessageDigest.getInstance("SHA-256")
    fileIndex.foreach { fi =>
      md.update(fi.path.getBytes("UTF-8"))
      md.update(0.toByte)
      md.update(fi.sha256.getBytes("UTF-8"))
      md.update(0.toByte)
    }
    md.digest().map(b => f"${b & 0xff}%02x").mkString

  private def readSbtVersion(projectRoot: Path): String =
    val propsFile = projectRoot.resolve("project/build.properties")
    if !Files.exists(propsFile) then "unknown"
    else
      val text = new String(Files.readAllBytes(propsFile), "UTF-8")
      text.linesIterator
        .map(_.trim)
        .find(_.startsWith("sbt.version"))
        .map(_.substring("sbt.version".length).stripPrefix("=").trim)
        .getOrElse("unknown")

  /** Returns (sha, branch, dirty). All empty/false if git is unavailable. */
  private def gitState(projectRoot: Path): (String, String, Boolean) =
    def runGit(args: String*): String =
      try
        val pb = new ProcessBuilder(("git" +: args)*)
          .directory(projectRoot.toFile)
          .redirectErrorStream(true)
        val proc = pb.start()
        val out = new String(proc.getInputStream.readAllBytes(), "UTF-8").trim
        proc.waitFor()
        out
      catch case _: Throwable => ""

    val sha = runGit("rev-parse", "HEAD")
    val branch = runGit("rev-parse", "--abbrev-ref", "HEAD")
    val status = runGit("status", "--porcelain")
    val dirty = status.nonEmpty
    (sha, branch, dirty)

end Manifest
