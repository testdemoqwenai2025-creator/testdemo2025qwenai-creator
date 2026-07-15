// ============================================================================
// Phase2Demo.scala — Demonstrates Pillar 2 parser combinator + Phase 1 typeclasses
// ============================================================================
// Shows:
//   1. Atomic primitives: charP, stringP, spanP, notEmpty
//   2. The "Epic Move" sequenceA on Parser
//   3. The Alternative <|> choice logic
//   4. JSON value parsing (null, bool, int, string, array, object)
//   5. CSV initial-condition parsing
//
// Run with:  sbt "runMain nbody.Phase2Demo"
// ============================================================================

package nbody

import nbody.Phase0_Domain.*
import nbody.Phase1_Typeclasses.{*, given}
import nbody.Phase2_Parser.{*, given}
import nbody.Phase2_Parser.Parser.*
import nbody.Phase2_Parser.JsonParser.*

object Phase2Demo:

  def main(args: Array[String]): Unit =

    println("=== Phase 2: Parser Combinator Demo ===")
    println()

    // ── 1. Atomic primitives ─────────────────────────────────────────────
    println("--- 1. Atomic primitives ---")
    def run[A](p: Parser[A], input: String): String =
      Parser.run(p)(input) match
        case Some((rest, v)) => s"Some((${rest.mkString}, $v))"
        case None            => "None"
    println(s"  charP('a')(\"abc\")   = ${run(Parser.charP('a'), "abc")}")
    println(s"  stringP(\"hi\")(\"hi!\") = ${run(Parser.stringP("hi"), "hi!")}")
    println(s"  spanP(_.isDigit)(\"42abc\") = ${run(Parser.spanP(_.isDigit), "42abc")}")
    println(s"  notEmpty(spanP(_.isDigit))(\"abc\") = ${run(Parser.notEmpty(Parser.spanP(_.isDigit)), "abc")}")
    println()

    // ── 2. The "Epic Move" — sequenceA on Parser ────────────────────────
    println("--- 2. The \"Epic Move\" — sequenceA on Parser ---")
    // sequenceA([charP('H'), charP('i'), charP('!')]) : Parser[List[Char]]
    val epic: Parser[List[Char]] = Parser.sequenceA(List(
      Parser.charP('H'), Parser.charP('i'), Parser.charP('!')
    ))
    println(s"  sequenceA([charP('H'), charP('i'), charP('!')])(\"Hi!\") = ${run(epic, "Hi!")}")
    println(s"  same parser on \"Ho!\" = ${run(epic, "Ho!")}   (fails on 2nd char)")
    println()

    // ── 3. Alternative <|> choice logic ─────────────────────────────────
    println("--- 3. Alternative <|> choice logic ---")
    val trueOrFalse: Parser[Json] =
      Parser.stringP("true").map(_ => Json.JBool(true)) <|>
      Parser.stringP("false").map(_ => Json.JBool(false))
    println(s"  (true|false)(\"true\")  = ${run(trueOrFalse, "true")}")
    println(s"  (true|false)(\"false\") = ${run(trueOrFalse, "false")}")
    println(s"  (true|false)(\"maybe\") = ${run(trueOrFalse, "maybe")}   (fails)")
    println()

    // ── 4. JSON value parsing ────────────────────────────────────────────
    println("--- 4. JSON value parsing ---")
    def parseJson(s: String): String =
      JsonParser.parse(s) match
        case Some(j) => s"OK: ${JsonParser.render(j)}"
        case None    => "FAIL"
    println(s"  \"null\"                → ${parseJson("null")}")
    println(s"  \"true\"                → ${parseJson("true")}")
    println(s"  \"42\"                  → ${parseJson("42")}")
    println(s"  \"\\\"hello\\\"\"             → ${parseJson("\"hello\"")}")
    println(s"  \"[1, 2, 3]\"           → ${parseJson("[1, 2, 3]")}")
    println(s"  \"{\\\"x\\\": 42}\"           → ${parseJson("{\"x\": 42}")}")
    println(s"  nested               → ${parseJson("{\"matrix\":[1,2,[3,4,{\"x\":true}]]}")}")
    println(s"  ws-tolerant          → ${parseJson("   {  \"k\" :  [ 1 , 2 ]  }   ")}")
    println()

    // ── 5. CSV initial-condition parsing ────────────────────────────────
    println("--- 5. CSV initial-condition parsing ---")
    val csv =
      """# Two-body Kepler test in CoM frame
        |1000.0,0.0,0.0,0.0,0.0,0.0,0.0
        |1.0,10.0,0.0,0.0,0.0,10.0,0.0
        |""".stripMargin
    println("  Input CSV:")
    csv.linesIterator.foreach { line => println(s"    $line") }
    println()
    CsvParser.parseBodies(csv) match
      case Right(bodies) =>
        println(s"  Parsed ${bodies.size} bodies:")
        bodies.foreach { b => println(s"    $b") }
      case Left(err) =>
        println(s"  ERROR: $err")
    println()

    println("Phase 2 parser combinator verified. Ready for Phase 3 (RLE engine).")
