// ============================================================================
// Phase8Demo.scala — Verification suite + literate workflow demonstration
// ============================================================================
// Phase 8 verification per skills.md §2 Phase 8:
//
//   1. Tangle: extract verification test code from nbody.lit.md
//   2. Compile check: the extracted code must compile (implicit — if it
//      didn't, this demo wouldn't run)
//   3. Verification suite: run all 5 physics tests
//      - EnergyConservationTest     (drift < 1e-6 over 1000 steps)
//      - MomentumConservationTest   (drift < 1e-12, machine precision)
//      - AngularMomentumTest        (drift < 1e-12, machine precision)
//      - KeplerTwoBodyTest          (eccentricity preserved to 1e-6 over 10 orbits)
//      - PlummerSphereTest          (virial ratio 2K/|U| ≈ 1.0 within 10%)
//   4. Weave: render nbody.lit.md to HTML, verify it contains the expected
//      content (code blocks, headings, syntax highlighting spans)
//   5. Round-trip: verify Tangle's output matches the hand-written sources
//
// Run with:  sbt "runMain nbody.Phase8Demo"
// ============================================================================

package nbody

import java.nio.file.{Files, Path, Paths}
import nbody.Phase0_Domain.*
import nbody.Phase5_NBody.{Simulator, Physics}
import nbody.Phase8_Literate.{Tangle, Weave}
import nbody.Phase8_Verify.*

object Phase8Demo:

  private var passed = 0
  private var failed = 0
  private def check(label: String, cond: Boolean, detail: String = ""): Unit =
    if cond then
      passed += 1
      println(s"  [PASS] $label")
    else
      failed += 1
      println(s"  [FAIL] $label  $detail")

  def main(args: Array[String]): Unit =

    println("=== Phase 8: Verification & Literate Workflow Demo ===")
    println()

    // ── 0. Tangle: extract code from nbody.lit.md ────────────────────────
    println("--- 0. Tangle: extract code from nbody.lit.md ---")
    val projectRoot = Paths.get("/home/z/my-project/download/nbody-fold-scala")
    val litMd = projectRoot.resolve("nbody.lit.md")
    check("nbody.lit.md exists",
      Files.exists(litMd), s"$litMd not found")

    // Dry run first: see what would be extracted
    val dryRun = Tangle.dryRun(litMd)
    println(s"  Dry run: ${dryRun.size} tagged code blocks found:")
    dryRun.foreach { (path, lines) =>
      println(f"    $path%-55s ($lines%4d lines)")
    }
    check("nbody.lit.md contains 5 verification test code blocks",
      dryRun.size == 5, s"got ${dryRun.size}")

    // Actually tangle to a temp directory (we don't overwrite the real sources)
    val tangleOut = Files.createTempDirectory("phase8-tangle-")
    println(s"  Tangling to temp dir: $tangleOut")
    val written = Tangle.tangle(litMd, tangleOut)
    println(s"  Extracted ${written.size} files:")
    written.foreach { p =>
      val rel = tangleOut.relativize(p)
      val size = Files.size(p)
      println(s"    $rel ($size bytes)")
    }
    check("Tangle wrote 5 files", written.size == 5, s"got ${written.size}")

    // Verify each extracted file is non-empty and starts with the right package
    val allNonEmpty = written.forall { p =>
      Files.size(p) > 0 &&
      Files.readString(p).startsWith("//") ||  // comment or package
      Files.readString(p).startsWith("package")
    }
    check("all extracted files are non-empty and well-formed",
      allNonEmpty, "some files are empty or malformed")

    // Verify the extracted content matches the expected test files
    val expectedFiles = Set(
      "Phase8_Verify/EnergyConservationTest.scala",
      "Phase8_Verify/MomentumConservationTest.scala",
      "Phase8_Verify/AngularMomentumTest.scala",
      "Phase8_Verify/KeplerTwoBodyTest.scala",
      "Phase8_Verify/PlummerSphereTest.scala"
    )
    val extractedRels = written.map(p => tangleOut.relativize(p).toString).toSet
    check("extracted file set matches expected verification tests",
      extractedRels == expectedFiles,
      s"got $extractedRels")
    println()

    // ── 1. Verification suite: 5 physics tests ──────────────────────────
    println("--- 1. Verification suite (5 physics tests) ---")
    println()

    // 1a. Energy conservation
    println("  1a. Energy Conservation Test (drift < 1e-6 over 1000 steps)")
    val (energyPass, energyDetail) = EnergyConservationTest.run()
    check("energy drift < 1e-6 over 1000 steps", energyPass, energyDetail)
    println(s"      $energyDetail")
    println()

    // 1b. Momentum conservation
    println("  1b. Momentum Conservation Test (drift < 1e-12, machine precision)")
    val (momPass, momDetail) = MomentumConservationTest.run()
    check("momentum drift < 1e-12 (machine precision)", momPass, momDetail)
    println(s"      $momDetail")
    println()

    // 1c. Angular momentum
    println("  1c. Angular Momentum Test (drift < 1e-12, machine precision)")
    val (angPass, angDetail) = AngularMomentumTest.run()
    check("angular momentum drift < 1e-12 (machine precision)", angPass, angDetail)
    println(s"      $angDetail")
    println()

    // 1d. Kepler two-body (10 orbits)
    println("  1d. Kepler Two-Body Test (eccentricity preserved to 1e-6 over 10 orbits)")
    val (kepPass, kepDetail) = KeplerTwoBodyTest.run()
    check("eccentricity drift < 1e-6 over 10 orbits", kepPass, kepDetail)
    println(s"      $kepDetail")
    println()

    // 1e. Plummer sphere virial ratio
    println("  1e. Plummer Sphere Test (virial ratio 2K/|U| ≈ 1.0 within ±0.1)")
    val (plumPass, plumDetail) = PlummerSphereTest.run()
    check("virial ratio 2K/|U| ∈ [0.9, 1.1] for N=500 Plummer sphere", plumPass, plumDetail)
    println(s"      $plumDetail")
    println()

    // ── 2. Weave: render nbody.lit.md to HTML ───────────────────────────
    println("--- 2. Weave: render nbody.lit.md to HTML ---")
    val htmlOut = Files.createTempFile("phase8-nbody-", ".html")
    val codeBlockCount = Weave.weave(litMd, htmlOut)
    val htmlSize = Files.size(htmlOut)
    val htmlContent = Files.readString(htmlOut)
    println(s"  Rendered to $htmlOut ($htmlSize bytes, $codeBlockCount code blocks)")
    check("Weave produced non-empty HTML",
      htmlSize > 1000, f"got $htmlSize bytes")
    check("Weave HTML contains all 5 code blocks",
      codeBlockCount == 5, s"got $codeBlockCount")
    // Verify HTML structure
    check("HTML has <html> tag", htmlContent.contains("<html"))
    check("HTML has <head> tag", htmlContent.contains("<head>"))
    check("HTML has <body> tag", htmlContent.contains("<body>"))
    check("HTML has <pre><code> blocks for syntax highlighting",
      htmlContent.contains("<pre><code"))
    // Verify content: the heading should be present
    check("HTML contains the document title heading",
      htmlContent.contains("N-Body Simulation") || htmlContent.contains("Verification"))
    // Verify syntax highlighting spans are present
    check("HTML contains syntax highlighting spans (.kw class)",
      htmlContent.contains("class=\"kw\""))
    check("HTML contains comment highlighting spans (.cmt class)",
      htmlContent.contains("class=\"cmt\""))
    check("HTML contains string highlighting spans (.str class)",
      htmlContent.contains("class=\"str\""))
    // Verify a known Scala keyword was highlighted
    check("HTML highlights 'def' keyword",
      htmlContent.contains("<span class=\"kw\">def</span>") ||
      htmlContent.contains("<span class=\"kw\">object</span>"))
    // Verify the // file: annotations are NOT in the HTML output (they're
    // part of the code blocks but should be rendered as comments, not
    // stripped — actually they ARE comments so they'll be in <span class="cmt">)
    check("HTML includes the // file: annotations as comments",
      htmlContent.contains("file:"))
    println()

    // ── 3. Tangle round-trip: extracted code matches hand-written tests ─
    println("--- 3. Tangle round-trip (extracted code compiles & runs) ---")
    // The fact that the 5 tests ran successfully in section 1 proves the
    // hand-written sources (in Phase8_Verify/) compile and run. Here we
    // verify that the TANGLE output matches those sources — i.e., the
    // literate document is the true source of truth.
    val realVerifyDir = projectRoot.resolve("src/main/scala/nbody/Phase8_Verify")
    val testFiles = List(
      "EnergyConservationTest.scala",
      "MomentumConservationTest.scala",
      "AngularMomentumTest.scala",
      "KeplerTwoBodyTest.scala",
      "PlummerSphereTest.scala"
    )
    testFiles.foreach { name =>
      val realFile = realVerifyDir.resolve(name)
      val tangledFile = tangleOut.resolve(s"Phase8_Verify/$name")
      if Files.exists(realFile) && Files.exists(tangledFile) then
        val realContent = Files.readString(realFile)
        val tangledContent = Files.readString(tangledFile)
        // The tangled content should match the real source (both start with
        // the same package declaration and have the same body)
        val matchOk = realContent.trim == tangledContent.trim
        check(s"tangled $name matches hand-written source",
          matchOk,
          if !matchOk then "contents differ (see diff)" else "")
      else
        check(s"both $name files exist for comparison", false,
          s"real=${Files.exists(realFile)}, tangled=${Files.exists(tangledFile)}")
    }
    println()

    // ── 4. Cleanup ──────────────────────────────────────────────────────
    println("--- 4. Cleanup ---")
    // Clean up temp files (the HTML is useful — keep it in download/ for the user)
    val finalHtml = projectRoot.resolve("nbody.html")
    Files.copy(htmlOut, finalHtml, java.nio.file.StandardCopyOption.REPLACE_EXISTING)
    println(s"  Copied rendered HTML to: $finalHtml")
    // Delete temp tangle dir
    written.foreach { p => Files.deleteIfExists(p) }
    Files.deleteIfExists(tangleOut.resolve("Phase8_Verify"))
    Files.deleteIfExists(tangleOut)
    Files.deleteIfExists(htmlOut)
    println("  Temp files cleaned up.")
    println()

    // ── Final summary ────────────────────────────────────────────────────
    println("=== Phase 8 self-checks summary ===")
    println(s"  Passed: $passed")
    println(s"  Failed: $failed")
    if failed == 0 then
      println()
      println("Phase 8 Verification & Literate Workflow verified.")
      println("All 5 conservation-law tests pass; Tangle + Weave produce correct output.")
      println("Ready for Phase 9 (Benchmarking & Scientific Report).")
    else
      println()
      println(s"⚠ $failed self-check(s) failed — fix before proceeding.")
      sys.exit(1)
