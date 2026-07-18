# nbody-fold-server — dynamic backend (Phase 13)

Zero-dependency Node.js backend that powers the live demo's **DYNAMIC mode**.

## What it does

- Serves the **`/api/*`** endpoints (same 8 routes as the in-page static demo, same physics)
- Serves the **`/api/health`** endpoint that the demo header badge pings every 5 seconds
- Serves the static demo UI from `../docs/` on non-API paths (so you can run
  everything from one process if you want)
- Persists state to `server/data/db.json` (atomic writes via tmp+rename)

## Run locally

```bash
cd server
node server.js
# → listening on http://localhost:3000
# → health: http://localhost:3000/api/health
# → demo UI: http://localhost:3000/
```

Then point the live demo at it:

```
https://louispenev.github.io/nbody-fold-scala/?backend=http://localhost:3000
```

The header badge should turn green within 5 seconds, showing
`UP · 5ms · v1.0.0-server · local · up 12s · req#3`.

## Configuration (env vars)

| Env var | Default | Purpose |
|---------|---------|---------|
| `PORT` | `3000` | HTTP listen port (Render/Fly.io set this for you) |
| `NBODY_API_KEY` | `demo` | Required API key for non-`/api/health` endpoints. When `demo`, any non-empty key is accepted. **Set to a secret in production!** |
| `NBODY_REGION` | `local` | Region label reported in `/api/health` (e.g. `iad1`, `fra1`, `sin1`) |

## Architecture

```
                     ┌─────────────────────────────────────┐
Browser              │  docs/app.js  (fetch shim)          │
                     └────────────────┬────────────────────┘
                                      │ /api/*  (forwarded)
                                      ▼
                     ┌─────────────────────────────────────┐
Dynamic backend      │  server/server.js  (http module)    │
                     │                                     │
                     │  dispatch ─→ /api/health (live)     │
                     │           ─→ /api/systems/*         │
                     │           ─→ /api/audit             │
                     │           ─→ static files           │
                     │                                     │
                     │  Reuses:                            │
                     │   docs/physics.js   (MutableKDK)    │
                     │   docs/middleware.js (auth helpers) │
                     │                                     │
                     │  Persists: server/data/db.json      │
                     └─────────────────────────────────────┘
```

The key design choice: **physics.js and middleware.js are loaded unchanged
in Node via a `global.window = {}` shim**, so the SAME code that runs the
in-browser demo also runs the server. No fork, no port divergence — when
you fix a bug in `docs/physics.js`, the server picks it up on next restart.

## Deployment

One-click options are in the repo root:

- **Render**: see `render.yaml` (free tier, auto-deploys from `main`)
- **Fly.io**: see `fly.toml` (free tier, requires `flyctl`)

Manual deployment to any Node host:

```bash
git clone https://github.com/louispenev/nbody-fold-scala.git
cd nbody-fold-scala/server
PORT=3000 NBODY_API_KEY=your-secret NBODY_REGION=iad1 node server.js
```

## Endpoints

See [`../docs/README.md`](../docs/README.md) for the full API surface —
the server implements exactly the same 8 endpoints as the static demo.

## Smoke test

```bash
node ../scripts/smoke-test.js
# → 5/5 PASS (validates physics + middleware helpers)
```
