// ============================================================================
// Parser.scala — Phase 2 Parser Combinator Engine (Scala port)
// ============================================================================
// Phase 2 deliverable per skills.md §2 Phase 2.
//
// Direct Scala port of ParserCombinator.hs from the parent framework repo.
// Implements Pillar 2 (Parser Combinator Engine) using the typeclasses
// defined in Phase 1 (Functor, Applicative, Alternative).
//
// Core signature (Pillar 2):
//   newtype Parser a = Parser { runParser :: String -> Maybe (String, a) }
//
// In Scala:
//   opaque type Parser[A] = String => Option[(String, A)]
//
// `Option` models failure as a first-class citizen (Pillar 2).
// The tuple carries the "rest of the input" for sequential chaining.
// ============================================================================

package nbody.Phase2_Parser

import nbody.Phase1_Typeclasses.*
import nbody.Phase1_Typeclasses.Applicative.{sequenceA}  // re-exported below

// ── Core Parser type ──────────────────────────────────────────────────────
opaque type Parser[A] = String => Option[(String, A)]

object Parser:
  // Smart constructor + deconstructor
  def apply[A](f: String => Option[(String, A)]): Parser[A] = f
  def run[A](p: Parser[A])(input: String): Option[(String, A)] = p(input)

  // ── Convenience constructors (mirror Applicative/Alternative interface) ─
  // These let us write `Parser.pure(x)` and `Parser.empty[A]` without
  // summoning the typeclass instance at every call site.
  def pure[A](a: A): Parser[A] = Parser { input => Some((input, a)) }
  def empty[A]: Parser[A] = Parser { _ => None }

  // ── Foundational primitives (Pillar 2 "Atomic Unit" strategy) ──────────

  // charP — match a single specific character
  def charP(c: Char): Parser[Char] = Parser { input =>
    if input.nonEmpty && input.head == c then
      Some((input.tail, c))
    else
      None
  }

  // stringP — match a specific string, char by char.
  // The "Epic Move" sequenceA in disguise: traverse charP over the string.
  def stringP(s: String): Parser[String] =
    sequenceA(s.toList.map(charP)).map(_.mkString)

  // spanP — consume input while a predicate holds
  def spanP(pred: Char => Boolean): Parser[String] = Parser { input =>
    val (matched, rest) = input.span(pred)
    Some((rest, matched))
  }

  // notEmpty — quality-control primitive (Pillar 2):
  // reject successful empty results (e.g. number parser on no digits)
  def notEmpty(p: Parser[String]): Parser[String] = Parser { input =>
    p(input) match
      case Some((rest, "")) => None
      case other            => other
  }

  // ── Lexeme / whitespace helpers ────────────────────────────────────────
  val ws: Parser[Unit] = Parser { input =>
    Some((input.dropWhile(_.isWhitespace), ()))
  }

  // lexeme — run a parser then consume trailing whitespace
  def lexeme[A](p: Parser[A]): Parser[A] = p <* ws

  // between — run open, then p, then close; return p's result
  def between[A, O, C](open: Parser[O], close: Parser[C], p: Parser[A]): Parser[A] =
    open *> p <* close

  // sepBy — zero or more p's separated by sep
  def sepBy[A, B](p: Parser[A], sep: Parser[B]): Parser[List[A]] =
    sepBy1(p, sep) <|> summon[Applicative[Parser]].pure(Nil)

  // sepBy1 — one or more p's separated by sep
  // p.map2((sep *> p).many)(_ :: _)
  def sepBy1[A, B](p: Parser[A], sep: Parser[B]): Parser[List[A]] =
    p.map2((sep *> p).many)(_ :: _)

  // ── The "Epic Move" — sequenceA ────────────────────────────────────────
  // sequenceA([p1, p2, p3]) : Parser[List[A]]
  // Turns "list of parsers" into "parser of a list" (Pillar 3 §II)
  def sequenceA[A](ps: List[Parser[A]]): Parser[List[A]] =
    nbody.Phase1_Typeclasses.Applicative.sequenceA(ps)(using summon[Applicative[Parser]])

// ── Combined Functor + Applicative + Alternative instance for Parser ──────
// In Scala 3, a `given Alternative[Parser]` block must implement ALL abstract
// methods from the trait hierarchy (Functor.map + Applicative.pure/ap +
// Alternative.empty/<|>). The subtype relationship means this single given
// also serves as `summon[Functor[Parser]]` and `summon[Applicative[Parser]]`.
given Alternative[Parser] with
  // ── Applicative.pure ──────────────────────────────────────────────────
  def pure[A](a: A): Parser[A] = Parser { input => Some((input, a)) }

  // ── Applicative.ap ( Functor.map is derived from this) ────────────────
  extension [A](pa: Parser[A])
    def ap[B](pf: Parser[A => B]): Parser[B] = Parser { input =>
      pf(input).flatMap { case (r1, f) =>
        pa(r1).map { case (r2, a) => (r2, f(a)) }
      }
    }

  // ── Alternative.empty ─────────────────────────────────────────────────
  def empty[A]: Parser[A] = Parser { _ => None }

  // ── Alternative.<|> — choice logic (Pillar 3 §III) ────────────────────
  extension [A](p1: Parser[A])
    def <|>(p2: => Parser[A]): Parser[A] = Parser { input =>
      p1(input).orElse(p2(input))
    }

  // ── Override many/some to avoid infinite mutual recursion ─────────────
  // The default `many = some <|> pure(Nil)` and `some = p.map2(p.many)(…)`
  // loop forever in Scala's strict evaluation (they recurse during Parser
  // CONSTRUCTION, not just during execution). We push the recursion inside
  // the Parser lambda so it only unfolds when the parser is actually run.
  extension [A](p: Parser[A])
    override def many: Parser[List[A]] = Parser { input =>
      // Try `some` first; if it fails, return Nil without consuming input
      p.some(input).orElse(Some((input, Nil)))
    }
    override def some: Parser[List[A]] = Parser { input =>
      // Parse one p, then recursively parse many more
      p(input).flatMap { case (r1, a) =>
        p.many(r1).map { case (r2, as) => (r2, a :: as) }
      }
    }
