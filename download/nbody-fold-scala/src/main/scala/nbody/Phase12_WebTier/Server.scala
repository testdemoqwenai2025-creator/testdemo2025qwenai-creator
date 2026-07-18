// ============================================================================
// Server.scala — com.sun.net.httpserver.HttpServer wrapper
// ============================================================================
// Phase 12 deliverable.
//
// The Server ties together the Database, the Routes, and the Middleware
// chain. It uses ONLY the JDK's built-in HTTP server (no Netty, no Akka,
// no http4s) — Pillar 1 preserved.
//
// The HttpServer API is callback-based: each context (`/api/...`) is bound
// to an HttpHandler that receives a `HttpExchange`. We adapt this to our
// functional `Handler` type by translating HttpExchange ↔ Request/Response
// in a single `route` function.
//
// All contexts share a single `dispatch` handler — middleware is applied
// once during server setup, not per-context. This matches the Express.js
// "middleware at the app level" pattern.
// ============================================================================

package nbody.Phase12_WebTier

import java.io.{OutputStream, InputStream}
import java.net.{InetSocketAddress, URI}
import java.nio.charset.StandardCharsets
import java.util.concurrent.Executors
import scala.jdk.CollectionConverters.*
import com.sun.net.httpserver.{HttpServer => JdkHttpServer, HttpExchange, HttpHandler}

import Middleware.*

final class Server(port: Int, dbRoot: java.nio.file.Path, authSecret: String):

  private val db         = new Database(dbRoot)
  private val startedAt  = System.currentTimeMillis()
  private val routes     = new Routes(db, startedAt)
  private var server:    Option[JdkHttpServer] = None

  // ── Start: open DB, build middleware chain, bind contexts, start ────────
  def start(): Unit =
    db.open()
    val middlewareChain = Middleware.chain(
      errors,                                 // outermost: catches everything
      preflight,                              // CORS preflight short-circuit
      cors,                                   // inject CORS headers
      logging,                                // log every request
      rateLimit(maxTokens = 50, refillPerSec = 10),  // gentle per-IP cap
      jsonBody,                               // parse JSON body for POST
      // Note: auth middleware is NOT applied globally — only write endpoints
      // need auth in this demo. A production deployment would scope it.
    )
    val composed = middlewareChain(routes.dispatch)

    val s = JdkHttpServer.create(new InetSocketAddress(port), 0)
    s.createContext("/", exchange => handleExchange(exchange, composed))
    s.setExecutor(Executors.newFixedThreadPool(8))
    s.start()
    server = Some(s)
    println(s"[Server] listening on http://localhost:$port  (DB: $dbRoot)")

  // ── Stop: graceful shutdown ────────────────────────────────────────────
  def stop(): Unit =
    server.foreach { s => s.stop(2) }   // 2-second graceful drain
    db.close()
    println("[Server] stopped")

  // ── Translate HttpExchange ↔ our Request/Response model ────────────────
  private def handleExchange(ex: HttpExchange, handler: Handler): Unit =
    val method  = ex.getRequestMethod
    val uri     = ex.getRequestURI
    val path    = uri.getPath
    val query   = parseQuery(uri.getQuery)
    val headers = ex.getRequestHeaders.asScala
                     .flatMap { (k, v) => v.asScala.headOption.map(k -> _) }
                     .toMap
    val body    = readAll(ex.getRequestBody)

    val req  = Request(method, path, query, headers, body)
    val resp = handler(req)

    // Write response
    val respHeaders = ex.getResponseHeaders()
    respHeaders.add("Content-Type", resp.headers.getOrElse("Content-Type", "application/json"))
    resp.headers.foreach { (k, v) => if k != "Content-Type" then respHeaders.add(k, v) }
    val bytes = resp.body.getBytes(StandardCharsets.UTF_8)
    ex.sendResponseHeaders(resp.status, bytes.length.toLong)
    val os = ex.getResponseBody
    try os.write(bytes) finally os.close()

  private def parseQuery(q: String): Map[String, String] =
    if q == null || q.isEmpty then Map.empty
    else
      q.split("&").map { kv =>
        val eq = kv.indexOf('=')
        if eq < 0 then (kv, "") else (kv.substring(0, eq), kv.substring(eq + 1))
      }.toMap

  private def readAll(is: InputStream): String =
    val buf = new Array[Byte](4096)
    val sb  = new StringBuilder
    var n   = 0
    while { n = is.read(buf); n > 0 } do
      sb.append(new String(buf, 0, n, StandardCharsets.UTF_8))
    sb.toString

  // ── Accessors for the demo (so Phase12Demo can poke at internal state) ─
  def database: Database = db
  def portInUse: Int = port

end Server
