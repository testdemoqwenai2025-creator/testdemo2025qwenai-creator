// ============================================================================
// middleware.js — 6-layer middleware chain (1:1 port of Scala Phase 12)
// ============================================================================
// Phase 12 deliverable (static GitHub Pages demo).
//
// type Middleware = Handler => Handler
// type Handler = Request => Response
//
// Layer order (outer → inner):
//   1. errorMW   — catches thrown errors, returns 500 JSON
//   2. logMW     — emits audit-log row (also visible in UI panel)
//   3. corsMW    — sets Access-Control-Allow-Origin: *
//   4. authMW    — checks X-Api-Key header (any non-empty value accepted in
//                  demo mode; production mode requires NBODY_API_KEY env var)
//   5. jsonBodyMW — parses request body as JSON, attaches req.jsonBody
//   6. dispatchMW— routes by method + path to the appropriate handler
//
// Static demo only invokes this chain when fetch('/api/*') is called WITHOUT
// a ?backend= query param. In dynamic mode the fetch shim forwards to the
// real backend instead.
// ============================================================================

(function (global) {
  'use strict';

  // ── Tiny helpers ─────────────────────────────────────────────────────────

  // FNV-1a 32-bit hash (used for API-key digest comparison demo)
  function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  // Constant-time string compare (defends against timing attacks on the API
  // key — matches Scala Phase 12 safeEqual)
  function safeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  function redactKey(k) {
    if (!k) return '<empty>';
    if (k.length <= 8) return '*'.repeat(k.length);
    return k.slice(0, 4) + '…' + '*'.repeat(k.length - 8) + k.slice(-4);
  }

  // ── Request / Response shapes ────────────────────────────────────────────
  //
  // Request:  { method, path, headers, body, jsonBody }
  // Response: { status, headers, body }
  function makeRequest(method, path, headers, body) {
    return { method, path, headers: headers || {}, body: body || null, jsonBody: null };
  }
  function makeResponse(status, body, headers) {
    return {
      status: status || 200,
      headers: headers || { 'Content-Type': 'application/json' },
      body: body !== undefined ? body : null
    };
  }
  function json(status, obj) {
    return makeResponse(status, JSON.stringify(obj), { 'Content-Type': 'application/json' });
  }
  function errorJson(status, msg) {
    return json(status, { error: msg });
  }

  // ── Layer 1: errorMW ─────────────────────────────────────────────────────
  function errorMW(next) {
    return async (req) => {
      try { return await next(req); }
      catch (e) {
        console.error('[errorMW]', e);
        return errorJson(500, 'internal_error');
      }
    };
  }

  // ── Layer 2: logMW — emits an audit row via the injected sink ────────────
  function logMW(auditSink) {
    return (next) => async (req) => {
      const t0 = performance.now();
      const res = await next(req);
      const ms = Math.round(performance.now() - t0);
      if (auditSink) {
        try {
          await auditSink({
            method: req.method,
            path: req.path,
            status: res.status,
            ms,
            meta: req.jsonBody ? JSON.stringify(req.jsonBody).slice(0, 200) : null
          });
        } catch (_) { /* audit failure is non-fatal */ }
      }
      return res;
    };
  }

  // ── Layer 3: corsMW ──────────────────────────────────────────────────────
  function corsMW(next) {
    return async (req) => {
      const res = await next(req);
      res.headers['Access-Control-Allow-Origin'] = '*';
      res.headers['Access-Control-Allow-Methods'] = 'GET, POST, DELETE, OPTIONS';
      res.headers['Access-Control-Allow-Headers'] = 'Content-Type, X-Api-Key';
      return res;
    };
  }

  // ── Layer 4: authMW ──────────────────────────────────────────────────────
  // Demo mode: any non-empty X-Api-Key is accepted.
  // Production mode: requires NBODY_API_KEY env (passed via opts.expectedKey).
  function authMW(opts) {
    opts = opts || {};
    return (next) => async (req) => {
      if (req.method === 'OPTIONS') return makeResponse(204, null);
      // Health check is unauthenticated
      if (req.path === '/api/health') return next(req);
      const key = req.headers['X-Api-Key'] || req.headers['x-api-key'] || '';
      const ok = opts.expectedKey
        ? safeEqual(key, opts.expectedKey)
        : (key && key.length > 0);
      if (!ok) return errorJson(401, 'missing_or_invalid_api_key');
      return next(req);
    };
  }

  // ── Layer 5: jsonBodyMW ──────────────────────────────────────────────────
  function jsonBodyMW(next) {
    return async (req) => {
      if (req.body && typeof req.body === 'string' && req.body.length > 0) {
        try { req.jsonBody = JSON.parse(req.body); }
        catch (_) { return errorJson(400, 'invalid_json_body'); }
      }
      return next(req);
    };
  }

  // ── Layer 6: dispatchMW — route to the provided routes object ────────────
  function dispatchMW(routes) {
    return async (req) => routes.dispatch(req);
  }

  // ── Build the full chain ─────────────────────────────────────────────────
  function buildChain(routes, opts) {
    opts = opts || {};
    const handler = errorMW(
      logMW(opts.auditSink)(
        corsMW(
          authMW(opts)(
            jsonBodyMW(
              dispatchMW(routes)
            )
          )
        )
      )
    );
    return handler;
  }

  global.NBodyMiddleware = {
    fnv1a, safeEqual, redactKey,
    makeRequest, makeResponse, json, errorJson,
    errorMW, logMW, corsMW, authMW, jsonBodyMW, dispatchMW,
    buildChain
  };

})(typeof window !== 'undefined' ? window : globalThis);
