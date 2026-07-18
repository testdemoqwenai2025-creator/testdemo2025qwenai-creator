// ============================================================================
// JsonParser.scala — JSON value parser composed from Parser primitives
// ============================================================================
// Phase 2 deliverable per skills.md §2 Phase 2.
//
// A JSON value is one of:
//   null | true | false | number | string | array | object
//
// The top-level value parser is a prioritized Alternative chain (Pillar 3 §III):
//
//   valueP = nullP <|> boolP <|> intP <|> strP <|> arrP <|> objP
//
// Array parsing uses `sequenceA` (the "Epic Move") to turn a List[Parser[Json]]
// into Parser[List[Json]] — exactly as in the Haskell original.
// ============================================================================

package nbody.Phase2_Parser

import Parser.{*, given}
import nbody.Phase1_Typeclasses.{*, given}

// ── JSON AST ──────────────────────────────────────────────────────────────
enum Json:
  case JNull
  case JBool(b: Boolean)
  case JInt(n: Long)
  case JNum(d: Double)   // Phase 12 addition: standard JSON float support
  case JStr(s: String)
  case JArr(items: List[Json])
  case JObj(members: List[(String, Json)])

// ── Composed JSON value parser ────────────────────────────────────────────
object JsonParser:

  // null parser
  def nullP: Parser[Json] =
    stringP("null").map(_ => Json.JNull)

  // bool parser (Alternative <|> for choice)
  def boolP: Parser[Json] =
    stringP("true").map(_ => Json.JBool(true))  <|>
    stringP("false").map(_ => Json.JBool(false))

  // int parser — uses spanP + notEmpty quality control (Pillar 2)
  def intP: Parser[Json] =
    notEmpty(spanP(_.isDigit)).map(s => Json.JInt(s.toLong))

  // ── number parser (Phase 12 addition) ──────────────────────────────────
  // Standard JSON numbers: -?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?
  // We implement a deliberately lenient variant: spanP accepts any run of
  // [0-9.\-+eE], then we pattern-match to decide JInt vs JNum.
  //
  // This is justified because Phase 12's web tier is the first use case
  // that consumes standard JSON from arbitrary HTTP clients (browser fetch,
  // curl, etc.) — Phase 0-11 only ever parsed our own numerics-as-strings
  // convention. Without float support, the parser fails on inputs like
  // `{"dt":0.01}`, blocking the web tier entirely.
  def numberP: Parser[Json] =
    notEmpty(spanP(c => c.isDigit || c == '.' || c == 'e' || c == 'E' || c == '+' || c == '-'))
      .map { s =>
        if s.contains('.') || s.contains('e') || s.contains('E') then
          Json.JNum(s.toDouble)
        else
          Json.JInt(s.toLong)
      }

  // string parser — "..." with no escape handling (zero-dep ethos)
  def strP: Parser[Json] =
    (charP('"') *> spanP(_ != '"') <* charP('"')).map(s => Json.JStr(s))

  // ── Array parser — exercises sequenceA (the "Epic Move") ───────────────
  // [ value, value, value ]
  // sepBy already uses the Alternative's many internally, which is itself
  // built from `some` (sequenceA-style: p.map2(p.many)(_ :: _)).
  def arrP: Parser[Json] =
    between(
      lexeme(charP('[')),
      lexeme(charP(']')),
      sepBy(valueP, lexeme(charP(',')))
    ).map(items => Json.JArr(items))

  // ── Object parser — uses sequenceA on (key, value) pairs ───────────────
  // { "key": value, "key": value }
  def pairP: Parser[(String, Json)] =
    // Parse "key" : value with optional whitespace around the colon.
    // map2 combines key (String) + value (Json) into a tuple, discarding
    // the ':' in between via `*>`.
    val keyP: Parser[String] = charP('"') *> spanP(_ != '"') <* charP('"')
    lexeme(keyP).map2(lexeme(charP(':')) *> valueP)((s, v) => (s, v))

  def objP: Parser[Json] =
    between(
      lexeme(charP('{')),
      lexeme(charP('}')),
      sepBy(pairP, lexeme(charP(',')))
    ).map(members => Json.JObj(members))

  // ── Top-level JSON value parser: prioritized Alternative chain ─────────
  def valueP: Parser[Json] = lexeme:
    nullP   <|>
    boolP   <|>
    numberP <|>   // Phase 12: replaces intP; handles both int and float
    strP    <|>
    arrP    <|>
    objP

  // ── Convenience: parse a complete JSON document ────────────────────────
  def parse(input: String): Option[Json] =
    Parser.run(ws *> valueP)(input).map(_._2)

  // Pretty-printer for diagnostics
  def render(j: Json): String = j match
    case Json.JNull       => "null"
    case Json.JBool(b)    => b.toString
    case Json.JInt(n)     => n.toString
    case Json.JNum(d)     => d.toString
    case Json.JStr(s)     => "\"" + s + "\""
    case Json.JArr(items) => "[" + items.map(render).mkString(", ") + "]"
    case Json.JObj(m)     =>
      "{" + m.map { case (k, v) => s"\"$k\": ${render(v)}" }.mkString(", ") + "}"
