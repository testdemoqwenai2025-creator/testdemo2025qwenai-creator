// ============================================================================
// ReleaseArtifact.scala — JSON release artifact for Phase 11 handoff
// ============================================================================
// Phase 11 deliverable: serialize the project manifest (Manifest.ProjectInfo)
// to a JSON release artifact using the Phase 2 JsonParser AST. The artifact
// is the canonical "this is what we shipped" record — pinned in git, hashed
// externally, and parsable by any downstream supply-chain tool.
//
// Round-trip property:  parse ∘ render = identity
//   i.e. for any p: ProjectInfo,  parse(render(p)) == Some(p)
//
// This is the "Epic Move" pattern (Pillar 3 — Applicative's sequenceA)
// extended to project release metadata: the same parser combinators that
// parse initial-condition files (Phase 2) are reused to parse our own
// release artifact. No new parser code, no third-party JSON library.
// ============================================================================

package nbody.Phase11_Handoff

import nbody.Phase2_Parser.{Json, JsonParser}
import Manifest.*

object ReleaseArtifact:

  // ── Serialization: ProjectInfo → Json ───────────────────────────────────

  def toJson(p: ProjectInfo): Json =
    Json.JObj(List(
      "name"             -> Json.JStr(p.name),
      "version"          -> Json.JStr(p.version),
      "phase"            -> Json.JInt(p.phase.toLong),
      "git_sha"          -> Json.JStr(p.gitSha),
      "git_branch"       -> Json.JStr(p.gitBranch),
      "git_dirty"        -> Json.JBool(p.gitDirty),
      "scala_version"    -> Json.JStr(p.scalaVersion),
      "sbt_version"      -> Json.JStr(p.sbtVersion),
      "jdk_version"      -> Json.JStr(p.jdkVersion),
      "os_name"          -> Json.JStr(p.osName),
      "os_arch"          -> Json.JStr(p.osArch),
      "scala_files"      -> Json.JInt(p.scalaFiles.toLong),
      "total_loc"        -> Json.JInt(p.totalLoc),
      "phase_count"      -> Json.JInt(p.phaseCount.toLong),
      "source_hash"      -> Json.JStr(p.sourceHashSha256),
      "files"            -> Json.JArr(p.fileIndex.map(fileInfoToJson).toList)
    ))

  private def fileInfoToJson(fi: FileInfo): Json =
    Json.JObj(List(
      "path"   -> Json.JStr(fi.path),
      "bytes"  -> Json.JInt(fi.bytes),
      "sha256" -> Json.JStr(fi.sha256),
      "loc"    -> Json.JInt(fi.loc)
    ))

  // ── Render to JSON string (uses Phase 2 JsonParser.render) ──────────────

  def render(p: ProjectInfo): String =
    JsonParser.render(toJson(p))

  // ── Parse JSON string → Option[ProjectInfo] ─────────────────────────────
  // Round-trip: parse ∘ render = identity.

  def parse(s: String): Option[ProjectInfo] =
    JsonParser.parse(s).flatMap(fromJson)

  def fromJson(j: Json): Option[ProjectInfo] =
    j match
      case Json.JObj(members) =>
        // Look up helper — Phase 2 Json.JObj stores members as List[(String, Json)]
        def field(name: String): Option[Json] =
          members.find(_._1 == name).map(_._2)

        for
          name      <- field("name").collect     { case Json.JStr(s)  => s }
          version   <- field("version").collect  { case Json.JStr(s)  => s }
          phase     <- field("phase").collect    { case Json.JInt(n)  => n.toInt }
          gitSha    <- field("git_sha").collect   { case Json.JStr(s)  => s }
          gitBranch <- field("git_branch").collect{ case Json.JStr(s)  => s }
          gitDirty  <- field("git_dirty").collect { case Json.JBool(b) => b }
          scalaVer  <- field("scala_version").collect { case Json.JStr(s) => s }
          sbtVer    <- field("sbt_version").collect  { case Json.JStr(s) => s }
          jdkVer    <- field("jdk_version").collect  { case Json.JStr(s) => s }
          osName    <- field("os_name").collect      { case Json.JStr(s) => s }
          osArch    <- field("os_arch").collect      { case Json.JStr(s) => s }
          files     <- field("scala_files").collect  { case Json.JInt(n) => n.toInt }
          loc       <- field("total_loc").collect    { case Json.JInt(n) => n }
          phaseCnt  <- field("phase_count").collect  { case Json.JInt(n) => n.toInt }
          srcHash   <- field("source_hash").collect  { case Json.JStr(s) => s }
          filesArr  <- field("files").collect        { case Json.JArr(items) => items }
        yield
          val fileIndex = filesArr.map(parseFileInfo).collect { case Some(fi) => fi }
          ProjectInfo(
            name, version, phase,
            gitSha, gitBranch, gitDirty,
            scalaVer, sbtVer, jdkVer,
            osName, osArch,
            files, loc, phaseCnt,
            fileIndex.toVector,
            srcHash
          )
      case _ => None

  private def parseFileInfo(j: Json): Option[FileInfo] =
    j match
      case Json.JObj(members) =>
        def field(name: String): Option[Json] =
          members.find(_._1 == name).map(_._2)
        for
          path   <- field("path").collect   { case Json.JStr(s) => s }
          bytes  <- field("bytes").collect  { case Json.JInt(n) => n }
          sha    <- field("sha256").collect { case Json.JStr(s) => s }
          loc    <- field("loc").collect    { case Json.JInt(n) => n }
        yield FileInfo(path, bytes, sha, loc)
      case _ => None

  // ── Round-trip self-verification ────────────────────────────────────────
  // Used by Phase11Demo as a self-check.

  def roundTrip(p: ProjectInfo): Boolean =
    parse(render(p)).contains(p)

end ReleaseArtifact
