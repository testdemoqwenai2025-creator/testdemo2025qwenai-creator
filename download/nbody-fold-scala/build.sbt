// ============================================================================
// build.sbt — nbody-fold-scala
// ============================================================================
// Zero-dependency Scala 3 project. Only Scala 3 stdlib + JDK are available
// on the compile/runtime classpath. No Cats, no Spire, no Akka, no JMH.
//
// The framework's "Zero-Dependency Sovereignty" pillar is enforced here at
// the build level: even though sbt pulls transitive deps for *itself*, the
// compiled artifacts depend on nothing beyond Scala stdlib + JDK.
// ============================================================================

ThisBuild / scalaVersion := "3.4.2"
ThisBuild / organization := "nbody"
ThisBuild / version      := "0.1.0"

ThisBuild / javacOptions ++= Seq("--release", "21")
ThisBuild / scalacOptions ++= Seq(
  "-deprecation",
  "-feature",
  "-unchecked",
  "-language:strictEquality",
  "-Xfatal-warnings"
)

// Explicitly: no libraryDependencies.
// If you ever add one, you are breaking the Zero-Dependency pillar —
// document the justification in skills.md before doing so.

lazy val root = (project in file("."))
  .settings(
    name := "nbody-fold-scala",
    libraryDependencies := Nil,
    Test / fork := true
  )
