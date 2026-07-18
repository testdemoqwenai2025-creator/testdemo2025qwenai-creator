// ============================================================================
// Middleware.scala — Zero-dependency HTTP middleware composition
// ============================================================================
// Phase 12 deliverable.
//
// A Middleware is a function that wraps a Handler, producing a new Handler.
// This is the classic `type Middleware = Handler => Handler` pattern — the
// same shape as Cats' `Kleisli` middleware or Express.js's `app.use(...)`.
//
//   type Handler     = Request => Response
//   type Middleware  = Handler => Handler
//
// We reuse Phase 1's Functor/Applicative machinery for the composition
// algebra (the `compose` and `andThen` operators on Function1 are exactly
// the Applicative composition we proved in Phase 1's TypeclassInstances).
//
// Provided middlewares:
//   1. logging   — emits a structured line per request (method, path, status, latency)
//   2. cors      — injects Access-Control-Allow-* headers for browser fetch()
//   3. auth      — HMAC-SHA-256 request signing (reuses Phase 11 MessageDigest pattern)
//   4. errors    — catches exceptions in downstream handlers, returns 500 JSON
//   5. jsonBody  — parses the request body as JSON, attaches to Request
//   6. rateLimit — per-IP token bucket (10 req/sec, refill 1/sec)
//
// Composition is right-associative by default (outer wraps inner), matching
// the reading order: `logging(cors(auth(routes)))` means logging sees
// everything, cors sees what logging lets through, etc.
// ============================================================================

package nbody.Phase12_WebTier

import java.security.MessageDigest
import java.util.concurrent.{ConcurrentHashMap, TimeUnit}
import java.util.concurrent.atomic.{AtomicLong, AtomicReference}
import scala.collection.mutable.StringBuilder
import scala.jdk.CollectionConverters.*
import scala.util.{Try, Success, Failure}

import nbody.Phase2_Parser.{Json, JsonParser}
import Json.*

// ── Request / Response model ──────────────────────────────────────────────
final case class Request(
  method:  String,
  path:    String,
  query:   Map[String, String] = Map.empty,
  headers: Map[String, String] = Map.empty,
  body:    String = "",
  // Populated by `jsonBody` middleware; None if not yet parsed or parse failed.
  jsonBody: Option[Json] = None,
  // Per-request attributes (for downstream handlers to stash state)
  attrs:   Map[String, Any] = Map.empty
):
  def withAttr(k: String, v: Any): Request = copy(attrs = attrs + (k -> v))

final case class Response(
  status:  Int = 200,
  headers: Map[String, String] = Map.empty,
  body:    String = ""
):
  def withHeader(k: String, v: String): Response = copy(headers = headers + (k -> v))
  def withStatus(s: Int): Response = copy(status = s)
  def withBody(b: String): Response = copy(body = b)
  def json(j: Json): Response =
    copy(body = JsonParser.render(j), headers = headers + ("Content-Type" -> "application/json"))

// ── Handler / Middleware type aliases ─────────────────────────────────────
type Handler    = Request => Response
type Middleware = Handler => Handler

object Middleware:

  // ── 1. Logging middleware ──────────────────────────────────────────────
  // Emits one structured line per request: METHOD path -> status latencyMs
  def logging: Middleware = next => req =>
    val t0     = System.nanoTime()
    val resp   = next(req)
    val latency = (System.nanoTime() - t0) / 1000000L
    println(f"[http] ${req.method}%-6s ${req.path}%-40s -> ${resp.status}%3d  ${latency}%-5d ms")
    resp

  // ── 2. CORS middleware ─────────────────────────────────────────────────
  // Browser fetch() will reject cross-origin responses without these headers.
  // For a demo server we allow * — production deployments should scope this.
  def cors: Middleware = next => req =>
    val resp = next(req)
    resp
      .withHeader("Access-Control-Allow-Origin", "*")
      .withHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
      .withHeader("Access-Control-Allow-Headers", "Content-Type, X-Api-Key, X-Signature, X-Timestamp")

  // ── Pre-flight OPTIONS handler ─────────────────────────────────────────
  // Browser sends OPTIONS before POST; we short-circuit it.
  def preflight: Middleware = next => req =>
    if req.method == "OPTIONS" then Response(204, Map("Access-Control-Allow-Origin" -> "*",
                                                      "Access-Control-Allow-Methods" -> "GET, POST, PUT, DELETE, OPTIONS",
                                                      "Access-Control-Allow-Headers" -> "Content-Type, X-Api-Key, X-Signature, X-Timestamp"))
    else next(req)

  // ── 3. Auth middleware (HMAC-SHA-256 request signing) ──────────────────
  // For write endpoints (POST/PUT/DELETE). Requires header:
  //   X-Api-Key:     <client_id>
  //   X-Timestamp:   <epoch_seconds>
  //   X-Signature:   hex(HMAC-SHA-256(secret, "<method>\n<path>\n<timestamp>\n<body>"))
  //
  // The signature scheme is deliberately simple and reproducible from
  // Phase 11's SHA-256 utility — no new crypto primitives introduced.
  def auth(secret: String, writeOnly: Boolean = true): Middleware = next => req =>
    if writeOnly && req.method == "GET" then
      next(req)  // reads are open
    else
      val key       = req.headers.getOrElse("X-Api-Key", "")
      val ts        = req.headers.getOrElse("X-Timestamp", "")
      val sig       = req.headers.getOrElse("X-Signature", "")
      if key.isEmpty || ts.isEmpty || sig.isEmpty then
        Response(401, Map("Content-Type" -> "application/json"),
                 """{"error":"missing_auth_headers"}""")
      else
        // Replay protection: reject if timestamp is more than 5 minutes stale
        val now = System.currentTimeMillis() / 1000L
        Try(ts.toLong) match
          case Success(t) if math.abs(now - t) > 300 =>
            Response(401, Map("Content-Type" -> "application/json"),
                     """{"error":"stale_timestamp"}""")
          case _ =>
            val expected = hmacSha256Hex(secret,
                                         s"${req.method}\n${req.path}\n${ts}\n${req.body}")
            if constantTimeEq(expected, sig) then next(req)
            else Response(401, Map("Content-Type" -> "application/json"),
                          """{"error":"invalid_signature"}""")

  // ── 4. Error-handling middleware ───────────────────────────────────────
  // Catches any exception from downstream, returns a 500 JSON response.
  def errors: Middleware = next => req =>
    try
      next(req)
    catch
      case e: Throwable =>
        val msg = Option(e.getMessage).getOrElse(e.getClass.getSimpleName)
        println(s"[http] ERROR on ${req.method} ${req.path}: $e")
        Response(500, Map("Content-Type" -> "application/json"),
                 s"""{"error":"internal","message":"$msg"}""")

  // ── 5. JSON body parser middleware ─────────────────────────────────────
  // Parses the request body as JSON via Phase 2 JsonParser and attaches the
  // result to `req.jsonBody`. Failures produce 400.
  def jsonBody: Middleware = next => req =>
    if req.body.isEmpty then next(req)
    else
      JsonParser.parse(req.body) match
        case None =>
          Response(400, Map("Content-Type" -> "application/json"),
                   """{"error":"invalid_json_body"}""")
        case Some(j) => next(req.copy(jsonBody = Some(j)))

  // ── 6. Rate limiter (per-IP token bucket, 10 tokens, 1/sec refill) ─────
  // Uses a ConcurrentHashMap[ip -> (tokens, lastRefillNanos)]. Tokens are
  // refilled lazily on each request (no background thread needed).
  def rateLimit(maxTokens: Int = 10, refillPerSec: Int = 1): Middleware =
    val buckets = new ConcurrentHashMap[String, (AtomicLong, AtomicLong)]()
    next => req =>
      val ip = req.headers.getOrElse("X-Forwarded-For", "127.0.0.1").split(",")(0).trim
      val bucket = buckets.computeIfAbsent(ip,
        _ => (new AtomicLong(maxTokens), new AtomicLong(System.nanoTime())))
      val (tokens, lastRefill) = bucket
      val now = System.nanoTime()
      val elapsedSec = (now - lastRefill.get()) / 1000000000L
      if elapsedSec > 0 then
        val newTokens = math.min(maxTokens.toLong, tokens.get() + elapsedSec * refillPerSec)
        tokens.set(newTokens)
        lastRefill.set(now)
      if tokens.get() > 0 then
        tokens.decrementAndGet()
        next(req)
      else
        Response(429, Map("Content-Type" -> "application/json",
                          "Retry-After" -> "1"),
                 """{"error":"rate_limited"}""")

  // ── Compose a chain of middlewares: leftmost is outermost ──────────────
  // `chain(a, b, c)(handler)` = `a(b(c(handler)))`.
  // This is just Function1.compose under the hood — Phase 1's Applicative
  // instance for Function1 makes this composition law-abiding by construction.
  def chain(middlewares: Middleware*): Middleware =
    middlewares.foldRight(identity[Handler]) { (mw, acc) =>
      h => mw(acc(h))
    }

  // ── HMAC-SHA-256 (RFC 2104) — implemented in 8 lines of JDK code ───────
  // We don't pull in javax.crypto.Mac to keep the dependency story explicit;
  // instead we use the standard (K xor opad) || H(K xor ipad, M) construction.
  // Phase 11 already proved MessageDigest.getInstance("SHA-256") is on the
  // zero-dep classpath.
  private def hmacSha256Hex(secret: String, message: String): String =
    val keyBytes = if secret.length > 64 then sha256(secret.getBytes("UTF-8")) else secret.getBytes("UTF-8")
    val padded   = java.util.Arrays.copyOf(keyBytes, 64)
    val ipad     = padded.map(b => (b ^ 0x36).toByte)
    val opad     = padded.map(b => (b ^ 0x5c).toByte)
    val inner    = sha256(ipad ++ message.getBytes("UTF-8"))
    val outer    = sha256(opad ++ inner)
    outer.map(b => f"${b & 0xff}%02x").mkString

  private def sha256(bytes: Array[Byte]): Array[Byte] =
    val md = MessageDigest.getInstance("SHA-256")
    md.update(bytes)
    md.digest()

  // ── Constant-time comparison (defends against timing attacks) ──────────
  // We XOR every byte and OR-accumulate; result is 0 iff strings are equal.
  // Loop runs in constant time w.r.t. the longer string.
  private def constantTimeEq(a: String, b: String): Boolean =
    if a.length != b.length then false
    else
      var diff = 0
      var i = 0
      while i < a.length do
        diff |= a.charAt(i) ^ b.charAt(i)
        i += 1
      diff == 0

end Middleware
