// ============================================================================
// CsvParser.scala — Initial-condition CSV parser
// ============================================================================
// Phase 2 deliverable per skills.md §2 Phase 2.
//
// Parses CSV initial-condition files of the form:
//
//   # optional comment lines start with '#'
//   mass,x,y,z,vx,vy,vz
//   1000.0,0.0,0.0,0.0,0.0,0.0,0.0
//   1.0,10.0,0.0,0.0,0.0,10.0,0.0
//
// Each non-comment, non-blank line becomes one Body. The parser uses the
// Parser combinator primitives from Phase 2 — notably `spanP` for fields
// and `sepBy` for the 7-column structure (Alternative + sequenceA).
// ============================================================================

package nbody.Phase2_Parser

import Parser.{*, given}
import nbody.Phase1_Typeclasses.{*, given}
import nbody.Phase0_Domain.*

object CsvParser:

  // ── Field-level parsers ────────────────────────────────────────────────

  // Parse a single double-precision number (signed, decimal point optional,
  // scientific notation supported).
  // Examples: 1000.0, -1.5, 42, +3.14e-2, 1.23E+05, -6.7e-10
  //
  // Exponent support was a "stretch goal" in the original Phase 2 spec but
  // Phase 6's TrajectoryWriter uses %.15g format (which produces scientific
  // notation for very large/small magnitudes) so the parser MUST handle it
  // for round-trip correctness. The grammar is:
  //
  //   number  := [sign] whole [. frac] [exp]
  //   sign    := '+' | '-'
  //   whole   := digit+
  //   frac    := digit+
  //   exp     := ('e' | 'E') [sign] digit+
  //
  // We build the full numeric string with parser combinators, then hand off
  // to String.toDouble for the actual numeric parse (it handles all edge
  // cases of IEEE-754 parsing — overflow, underflow, denormals — for free).
  def doubleP: Parser[Double] =
    val sign    = (charP('-') <|> charP('+')).map {
      case '-' => -1.0
      case _   =>  1.0
    }
    val digits  = spanP(_.isDigit)
    val frac    = charP('.') *> spanP(_.isDigit)

    // Optional exponent: 'e' or 'E', optional sign, then mandatory digits
    val expSign: Parser[String] =
      (charP('-') <|> charP('+')).map(_.toString) <|> Parser.pure("")
    val expDigits: Parser[String] = notEmpty(digits)  // exponent must have digits
    val expPart: Parser[String] =
      ((charP('e') <|> charP('E')) *> expSign.map2(expDigits)(_ + _))
        .map(s => "e" + s)

    val number: Parser[Double] =
      val whole: Parser[String] = notEmpty(digits)
      // optional fractional part: ".123" or empty
      val fracOpt: Parser[String] = frac.map("." + _) <|> Parser.pure("")
      // optional exponent: "e-05" or empty
      val expOpt: Parser[String] = expPart <|> Parser.pure("")
      // Combine into a single string and parse to Double
      whole
        .map2(fracOpt)(_ + _)
        .map2(expOpt)(_ + _)
        .map(s => s.toDouble)  // may throw on malformed input — caller handles

    // Apply optional sign
    (sign.map2(number)(_ * _) <|> number)

  // Parse a single CSV field (double), consuming trailing comma if present.
  def fieldP: Parser[Double] = lexeme(doubleP)

  // Parse a 7-column body row: mass,x,y,z,vx,vy,vz
  // Uses sequenceA (the "Epic Move") to require EXACTLY 7 fields with
  // commas between. If fewer than 7 fields, the parse fails — which is
  // what we want for validation.
  def bodyRowP(id: Long): Parser[Body] =
    val comma = lexeme(charP(','))
    val commaField: Parser[Double] = comma *> fieldP
    val row: Parser[List[Double]] = Parser.sequenceA(List(
      fieldP, commaField, commaField, commaField,
      commaField, commaField, commaField
    ))
    row.map {
      case m :: x :: y :: z :: vx :: vy :: vz :: Nil =>
        Body(
          id   = id,
          mass = Mass(m),
          pos  = Vec3(x, y, z),
          vel  = Vec3(vx, vy, vz)
        )
      case other =>
        // Should never happen — sequenceA guarantees exactly 7 fields.
        throw new IllegalStateException(
          s"sequenceA returned ${other.size} fields, expected 7: $other"
        )
    }

  // ── File-level parser ──────────────────────────────────────────────────

  // Skip comment lines (#...) and blank lines
  def commentLineP: Parser[Unit] =
    (charP('#') *> spanP(_ != '\n') <* charP('\n')).map(_ => ())

  def blankLineP: Parser[Unit] =
    charP('\n').map(_ => ())

  // Parse an entire CSV document, returning the list of Bodies.
  // Auto-assigns body IDs starting from 1.
  def parseBodies(input: String): Either[String, Vector[Body]] =
    val lines = input.linesIterator.toVector.filter { line =>
      val t = line.trim
      t.nonEmpty && !t.startsWith("#")
    }
    if lines.isEmpty then Right(Vector.empty)
    else
      // Try to parse each line; collect errors
      val results = lines.zipWithIndex.map { (line, idx) =>
        Parser.run(ws *> bodyRowP(idx + 1L))(line) match
          case Some((rest, body)) if rest.trim.isEmpty => Right(body)
          case Some((rest, body)) => Left(s"line ${idx + 1}: trailing input: '$rest'")
          case None               => Left(s"line ${idx + 1}: parse failed")
      }
      val (errors, bodies) = results.partitionMap(identity)
      if errors.nonEmpty then Left(errors.mkString("\n"))
      else Right(bodies.toVector)
