// ============================================================================
// Tangle.scala — extract Scala code blocks from a literate Markdown source
// ============================================================================
// Phase 8 deliverable per skills.md §2 Phase 8.
//
// The literate programming workflow (Pillar 4) has two directions:
//
//   Tangle:  .lit.md  →  .scala source files   (this file)
//   Weave:   .lit.md  →  .html documentation   (Weave.scala)
//
// Tangle scans a Markdown document for fenced code blocks tagged ```scala
// whose FIRST line is a `// file: <path>` annotation. Each such block is
// extracted (minus the annotation line) and written to the specified path,
// relative to a configurable output root.
//
// Code blocks WITHOUT the `// file:` annotation are "display-only" — they
// appear in the woven HTML but are NOT extracted as source. This lets the
// literate document contain illustrative snippets alongside the real code.
//
// Usage:
//   sbt "runMain nbody.Phase8_Literate.Tangle <lit.md> <output-root>"
//
//   <lit.md>       path to the literate Markdown source (e.g., nbody.lit.md)
//   <output-root>  directory to write extracted .scala files into
//                  (e.g., src/main/scala — the // file: paths are relative
//                   to this root)
//
// Returns: the list of files written (printed to stdout for verification).
// ============================================================================

package nbody.Phase8_Literate

import java.nio.file.{Files, Path, Paths}
import scala.util.matching.Regex

object Tangle:

  /** Regex matching a fenced scala code block with an optional file annotation.
    *
    * Group 1: the file path (if the `// file:` annotation is present)
    * Group 2: the code content (everything between the fences, excluding the
    *          annotation line if present)
    *
    * The regex handles:
    *   - ```scala or ```scala\n as the opening fence
    *   - ``` as the closing fence
    *   - Optional whitespace around the fence markers
    *   - The `// file:` annotation as the first line of the block
    *   - Blocks without the annotation (group 1 will be empty → skipped)
    */
  private val codeBlockRegex: Regex =
    """(?s)```scala\s*\n//\s*file:\s*(?<file>\S+)\n(?<body>.*?)```""".r

  /** Extract all tagged code blocks from a literate Markdown source.
    *
    * @param litMdPath path to the .lit.md file
    * @param outputRoot directory to write extracted files into (created if
    *        it doesn't exist). The `// file:` paths in the document are
    *        resolved relative to this root.
    * @return Vector of paths that were written, in document order.
    *         Throws if the document can't be read or a path is invalid.
    */
  def tangle(litMdPath: Path, outputRoot: Path): Vector[Path] =
    val content = Files.readString(litMdPath)
    val written = scala.collection.mutable.ArrayBuffer.empty[Path]

    // Find all tagged blocks
    for m <- codeBlockRegex.findAllMatchIn(content) do
      val relPath = m.group("file").trim
      val body = m.group("body")
      val outPath = outputRoot.resolve(relPath)
      Files.createDirectories(outPath.getParent)
      // Write the body, stripping a trailing newline if present (the regex
      // captures up to but not including the closing ```, so there's usually
      // a \n right before it that we want to keep for clean file endings)
      val cleaned = body.stripSuffix("\n") + "\n"
      Files.writeString(outPath, cleaned)
      written += outPath

    written.toVector

  /** Dry run: report what WOULD be extracted without writing any files.
    * Used by the demo for verification. Returns Vector of (relPath, lineCount).
    */
  def dryRun(litMdPath: Path): Vector[(String, Int)] =
    val content = Files.readString(litMdPath)
    codeBlockRegex.findAllMatchIn(content).map { m =>
      val relPath = m.group("file").trim
      val body = m.group("body")
      (relPath, body.linesIterator.length)
    }.toVector

  /** CLI entrypoint.
    *   arg0: path to .lit.md
    *   arg1: output root directory (default: current dir)
    */
  def main(args: Array[String]): Unit =
    if args.length < 1 then
      println("Usage: Tangle <lit.md> [output-root]")
      sys.exit(1)
    val litMd = Paths.get(args(0))
    val outRoot = if args.length >= 2 then Paths.get(args(1)) else Paths.get(".")
    println(s"Tangling $litMd → $outRoot")
    val written = tangle(litMd, outRoot)
    println(s"Extracted ${written.size} file(s):")
    written.foreach { p => println(s"  $p") }
