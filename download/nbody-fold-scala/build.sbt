// ============================================================================
// build.sbt — nbody-fold-scala
// ============================================================================
// Zero-dependency Scala 3 project. Only Scala 3 stdlib + JDK are available
// on the compile/runtime classpath. No Cats, no Spire, no Akka, no JMH.
//
// The framework's "Zero-Dependency Sovereignty" pillar is enforced here at
// the build level: even though sbt pulls transitive deps for *itself*, the
// compiled artifacts depend on nothing beyond Scala stdlib + JDK.
//
// IMPORTANT: we deliberately do NOT set `libraryDependencies := Nil`.
// sbt's default already provides `scala3-library_3` (the Scala 3 standard
// library). Setting `libraryDependencies := Nil` would clear that too and
// break compilation. "Zero-dependency" means "no EXTRA deps" — the stdlib
// is not a dependency, it is the language runtime.
// ============================================================================

ThisBuild / scalaVersion := "3.4.2"
ThisBuild / organization := "nbody"
ThisBuild / version      := "0.1.0"

ThisBuild / javacOptions ++= Seq("--release", "21")
ThisBuild / scalacOptions ++= Seq(
  "-deprecation",
  "-feature",
  "-unchecked"
  // Note: "-language:strictEquality" removed for now — would require deriving
  // CanEqual instances for every domain type. Will revisit in Phase 8 when we
  // add the verification suite and need principled equality.
)

// No libraryDependencies += ... entries — this is what "zero-dependency" means.
// If you ever add one, you are breaking the Zero-Dependency pillar —
// document the justification in skills.md before doing so.

lazy val root = (project in file("."))
  .settings(
    name := "nbody-fold-scala",
    Test / fork := true
  )
