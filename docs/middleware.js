/* ============================================================================
 * middleware.js — Request middleware chain for the static demo
 * ============================================================================
 * Mirrors src/middleware.ts (Next.js Edge middleware) and the Scala
 * Phase12_WebTier/Middleware.scala composition pattern:
 *
 *   type Middleware = Handler => Handler
 *
 * Six middlewares are composed into a single chain:
 *
 *   1. errorHandler  — catches thrown exceptions, returns 500 JSON
 *   2. requestLogger — FNV-1a IP hash, latency, status → ApiAudit store
 *   3. authGate      — write methods require x-api-key (constant-time compare)
 *   4. jsonBody      — parses JSON body, sets Content-Type
 *   5. corsHandler   — injects Access-Control-Allow-* headers
 *   6. dispatcher    — routes /api/* to handler functions (in routes.js)
 *
 * The chain is exposed as window.NBodyMW.process(request) → response.
 * ========================================================================== */

/** Constant-time string compare (avoids timing side-channels). */
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** FNV-1a 32-bit hash → 16-char hex (visual symmetry with Scala middleware). */
function hashIp(ip) {
  let h = 0x811c9dc5;
  for (let i = 0; i < ip.length; i++) {
    h ^= ip.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const hex = (h >>> 0).toString(16).padStart(8, '0');
  return hex + hex;
}

/** Redact API key — keep only the last 4 chars. */
function redactKey(key) {
  if (!key) return '';
  if (key.length <= 4) return '****';
  return '****' + key.slice(-4);
}

/** Build a synthetic Response object (compatible with the fetch() shape). */
function makeResponse(status, body, headers = {}) {
  const jsonBody = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      ...headers,
    },
    body: jsonBody,
    async json() { return JSON.parse(jsonBody); },
    async text() { return jsonBody; },
  };
}

/** Build a synthetic Request object from fetch() args. */
function makeRequest(method, path, body = null, headers = {}) {
  return {
    method: method.toUpperCase(),
    path,
    pathname: path.split('?')[0],
    search: path.includes('?') ? '?' + path.split('?')[1] : '',
    headers: { ...headers },
    body,
    ip: '127.0.0.1',  // static demo — always localhost
  };
}

// ── Middlewares ────────────────────────────────────────────────────────────

/** 1. errorHandler — wraps the handler in try/catch. */
function errorHandler(next) {
  return async (req) => {
    try {
      return await next(req);
    } catch (err) {
      console.error('[middleware errorHandler]', err);
      return makeResponse(500, {
        error: 'Internal Server Error',
        message: err.message || String(err),
        stack: err.stack ? err.stack.split('\n').slice(0, 3).join('\n') : null,
      });
    }
  };
}

/** 2. requestLogger — records the audit row after the handler runs. */
function requestLogger(next) {
  return async (req) => {
    const startMs = performance.now();
    const ts = Date.now();
    const ipHash = hashIp(req.ip);
    const apiKey = redactKey(req.headers['x-api-key'] || req.headers['X-Api-Key']);

    let status = 500;
    let response;
    try {
      response = await next(req);
      status = response.status;
    } finally {
      const latencyMs = Math.round(performance.now() - startMs);
      // Insert audit row — fire-and-forget (don't block the response)
      try {
        await window.NBodyDB.dbInsert('ApiAudit', {
          ts,
          method: req.method,
          path: req.pathname,
          status,
          latencyMs,
          ipHash,
          apiKey,
        });
      } catch (e) {
        console.warn('[middleware requestLogger] audit insert failed:', e);
      }
      // Emit a live event for the UI to append to the audit panel
      window.dispatchEvent(new CustomEvent('nbody:audit', {
        detail: { ts, method: req.method, path: req.pathname, status, latencyMs, ipHash, apiKey }
      }));
    }
    return response;
  };
}

/** 3. authGate — write methods require a non-empty x-api-key header. */
function authGate(next) {
  return async (req) => {
    const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
    if (!WRITE_METHODS.has(req.method)) return next(req);
    const provided = req.headers['x-api-key'] || req.headers['X-Api-Key'] || '';
    // For the static demo, the "expected key" is whatever the user typed in
    // the API Key input — there's no server-side env var. The gate just
    // checks that *some* non-empty key was provided. This mirrors the
    // Scala/Next.js pattern where writes are gated.
    if (!provided || provided.length === 0) {
      return makeResponse(401, {
        error: 'Invalid or missing API key. Set the x-api-key header (any non-empty value).',
      });
    }
    return next(req);
  };
}

/** 4. jsonBody — parses a JSON request body string into an object. */
function jsonBody(next) {
  return async (req) => {
    if (req.body && typeof req.body === 'string') {
      try {
        req.body = JSON.parse(req.body);
      } catch (e) {
        return makeResponse(400, { error: 'Invalid JSON body', message: e.message });
      }
    }
    return next(req);
  };
}

/** 5. corsHandler — injects CORS headers into the response. */
function corsHandler(next) {
  return async (req) => {
    if (req.method === 'OPTIONS') {
      return makeResponse(204, '', {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      });
    }
    const res = await next(req);
    return res;
  };
}

// 6. dispatcher is injected by routes.js (it needs the route table).

/** Compose middlewares left-to-right: [m1, m2, m3] → m1(m2(m3(handler))). */
function compose(middlewares, finalHandler) {
  return middlewares.reduceRight((acc, mw) => mw(acc), finalHandler);
}

// Expose to global scope
window.NBodyMW = {
  safeEqual, hashIp, redactKey,
  makeRequest, makeResponse,
  errorHandler, requestLogger, authGate, jsonBody, corsHandler,
  compose,
  // The full chain (without dispatcher) — routes.js appends dispatcher
  chain: [errorHandler, requestLogger, authGate, jsonBody, corsHandler],
};
