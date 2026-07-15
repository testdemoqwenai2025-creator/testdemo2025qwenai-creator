// ============================================================================
// Weave.scala — render a literate Markdown source to HTML
// ============================================================================
// Phase 8 deliverable per skills.md §2 Phase 8.
//
// The inverse direction of Tangle: instead of extracting code, Weave renders
// the ENTIRE literate document (prose + code) as a standalone HTML page with
// syntax highlighting for Scala code blocks.
//
// This is a minimal-but-correct Markdown renderer. It handles:
//   - Headings: # → <h1>, ## → <h2>, ### → <h3>
//   - Paragraphs: blank-line-separated text → <p>...</p>
//   - Code blocks: ```lang ... ``` → <pre><code class="lang">...</code></pre>
//   - Inline code: `code` → <code>code</code>
//   - Bold: **text** → <strong>text</strong>
//   - Italic: *text* → <em>text</em>
//   - Block quotes: > text → <blockquote>text</blockquote>
//   - Unordered lists: - item → <ul><li>item</li></ul>
//   - Horizontal rules: --- → <hr/>
//
// Syntax highlighting for Scala:
//   - Keywords (def, val, var, if, else, match, case, class, object, trait,
//     extends, with, import, package, for, while, do, yield, return, new,
//     this, super, null, true, false, try, catch, finally, throw, type,
//     given, using, enum, opaque, inline, sealed, abstract, final, implicit,
//     lazy, override, private, protected, public)
//   - String literals (double-quoted, triple-quoted)
//   - Line comments (//) and block comments (/* */)
//   - Numbers
//
// The highlighting is applied INSIDE <pre><code> blocks (Scala code) and is
// skipped for inline code (too fragile for a regex-based highlighter).
//
// Usage:
//   sbt "runMain nbody.Phase8_Literate.Weave <lit.md> <output.html>"
// ============================================================================

package nbody.Phase8_Literate

import java.nio.file.{Files, Path, Paths}

object Weave:

  /** Scala keywords for syntax highlighting. */
  private val keywords = Set(
    "def", "val", "var", "if", "else", "match", "case", "class", "object",
    "trait", "extends", "with", "import", "package", "for", "while", "do",
    "yield", "return", "new", "this", "super", "null", "true", "false",
    "try", "catch", "finally", "throw", "type", "given", "using", "enum",
    "opaque", "inline", "sealed", "abstract", "final", "implicit", "lazy",
    "override", "private", "protected", "public", "if", "then", "is", "as",
    "end", "derives"
  )

  /** HTML-escape a string (&, <, >, ", '). */
  private def escapeHtml(s: String): String =
    s.replace("&", "&amp;")
     .replace("<", "&lt;")
     .replace(">", "&gt;")
     .replace("\"", "&quot;")
     .replace("'", "&#39;")

  /** Apply Scala syntax highlighting to a code string, returning HTML.
    *
    * The approach: tokenize the input into a sequence of (type, text) pairs
    * using regex, then wrap each token in an appropriate <span> based on its
    * type. This is NOT a full Scala parser — it's a "good enough" highlighter
    * for documentation purposes.
    *
    * Token types:
    *   - comment   (// ... or /* ... */)
    *   - string    ("..." or """...""")
    *   - keyword   (def, val, if, ...)
    *   - number    (123, 1.5, 1e-3)
    *   - ident     (everything else that looks like an identifier)
    *   - other     (punctuation, whitespace, operators)
    */
  private def highlightScala(code: String): String =
    val sb = new StringBuilder
    var i = 0
    val n = code.length
    while i < n do
      // Line comment: // ... \n
      if i + 1 < n && code(i) == '/' && code(i + 1) == '/' then
        val end = code.indexOf('\n', i) match
          case -1 => n
          case e => e
        sb.append(s"""<span class="cmt">${escapeHtml(code.substring(i, end))}</span>""")
        i = end
      // Block comment: /* ... */
      else if i + 1 < n && code(i) == '/' && code(i + 1) == '*' then
        val end = code.indexOf("*/", i + 2) match
          case -1 => n
          case e => e + 2
        sb.append(s"""<span class="cmt">${escapeHtml(code.substring(i, end))}</span>""")
        i = end
      // Triple-quoted string
      else if i + 2 < n && code.substring(i, i + 3) == "\"\"\"" then
        val end = code.indexOf("\"\"\"", i + 3) match
          case -1 => n
          case e => e + 3
        sb.append(s"""<span class="str">${escapeHtml(code.substring(i, end))}</span>""")
        i = end
      // Double-quoted string
      else if code(i) == '"' then
        var j = i + 1
        while j < n && code(j) != '"' do
          if code(j) == '\\' && j + 1 < n then j += 1  // skip escaped char
          j += 1
        j = math.min(j + 1, n)
        sb.append(s"""<span class="str">${escapeHtml(code.substring(i, j))}</span>""")
        i = j
      // Number: digit sequence with optional . and exponent
      else if code(i).isDigit then
        var j = i
        while j < n && (code(j).isDigit || code(j) == '.' || code(j) == 'e' || code(j) == 'E' || code(j) == '+' || code(j) == '-') do
          // Stop if we hit a letter that's not part of a number (e.g., 1e5 is ok, 5x is not)
          if (code(j) == 'e' || code(j) == 'E') && j + 1 < n && code(j + 1) != '+' && code(j + 1) != '-' && !code(j + 1).isDigit then j += 1; else ()
          if j < n && code(j).isLetter && code(j) != 'e' && code(j) != 'E' then j = n  // bail
          j += 1
        sb.append(s"""<span class="num">${escapeHtml(code.substring(i, j))}</span>""")
        i = j
      // Identifier or keyword: [A-Za-z_][A-Za-z0-9_]*
      else if code(i).isLetter || code(i) == '_' then
        var j = i
        while j < n && (code(j).isLetterOrDigit || code(j) == '_' || code(j) == '$') do j += 1
        val word = code.substring(i, j)
        if keywords.contains(word) then
          sb.append(s"""<span class="kw">$word</span>""")
        else
          sb.append(escapeHtml(word))
        i = j
      // Everything else: escape and emit
      else
        sb.append(escapeHtml(code.substring(i, i + 1)))
        i += 1
    sb.toString

  /** Render the literate Markdown source to a standalone HTML document.
    *
    * @param litMdPath path to the .lit.md file
    * @param outputPath path to write the .html file
    * @return the number of code blocks rendered (for verification)
    */
  def weave(litMdPath: Path, outputPath: Path): Int =
    val content = Files.readString(litMdPath)
    val html = render(content)
    Files.createDirectories(outputPath.getParent)
    Files.writeString(outputPath, html)
    // Count code blocks for the return value
    "```scala".r.findAllMatchIn(content).length

  /** Render Markdown content to a complete HTML document string. */
  private def render(markdown: String): String =
    val sb = new StringBuilder
    sb.append(htmlHead)
    sb.append("<body>\n")
    sb.append("<article>\n")

    val lines = markdown.linesIterator.toVector
    var i = 0
    while i < lines.length do
      val line = lines(i)
      // Code block: ```lang ... ```
      if line.trim.startsWith("```") then
        val lang = line.trim.stripPrefix("```").trim
        val codeLines = scala.collection.mutable.ArrayBuffer.empty[String]
        i += 1
        while i < lines.length && !lines(i).trim.startsWith("```") do
          codeLines += lines(i)
          i += 1
        val code = codeLines.mkString("\n")
        val highlighted =
          if lang == "scala" || lang.isEmpty then highlightScala(code)
          else escapeHtml(code)
        sb.append(s"""<pre><code class="lang-$lang">$highlighted</code></pre>\n""")
        i += 1  // skip closing ```
      // Heading
      else if line.startsWith("# ") then
        sb.append(s"<h1>${renderInline(line.substring(2))}</h1>\n")
        i += 1
      else if line.startsWith("## ") then
        sb.append(s"<h2>${renderInline(line.substring(3))}</h2>\n")
        i += 1
      else if line.startsWith("### ") then
        sb.append(s"<h3>${renderInline(line.substring(4))}</h3>\n")
        i += 1
      else if line.startsWith("#### ") then
        sb.append(s"<h4>${renderInline(line.substring(5))}</h4>\n")
        i += 1
      // Horizontal rule
      else if line.trim == "---" || line.trim == "***" then
        sb.append("<hr/>\n")
        i += 1
      // Block quote
      else if line.startsWith("> ") then
        val quoteLines = scala.collection.mutable.ArrayBuffer.empty[String]
        while i < lines.length && lines(i).startsWith("> ") do
          quoteLines += lines(i).substring(2)
          i += 1
        sb.append(s"<blockquote>${renderInline(quoteLines.mkString(" "))}</blockquote>\n")
      // Unordered list
      else if line.startsWith("- ") || line.startsWith("* ") then
        sb.append("<ul>\n")
        while i < lines.length && (lines(i).startsWith("- ") || lines(i).startsWith("* ")) do
          sb.append(s"  <li>${renderInline(lines(i).substring(2))}</li>\n")
          i += 1
        sb.append("</ul>\n")
      // Blank line: paragraph separator
      else if line.trim.isEmpty then
        i += 1
      // Paragraph: collect consecutive non-blank, non-special lines
      else
        val paraLines = scala.collection.mutable.ArrayBuffer.empty[String]
        while i < lines.length &&
              lines(i).trim.nonEmpty &&
              !lines(i).startsWith("#") &&
              !lines(i).startsWith("```") &&
              !lines(i).startsWith("- ") &&
              !lines(i).startsWith("* ") &&
              !lines(i).startsWith("> ") &&
              lines(i).trim != "---" do
          paraLines += lines(i)
          i += 1
        if paraLines.nonEmpty then
          sb.append(s"<p>${renderInline(paraLines.mkString(" "))}</p>\n")
    sb.append("</article>\n")
    sb.append("</body>\n</html>\n")
    sb.toString

  /** Render inline Markdown (bold, italic, inline code) to HTML. */
  private def renderInline(s: String): String =
    var result = escapeHtml(s)
    // Inline code: `code`
    result = result.replaceAll("`([^`]+)`", "<code>$1</code>")
    // Bold: **text**
    result = result.replaceAll("\\*\\*(.+?)\\*\\*", "<strong>$1</strong>")
    // Italic: *text* (but not ** which is bold)
    result = result.replaceAll("(?<!\\*)\\*(?!\\*)(.+?)(?<!\\*)\\*(?!\\*)", "<em>$1</em>")
    result

  /** HTML head with embedded CSS for syntax highlighting and layout. */
  private def htmlHead: String =
    """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>N-Body Simulation — Verification & Literate Source</title>
<style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    max-width: 900px;
    margin: 2em auto;
    padding: 0 1em;
    line-height: 1.6;
    color: #1a1a1a;
    background: #fafafa;
  }
  article { background: white; padding: 2em 3em; border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  h1 { border-bottom: 2px solid #333; padding-bottom: 0.3em; }
  h2 { border-bottom: 1px solid #ccc; padding-bottom: 0.2em; margin-top: 1.5em; }
  h3 { color: #444; margin-top: 1.2em; }
  pre {
    background: #1e1e1e;
    color: #d4d4d4;
    padding: 1em 1.5em;
    border-radius: 4px;
    overflow-x: auto;
    font-family: "SF Mono", Monaco, "Cascadia Code", Consolas, monospace;
    font-size: 0.9em;
    line-height: 1.5;
  }
  code { font-family: "SF Mono", Monaco, "Cascadia Code", Consolas, monospace; }
  p > code, li > code { background: #f0f0f0; padding: 0.1em 0.3em; border-radius: 3px; font-size: 0.9em; }
  blockquote { border-left: 3px solid #ccc; margin: 1em 0; padding: 0.5em 1em; color: #555; background: #f9f9f9; }
  hr { border: none; border-top: 1px solid #ccc; margin: 2em 0; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td { border: 1px solid #ddd; padding: 0.5em 0.8em; text-align: left; }
  th { background: #f0f0f0; }
  /* Scala syntax highlighting */
  .kw  { color: #569cd6; font-weight: bold; }
  .str { color: #ce9178; }
  .cmt { color: #6a9955; font-style: italic; }
  .num { color: #b5cea8; }
</style>
</head>
"""
