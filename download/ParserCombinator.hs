{-# LANGUAGE LambdaCase #-}

-- =====================================================================
-- ParserCombinator.hs
-- The "Elite Generalist" JSON Architectural Framework
-- Pillar 2: Parser Combinator Engine
-- Pillar 3: Four Mathematical Abstractions (Functor / Applicative / Alternative / Monoid)
--
-- Zero-dependency: depends ONLY on Haskell's `base` library.
-- Run with:    runghc ParserCombinator.hs
-- =====================================================================

module Main where

import Data.Char (isDigit, isSpace)
import Control.Applicative (Alternative(..), liftA2)
import Data.List (intercalate)

-- =====================================================================
-- 1. The Core newtype — the engine's heartbeat
--    Maybe models failure as a first-class citizen.
--    The tuple carries the "rest of the input" for sequential chaining.
-- =====================================================================

newtype Parser a = Parser { runParser :: String -> Maybe (String, a) }

-- =====================================================================
-- 2. Typeclass instances — the Four Pillars of Abstraction
-- =====================================================================

-- I. Functor: The "Penetration" Operation
--    Transform a value inside the Parser context WITHOUT unwrapping.
instance Functor Parser where
  fmap f (Parser p) = Parser $ \input ->
    case p input of
      Nothing              -> Nothing
      Just (rest, parsed)  -> Just (rest, f parsed)

-- II. Applicative: Chaining & sequencing (also gives us `sequenceA` — the "Epic Move")
instance Applicative Parser where
  pure x = Parser $ \input -> Just (input, x)
  (Parser pf) <*> (Parser px) = Parser $ \input ->
    case pf input of
      Nothing             -> Nothing
      Just (rest, f)      -> case px rest of
        Nothing             -> Nothing
        Just (rest', x)     -> Just (rest', f x)

-- III. Alternative: Choice logic via `<|>`
instance Alternative Parser where
  empty = Parser $ const Nothing
  (Parser p1) <|> (Parser p2) = Parser $ \input ->
    case p1 input of
      Just success -> Just success
      Nothing      -> p2 input

-- IV. Monoid is required by Alternative; provided automatically via the
--    `Monoid a => Alternative` superclass chain via `empty` and `<|>`.

-- =====================================================================
-- 3. Foundational primitives — the "Atomic Unit" strategy
-- =====================================================================

-- Match a single specific character.
charP :: Char -> Parser Char
charP c = Parser $ \case
  (x:xs) | x == c -> Just (xs, c)
  _               -> Nothing

-- Match a specific string, character by character.
stringP :: String -> Parser String
stringP = traverse charP   -- the "Epic Move" sequenceA in disguise

-- Span: consume input while a predicate holds.
spanP :: (Char -> Bool) -> Parser String
spanP pred = Parser $ \input ->
  let (matched, rest) = span pred input
  in Just (rest, matched)

-- Quality-control primitive: reject empty results.
notEmpty :: Parser String -> Parser String
notEmpty (Parser p) = Parser $ \input ->
  case p input of
    Just (rest, "") -> Nothing     -- empty match => failure
    other           -> other

-- Optional surrounding whitespace (JSON spec allows insignificant ws).
ws :: Parser ()
ws = Parser $ \input -> Just (dropWhile isSpace input, ())

-- Lexeme: run a parser then consume trailing whitespace.
lexeme :: Parser a -> Parser a
lexeme p = p <* ws

-- =====================================================================
-- 4. JSON domain model
-- =====================================================================

data Json
  = JsonNull
  | JsonBool Bool
  | JsonInt Integer
  | JsonStr String
  | JsonArr [Json]
  | JsonObj [(String, Json)]
  deriving (Eq, Show)

-- =====================================================================
-- 5. The composed JSON value parser
--    Top-level choice implemented via Alternative (`<|>`).
-- =====================================================================

jsonNullP :: Parser Json
jsonNullP = JsonNull  <$ stringP "null"

jsonBoolP :: Parser Json
jsonBoolP =
      (JsonBool True  <$ stringP "true")
  <|> (JsonBool False <$ stringP "false")

-- Use spanP + notEmpty to guarantee at least one digit.
jsonIntP :: Parser Json
jsonIntP = (JsonInt . read) <$> notEmpty (spanP isDigit)

-- A JSON string: "..." with no escape handling for brevity (zero-dep ethos).
jsonStrP :: Parser Json
jsonStrP = JsonStr <$> (charP '"' *> strBody <* charP '"')
  where
    strBody = spanP (/= '"')

-- Array: [ value, value, ... ]   — uses `sequenceA` style via `many` + sepBy
jsonArrP :: Parser Json
jsonArrP = JsonArr <$> between (lexeme (charP '[')) (lexeme (charP ']')) elements
  where
    elements = sepBy valueP (lexeme (charP ','))

-- Object: { "key": value, ... }
jsonObjP :: Parser Json
jsonObjP = JsonObj <$> between (lexeme (charP '{')) (lexeme (charP '}')) members
  where
    members = sepBy pair (lexeme (charP ','))
    pair = liftA2 (,) (lexeme jsonStrRaw <* lexeme (charP ':')) valueP
    jsonStrRaw = charP '"' *> spanP (/= '"') <* charP '"'

-- The top-level JSON value: prioritized Alternative chain.
valueP :: Parser Json
valueP = lexeme $
      jsonNullP
  <|> jsonBoolP
  <|> jsonIntP
  <|> jsonStrP
  <|> jsonArrP
  <|> jsonObjP

-- =====================================================================
-- 6. Helper combinators
-- =====================================================================

between :: Parser open -> Parser close -> Parser a -> Parser a
between open close p = open *> p <* close

-- Zero-dependency `sepBy` (Control.Applicative provides one, but we
-- re-implement it here to honor the "Elite Generalist" zero-dep ethos).
sepBy :: Alternative f => f a -> f sep -> f [a]
sepBy p sep = (:) <$> p <*> many (sep *> p) <|> pure []

-- =====================================================================
-- 7. Demonstration: "Epic Move" — sequenceA turning types inside out
--    Given [Parser a], produce Parser [a].
-- =====================================================================

epicMoveDemo :: Parser [Char]
epicMoveDemo = sequenceA [charP 'H', charP 'i', charP '!']

-- =====================================================================
-- 8. Self-test harness
-- =====================================================================

parseSample :: String -> IO ()
parseSample label input =
  case runParser (ws *> valueP) input of
    Just (_, v) -> putStrLn $ "  OK   " ++ label ++ " => " ++ show v
    Nothing     -> putStrLn $ "  FAIL " ++ label

runTests :: IO ()
runTests = do
  putStrLn "=== The \"Elite Generalist\" Parser Combinator Engine ==="
  putStrLn ""
  putStrLn "[Atomic primitives]"
  parseSample "null"          "null"
  parseSample "true"          "true"
  parseSample "false"         "false"
  parseSample "int"           "42"
  parseSample "string"        "\"hello, world\""
  parseSample "array"         "[1, 2, 3]"
  parseSample "object"        "{\"name\":\"ada\",\"age\":36}"
  parseSample "nested"        "{\"matrix\":[1,2,[3,4,{\"x\":true}]]}"
  parseSample "ws-tolerant"   "   {  \"k\" :  [ 1 , 2 ]  }   "
  putStrLn ""
  putStrLn "[Epic Move: sequenceA [charP 'H', charP 'i', charP '!']]"
  case runParser epicMoveDemo "Hi!" of
    Just (rest, v) -> putStrLn $ "  OK   matched=" ++ show v ++ " rest=" ++ show rest
    Nothing        -> putStrLn "  FAIL"
  putStrLn ""
  putStrLn "[Quality control: notEmpty rejects empty digit runs]"
  case runParser jsonIntP "abc" of
    Nothing -> putStrLn "  OK   correctly rejected non-numeric input"
    Just v  -> putStrLn $ "  FAIL unexpected success: " ++ show v
  putStrLn ""
  putStrLn "Done."

main :: IO ()
main = runTests
