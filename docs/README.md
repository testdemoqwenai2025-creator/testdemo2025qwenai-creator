# nbody-fold-scala — Live Static Demo

This folder contains a **fully self-contained static demo** of the nbody-fold-scala Phase 12 web tier. It is served directly by **GitHub Pages** from the `main` branch's `/docs` folder — no build step, no backend server, no external dependencies.

## Live URL

When GitHub Pages is enabled for this repository (Settings → Pages → Source: `main` branch, `/docs` folder), the demo is available at:

**https://testdemoqwenai2025-creator.github.io/testdemo2025qwenai-creator/**

## What it demonstrates

The static demo is a 1:1 vanilla-JS port of the Scala Phase 12 web tier (`download/nbody-fold-scala/src/main/scala/nbody/Phase12_WebTier/`). It exercises the **full four-tier stack** entirely in your browser:

| Tier | Scala Phase 12 reference | Static demo port |
|------|--------------------------|------------------|
| **Frontend** | `Frontend.scala` (single-file HTML) | `index.html` + `styles.css` + `app.js` |
| **Middleware** | `Middleware.scala` (chain of `HttpHandler => HttpHandler`) | `middleware.js` (6-layer chain) |
| **Backend (routes)** | `Routes.scala` (pattern-match dispatch) | `routes.js` (8 endpoints) |
| **Database** | `Database.scala` (file-backed tables) | `db.js` (IndexedDB: 4 object stores) |
| **Physics** | `Phase5_NBody/MutableKDK.scala` | `physics.js` (`MutableBodySystem` class) |

## Architecture

```
   ┌─────────────────────────────────────────────────────────────┐
   │                    Browser (single tab)                      │
   │                                                              │
   │  ┌──────────────┐    fetch('/api/...')   ┌──────────────┐  │
   │  │  Frontend    │ ─────────────────────▶ │ fetch shim   │  │
   │  │  index.html  │ ◀───────────────────── │ (intercepts) │  │
   │  │  app.js      │     Response object    └──────┬───────┘  │
   │  └──────┬───────┘                                │          │
   │         │ dispatch                               ▼          │
   │         │           ┌─────────────────────────────────┐    │
   │         │           │   Middleware chain (6 layers)    │    │
   │         │           │  errorHandler → requestLogger →  │    │
   │         │           │  authGate → jsonBody → corsHandler│   │
   │         │           │  → dispatcher                    │    │
   │         │           └────────────┬────────────────────┘    │
   │         │                        │ handler call            │
   │         │                        ▼                         │
   │         │           ┌─────────────────────────────────┐    │
   │         │           │  Route handlers (routes.js)      │    │
   │         │           │  GET/POST /api/simulations       │    │
   │         │           │  POST /api/simulations/:id/step  │    │
   │         │           │  GET /api/audit, /api/health     │    │
   │         │           └────────────┬────────────────────┘    │
   │         │                        │                          │
   │         │                        ▼                          │
   │         │           ┌─────────────────────────────────┐    │
   │         │           │  IndexedDB (4 object stores)     │    │
   │         │           │  Simulation · Body · Snapshot ·  │    │
   │         │           │  ApiAudit                         │    │
   │         │           └─────────────────────────────────┘    │
   │         │                                                   │
   │         │           ┌─────────────────────────────────┐    │
   │         └──────────▶│  Physics engine (physics.js)     │    │
   │                     │  MutableBodySystem (KDK leapfrog)│    │
   │                     └─────────────────────────────────┘    │
   │                                                              │
   └─────────────────────────────────────────────────────────────┘
```

Every `fetch('/api/*')` call traverses the full middleware chain, dispatches to a route handler, reads/writes the IndexedDB tier, and returns a synthetic `Response` object — exactly as it would against a real HTTP server. The Audit Log panel shows each request with timestamp, method, path, status, latency, FNV-1a IP hash, and redacted API key.

## Try it

1. Open the live URL above.
2. Type any non-empty value in the **API Key** field (the middleware `authGate` rejects writes without one).
3. Pick a generator (Plummer / lattice / two-body) and click **Create System**.
4. Click **Step Forward** to advance the leapfrog integrator.
5. Watch the trajectory + energy drift canvases update from IndexedDB snapshots.
6. Watch the Audit Log fill with timestamped middleware-emitted rows.

## Files

- `index.html` — UI shell (header, stats bar, config panel, viz panel, audit log, footer)
- `styles.css` — dark theme (mirrors Scala `Frontend.scala` palette)
- `db.js` — IndexedDB wrapper (4 object stores, cascade delete, FNV-1a hashing)
- `physics.js` — `MutableBodySystem` + 3 initial-condition generators
- `middleware.js` — 6-layer middleware chain (error/log/auth/json/cors/dispatch)
- `routes.js` — 8 REST endpoints + path-pattern dispatcher
- `app.js` — DOM wiring, fetch shim, canvas rendering, audit panel listener

## License

Same as the parent repository.
