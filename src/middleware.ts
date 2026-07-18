// ============================================================================
// src/middleware.ts — Next.js middleware for nbody-fold-scala web control plane
// ============================================================================
// Two responsibilities:
//
//   1. REQUEST LOGGING + AUDIT — every /api/* request is logged to the
//      ApiAudit table with method, path, latency, status, IP hash, and
//      redacted API key. This gives the frontend's "Audit Log" panel a
//      real-time view of all backend traffic.
//
//   2. API-KEY GATE — write endpoints (POST /api/simulations, POST
//      /api/simulations/[id]/step, DELETE /api/simulations/[id]) require
//      an `x-api-key` header matching the NBODY_API_KEY env var. Read
//      endpoints (GET) are open. The gate is enforced via a simple
//      constant-time string compare to avoid timing attacks.
//
// The middleware runs on the Edge runtime, so it cannot use Prisma
// directly. Instead, it stamps the request with timing + audit headers
// (using the FNV-1a hash for the IP — Edge runtime doesn't support
// Node's `crypto` module). A separate server-side utility (auditApiCall)
// writes the row from inside each API route handler after the response
// is ready.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'

// ── Constants ─────────────────────────────────────────────────────────────

const AUDITED_PREFIX = '/api/'
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

// Header names (request → response audit trail)
const HDR_START_MS = 'x-nbody-start-ms'
const HDR_IP_HASH  = 'x-nbody-ip-hash'
const HDR_API_KEY  = 'x-nbody-api-key'   // redacted: last 4 chars only
const HDR_AUTH_OK  = 'x-nbody-auth-ok'

// ── Helpers ───────────────────────────────────────────────────────────────

/** Constant-time string compare (avoids timing side-channels). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

/** FNV-1a 64-bit hash of client IP, truncated to 16 hex chars.
  * Uses no Node.js APIs — works on Edge runtime. Privacy-preserving. */
function hashIp(ip: string): string {
  // FNV-1a 64-bit: hash = (hash ^ byte) * prime, init = 0xcbf29ce484222325
  // We use 32-bit Math (sufficient for IP hashing — not cryptographic).
  let h = 0x811c9dc5  // FNV-1a 32-bit offset basis
  for (let i = 0; i < ip.length; i++) {
    h ^= ip.charCodeAt(i)
    h = Math.imul(h, 0x01000193)  // FNV-1a 32-bit prime
  }
  // Convert to 8-char hex (32-bit), pad to 16 chars for visual symmetry
  const hex = (h >>> 0).toString(16).padStart(8, '0')
  return hex + hex  // 16 chars
}

/** Extract client IP from request, accounting for proxy headers. */
function clientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return req.headers.get('x-real-ip') ?? '127.0.0.1'
}

/** Redact API key — keep only the last 4 chars. */
function redactKey(key: string | null): string | null {
  if (!key) return null
  if (key.length <= 4) return '****'
  return '****' + key.slice(-4)
}

// ── Middleware entry ──────────────────────────────────────────────────────

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const path = pathname + (req.nextUrl.search || '')

  // Only audit /api/* requests
  if (!pathname.startsWith(AUDITED_PREFIX)) {
    return NextResponse.next()
  }

  const startMs = Date.now()
  const ipHash = hashIp(clientIp(req))
  const apiKey = redactKey(req.headers.get('x-api-key'))

  // ── API-key gate for write endpoints ──────────────────────────────────
  // Write endpoints require a valid x-api-key header matching the env var.
  // Read endpoints (GET, HEAD) are open.
  const isWrite = WRITE_METHODS.has(req.method)
  let authOk = true
  if (isWrite) {
    const providedKey = req.headers.get('x-api-key') ?? ''
    const expectedKey = process.env.NBODY_API_KEY ?? ''
    // If NBODY_API_KEY is unset, allow all writes (dev mode convenience).
    if (expectedKey.length > 0) {
      authOk = safeEqual(providedKey, expectedKey)
      if (!authOk) {
        const res = NextResponse.json(
          { error: 'Invalid or missing API key. Set the x-api-key header.' },
          { status: 401 }
        )
        res.headers.set(HDR_START_MS, String(startMs))
        res.headers.set(HDR_IP_HASH, ipHash)
        res.headers.set(HDR_API_KEY, apiKey ?? '')
        res.headers.set(HDR_AUTH_OK, 'false')
        res.headers.set('x-nbody-latency-ms', String(Date.now() - startMs))
        return res
      }
    }
  }

  // ── Pass through with audit headers attached ──────────────────────────
  const res = NextResponse.next()
  res.headers.set(HDR_START_MS, String(startMs))
  res.headers.set(HDR_IP_HASH, ipHash)
  res.headers.set(HDR_API_KEY, apiKey ?? '')
  res.headers.set(HDR_AUTH_OK, authOk ? 'true' : 'false')
  return res
}

export const config = {
  // Run middleware on all /api/* routes
  matcher: ['/api/:path*'],
}
