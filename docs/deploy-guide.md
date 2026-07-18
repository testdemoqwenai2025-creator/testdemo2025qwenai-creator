# Deploy Guide — Dynamic Backend (Phase 13)

This guide walks through deploying the **nbody-fold-scala dynamic backend** to a free hosting provider so the static demo can talk to a real, cross-user, persistent Postgres database instead of the in-browser IndexedDB.

**Time required:** ~10 minutes.
**Cost:** $0 (all free tiers).
**What you need:** A GitHub account (you already have one if you're reading this).

---

## Why a dynamic backend?

The static demo at **[https://testdemoqwenai2025-creator.github.io/testdemo2025qwenai-creator/](https://testdemoqwenai2025-creator.github.io/testdemo2025qwenai-creator/)** runs the **entire full-stack** in your browser — frontend, middleware, routes, database (IndexedDB), and physics engine. This is great for zero-install observation, but:

- **Each visitor has their own private database** — your systems aren't visible to anyone else.
- **The database is cleared when you clear browser storage** — no long-term persistence.
- **No server-side compute** — large simulations are bounded by your device's CPU.

A dynamic backend solves all three:
- **One shared Postgres database** — every visitor sees the same systems.
- **Permanent persistence** — data survives browser resets, device changes.
- **Server-side compute** — Next.js API routes run the physics engine on the server (Vercel Edge / Node runtime).

The static demo supports both modes via a single query parameter: `?backend=<URL>`. Same UI, same code, just a different data tier.

---

## Option A: Vercel + Neon (recommended — easiest)

### Step 1 — Deploy the Next.js app to Vercel

Click this button:

[![Deploy to Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Ftestdemoqwenai2025-creator%2Ftestdemo2025qwenai-creator&env=DATABASE_URL,DATABASE_PROVIDER,NBODY_API_KEY&envDescription=DATABASE_URL%20%28Neon%20Postgres%20connection%20string%29%2C%20DATABASE_PROVIDER%20%28set%20to%20postgresql%29%2C%20NBODY_API_KEY%20%28optional%20write%20gate%29&project-name=nbody-fold-scala&repository-name=nbody-fold-scala)

What happens:
1. Vercel clones the repo into a new GitHub repository under your account.
2. Vercel auto-detects Next.js, installs dependencies, runs `prisma generate` (via the `postinstall` hook in `package.json`), and builds.
3. Vercel prompts you to set three environment variables:
   - `DATABASE_URL` — your Neon Postgres connection string (get it from Step 2 below)
   - `DATABASE_PROVIDER` — set to `postgresql`
   - `NBODY_API_KEY` — (optional) any secret string; if set, write endpoints require it as the `x-api-key` header
4. Vercel deploys and gives you a URL like `https://nbody-fold-scala-xxx.vercel.app`.

### Step 2 — Create a free Neon Postgres database

Click this button:

[![Deploy to Neon](https://neon.tech/button)](https://neon.tech/new)

What happens:
1. Sign in with GitHub (one click).
2. Create a new project — name it `nbody-fold-scala`, pick a region close to Vercel's `iad1` (US East) for lowest latency.
3. Neon gives you a connection string that looks like:
   ```
   postgresql://user:password@ep-xxx-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
4. Copy this string — paste it into the Vercel `DATABASE_URL` env var from Step 1.

### Step 3 — Push the schema to the database

After Vercel deploys (Step 1), the build will run `prisma generate` but **not** `prisma db push` (we don't want the build creating tables on every deploy). You need to push the schema once manually:

**Option A (Vercel dashboard):**
1. Open your Vercel project → Settings → Functions → check that the deployment succeeded.
2. Use the Vercel CLI to run a one-off command:
   ```bash
   npm i -g vercel
   vercel login
   vercel link  # link to your project
   vercel env pull .env.local  # pull the env vars (including DATABASE_URL) locally
   npx prisma db push  # creates the 4 tables in Neon
   ```

**Option B (local terminal):**
1. Clone your new repo locally: `git clone https://github.com/<your-username>/nbody-fold-scala.git && cd nbody-fold-scala`
2. Create `.env` with:
   ```
   DATABASE_PROVIDER=postgresql
   DATABASE_URL=postgres://...your-neon-connection-string...?sslmode=require
   ```
3. Run: `npm install && npx prisma db push`
4. Verify in the Neon dashboard that 4 tables exist: `Simulation`, `Body`, `TrajectorySnapshot`, `ApiAudit`.

### Step 4 — Point the static demo at your dynamic backend

Your dynamic backend is now live at, say, `https://nbody-fold-scala-xxx.vercel.app`. To make the static demo talk to it instead of the in-browser IndexedDB, append `?backend=<URL>` to the GitHub Pages URL:

```
https://testdemoqwenai2025-creator.github.io/testdemo2025qwenai-creator/?backend=https://nbody-fold-scala-xxx.vercel.app
```

The header badge will turn green and show `DYNAMIC MODE → https://nbody-fold-scala-xxx.vercel.app`. Every fetch now goes over the network to your Vercel backend, which writes to your Neon Postgres database. Every visitor to that URL sees the same systems.

---

## Option B: Render (alternative — supports persistent disk on paid tier)

Render's free tier supports Node.js web services but has an **ephemeral filesystem** (the SQLite DB is lost on every redeploy). To use Render, you **must** use Postgres (Neon or Render's own Postgres free tier).

1. Go to https://render.com → New → Web Service → connect your GitHub repo.
2. Build command: `npm install && npx prisma generate && npm run build`
3. Start command: `npm run start`
4. Add env vars: `DATABASE_PROVIDER=postgresql`, `DATABASE_URL=<Neon connection string>`.
5. Render gives you a URL like `https://nbody-fold-scala.onrender.com`.
6. Point the static demo at it: `?backend=https://nbody-fold-scala.onrender.com`.

---

## Option C: Railway (alternative)

1. Go to https://railway.app → New Project → Deploy from GitHub Repo.
2. Railway auto-detects Next.js.
3. Add a Railway Postgres plugin (free $5 credit/month covers a small DB).
4. Set `DATABASE_URL` to the Railway-provided string, `DATABASE_PROVIDER=postgresql`.
5. Run `prisma db push` via Railway's CLI: `railway run npx prisma db push`.
6. URL like `https://nbody-fold-scala.up.railway.app`.

---

## Option D: Fly.io (alternative — supports persistent volumes)

1. Install `flyctl`: `curl -L https://fly.io/install.sh | sh`
2. `fly launch` from the repo root — Fly auto-detects Next.js and generates a Dockerfile.
3. `fly volumes create nbody_data` for persistent storage.
4. Provision Postgres: `fly postgres create` (or use Neon as before).
5. Set secrets: `fly secrets set DATABASE_URL=... DATABASE_PROVIDER=postgresql`.
6. `fly deploy` — URL like `https://nbody-fold-scala.fly.dev`.

---

## Verifying the dynamic backend

Once deployed, your dynamic backend exposes the same 8 REST endpoints as the static demo's in-browser middleware. Verify with curl:

```bash
# Health check (no auth required)
curl https://nbody-fold-scala-xxx.vercel.app/api/health
# → {"status":"ok","uptimeSec":42,"systems":0,"bodies":0,...}

# Create a system (requires x-api-key if NBODY_API_KEY is set)
curl -X POST https://nbody-fold-scala-xxx.vercel.app/api/simulations \
  -H "Content-Type: application/json" \
  -H "x-api-key: $NBODY_API_KEY" \
  -d '{"name":"two-body","dt":0.01,"softening":0.05,"bodies":[{"mass":1,"pos":[0,0,0],"vel":[0,0,0]},{"mass":0.001,"pos":[1,0,0],"vel":[0,1,0]}]}'

# Step it forward 200 KDK iterations
curl -X POST https://nbody-fold-scala-xxx.vercel.app/api/simulations/1/step \
  -H "Content-Type: application/json" \
  -H "x-api-key: $NBODY_API_KEY" \
  -d '{"steps":200,"sampleEvery":10}'

# Fetch the trajectory snapshots
curl https://nbody-fold-scala-xxx.vercel.app/api/simulations/1/snapshots
```

If all four return JSON, your dynamic backend is fully operational. Point the static demo at it via `?backend=...` and you have a production-grade full-stack N-body simulator.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `PrismaClientInitializationError: Can't reach database server` | Wrong `DATABASE_URL` or network egress blocked | Verify connection string in Neon dashboard; check Vercel function logs |
| `Environment variable not found: DATABASE_PROVIDER` | Env var not set in Vercel | Vercel dashboard → Settings → Environment Variables → add `DATABASE_PROVIDER=postgresql` |
| Tables don't exist after deploy | `prisma db push` never ran | Run `npx prisma db push` locally with the same `DATABASE_URL` |
| Static demo shows `DYNAMIC MODE` badge but requests fail (CORS) | Vercel CORS not configured | The Next.js middleware already sets `Access-Control-Allow-*: *`; check Vercel logs for the actual error |
| `x-api-key` rejected | `NBODY_API_KEY` set in Vercel but not in static demo | Type the same key into the API Key field — it's persisted in localStorage |
| Build fails on Vercel with `prisma generate` error | Missing `postinstall` hook | Already fixed in `package.json` (`"postinstall": "prisma generate"`). If you forked an older version, add it manually. |

---

## What's next?

Once your dynamic backend is live:
1. **Share the URL** — anyone with `https://testdemoqwenai2025-creator.github.io/testdemo2025qwenai-creator/?backend=<your-vercel-url>` can interact with your shared Postgres database.
2. **Set a real `NBODY_API_KEY`** — prevents anonymous writes. Share the key only with trusted collaborators.
3. **Monitor in Neon dashboard** — query count, storage, active connections.
4. **Set up Vercel Analytics** — free, gives per-route latency and visitor counts.

See **[README.md](../README.md)** for the full project overview and **[skills.md](../download/skills.md)** for the 13-phase architectural spec.
