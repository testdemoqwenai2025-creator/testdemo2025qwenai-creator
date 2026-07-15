// ============================================================================
// ParserSpec.scala — Phase 2 parser combinator tests (zero-dependency)
// ============================================================================

package nbody.Phase2_Parser

import Parser.*              // charP, stringP, spanP, notEmpty, etc.
import JsonParser.*          // Json enum + valueP + parse + render
import nbody.Phase0_Domain.Vec3  // for CSV assertions
// Givens (Functor/Applicative/Alternative[Parser]) are at package level — already in scope

object ParserSpec:

  def check(name: String)(cond: Boolean): Unit =
    if cond then println(s"  [PASS] $name")
    else
      println(s"  [FAIL] $name")
      sys.error(s"Test failed: $name")

  def runParse[A](p: Parser[A], input: String): Option[(String, A)] =
    Parser.run(p)(input)

  def runAll(): Unit =
    println("=== Phase 2 Parser Combinator Tests ===")

    // ── Atomic primitives ─────────────────────────────────────────────────
    check("charP('a') matches 'a'")(
      runParse(charP('a'), "abc") == Some(("bc", 'a'))
    )
    check("charP('a') fails on 'b'")(
      runParse(charP('a'), "bcd") == None
    )
    check("stringP(\"hi\") matches \"hi!\"")(
      runParse(stringP("hi"), "hi!") == Some(("!", "hi"))
    )
    check("spanP(_.isDigit) consumes digits")(
      runParse(spanP(_.isDigit), "42abc") == Some(("abc", "42"))
    )
    check("notEmpty rejects empty match")(
      runParse(notEmpty(spanP(_.isDigit)), "abc") == None
    )

    // ── Alternative choice ────────────────────────────────────────────────
    val trueOrFalse: Parser[Json] =
      stringP("true").map(_ => Json.JBool(true)) <|>
      stringP("false").map(_ => Json.JBool(false))
    check("<|> tries left first")(
      runParse(trueOrFalse, "true") == Some(("", Json.JBool(true)))
    )
    check("<|> falls back to right")(
      runParse(trueOrFalse, "false") == Some(("", Json.JBool(false)))
    )
    check("<|> fails when both fail")(
      runParse(trueOrFalse, "maybe") == None
    )

    // ── The "Epic Move" — sequenceA ──────────────────────────────────────
    val epic: Parser[List[Char]] = Parser.sequenceA(List(
      charP('H'), charP('i'), charP('!')
    ))
    check("sequenceA([H, i, !]) matches \"Hi!\"")(
      runParse(epic, "Hi!") == Some(("", List('H', 'i', '!')))
    )
    check("sequenceA fails on partial match")(
      runParse(epic, "Ho!") == None
    )

    // ── JSON value parsing ───────────────────────────────────────────────
    check("JSON: null")(
      JsonParser.parse("null") == Some(Json.JNull)
    )
    check("JSON: true")(
      JsonParser.parse("true") == Some(Json.JBool(true))
    )
    check("JSON: false")(
      JsonParser.parse("false") == Some(Json.JBool(false))
    )
    check("JSON: integer 42")(
      JsonParser.parse("42") == Some(Json.JInt(42L))
    )
    check("JSON: string")(
      JsonParser.parse("\"hello\"") == Some(Json.JStr("hello"))
    )
    check("JSON: array [1, 2, 3]")(
      JsonParser.parse("[1, 2, 3]") == Some(Json.JArr(List(Json.JInt(1), Json.JInt(2), Json.JInt(3))))
    )
    check("JSON: object {\"x\": 42}")(
      JsonParser.parse("{\"x\": 42}") == Some(Json.JObj(List(("x", Json.JInt(42L)))))
    )
    check("JSON: nested array+object")(
      JsonParser.parse("{\"a\":[1,2]}") == Some(Json.JObj(List(
        ("a", Json.JArr(List(Json.JInt(1), Json.JInt(2))))
      )))
    )
    check("JSON: whitespace tolerant")(
      JsonParser.parse("   {  \"k\" :  [ 1 , 2 ]  }   ") ==
        Some(Json.JObj(List(("k", Json.JArr(List(Json.JInt(1), Json.JInt(2)))))))
    )

    // ── Quality control: notEmpty on integer parser ──────────────────────
    check("JSON int parser rejects non-numeric input")(
      JsonParser.parse("abc") == None
    )

    // ── CSV initial-condition parsing ────────────────────────────────────
    val csv =
      """# Comment line
        |1000.0,0.0,0.0,0.0,0.0,0.0,0.0
        |1.0,10.0,0.0,0.0,0.0,10.0,0.0
        |""".stripMargin
    CsvParser.parseBodies(csv) match
      case Right(bodies) =>
        check("CSV: parses 2 bodies")(bodies.size == 2)
        check("CSV: body 1 mass = 1000.0")(math.abs(bodies(0).mass.value - 1000.0) < 1e-12)
        check("CSV: body 2 mass = 1.0")(math.abs(bodies(1).mass.value - 1.0) < 1e-12)
        check("CSV: body 2 pos = (10, 0, 0)")(bodies(1).pos == Vec3(10.0, 0.0, 0.0))
        check("CSV: body 2 vel = (0, 10, 0)")(bodies(1).vel == Vec3(0.0, 10.0, 0.0))
        check("CSV: auto-assigned ids 1, 2")(
          bodies.map(_.id) == Vector(1L, 2L)
        )
      case Left(err) =>
        check(s"CSV: parse failed — $err")(false)

    // ── CSV error handling ───────────────────────────────────────────────
    val badCsv = "1.0,2.0,3.0\n"  // only 3 fields, need 7
    CsvParser.parseBodies(badCsv) match
      case Right(_)  => check("CSV: rejects malformed row (expected error)")(false)
      case Left(err) => check(s"CSV: rejects malformed row — $err")(true)

    println("All Phase 2 tests passed.")

object ParserSpecRunner:
  def main(args: Array[String]): Unit = ParserSpec.runAll()
