# nbody-fold-scala — live demo (GitHub Pages)

This directory contains the **static, zero-dependency vanilla-JS port** of the
Scala Phase 12 web tier. It is served directly by GitHub Pages from the
`main` branch's `/docs` folder — no build step, no backend server required.

## Two modes

The demo runs in **two modes**, selected by URL query parameter:

| Mode | URL | Backend | Persistence |
|------|-----|---------|-------------|
| STATIC  | `https://louispenev.github.io/nbody-fold-scala/`                  | none — runs entirely in-page | IndexedDB (browser) |
| DYNAMIC | `https://louispenev.github.io/nbody-fold-scala/?backend=<URL>`   | real Node.js backend (Phase 13) | JSON file on server |

In **STATIC mode** (default), every `fetch('/api/*')` call is intercepted by
a `window.fetch` shim, routed through a 6-layer middleware chain (error →
log → CORS → auth → json-body → dispatch), and serviced against IndexedDB.

In **DYNAMIC mode**, the same shim forwards `/api/*` calls to a real backend
URL via the original `fetch`. The header badge pings `/api/health` every
5 seconds and shows the live status (UP/DOWN, latency, version, region,
uptime, request count).

## Files

```
docs/
├── index.html        UI shell (header + 5 panels + footer)
├── styles.css        Dark theme (mirrors Scala Frontend.scala)
├── physics.js        MutableBodySystem + Plummer/lattice/two-body generators
├── db.js             IndexedDB wrapper (4 stores, cascade delete)
├── middleware.js     6-layer middleware chain (error/log/cors/auth/json/dispatch)
├── routes.js         8 REST endpoints + dispatcher
├── app.js            DOM wiring + fetch shim + LIVE health checker + canvas
└── README.md         This file
```

## Live backend health indicator (Phase 13)

The header badge is **dynamic** (not a static CI badge image). It pings
`/api/health` every 5 seconds:

- **STATIC mode**: shows `DEMO MODE (in-browser)` with system count + request
  count. No external server to ping — the chain runs in-page.
- **DYNAMIC mode**: shows `UP · <latency>ms` with version, region, uptime,
  and request count. If the backend is unreachable or returns non-200, the
  badge turns red with `DOWN · <reason>`.

This is more useful than a CI badge because it reflects the actual current
state of the backend, not the state of the test suite the last time someone
pushed.

## API surface

All endpoints accept `X-Api-Key: demo` (any non-empty value works in the
public deployment).

```
GET    /api/health                       Health snapshot (version, uptime, counts)
GET    /api/systems                      List all systems
POST   /api/systems                      Create a system from a body list
GET    /api/systems/:id                  Full state (meta + bodies + last trajectory)
POST   /api/systems/:id/step             Advance N steps, persist samples
GET    /api/systems/:id/trajectories     All trajectory samples
DELETE /api/systems/:id                  Cascade delete
GET    /api/audit?limit=N                Recent audit-log rows
```

## Deploying the dynamic backend

See [`../server/README.md`](../server/README.md) for the zero-dependency
Node.js backend, [`../render.yaml`](../render.yaml) for one-click Render
deployment, and [`../fly.toml`](../fly.toml) for Fly.io.

Quick start:

```bash
cd server && npm start
# → listening on http://localhost:3000
# Open the demo with:
#   https://louispenev.github.io/nbody-fold-scala/?backend=http://localhost:3000
```
