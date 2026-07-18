# nbody-fold-scala — Elite Generalist JSON Architectural Framework

[![CI](https://github.com/testdemoqwenai2025-creator/testdemo2025qwenai-creator/actions/workflows/ci.yml/badge.svg)](https://github.com/testdemoqwenai2025-creator/testdemo2025qwenai-creator/actions/workflows/ci.yml)
[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-live-success)](https://testdemoqwenai2025-creator.github.io/testdemo2025qwenai-creator/)
[![License](https://img.shields.io/badge/license-educational-blue)](#license)
[![Scala](https://img.shields.io/badge/Scala-3.4.2-red)](https://www.scala-lang.org/)
[![JDK](https://img.shields.io/badge/JDK-21-orange)](https://openjdk.org/projects/jdk/21/)
[![Phases](https://img.shields.io/badge/phases-13-brightgreen)](#phase-status)

> 🌐 **Live static demo — click to run in your browser (no install):**
> ### 👉 [https://testdemoqwenai2025-creator.github.io/testdemo2025qwenai-creator/](https://testdemoqwenai2025-creator.github.io/testdemo2025qwenai-creator/)
>
> A fully self-contained vanilla-JS port of the Phase 12 web tier. Anyone in the world can click this URL, create an N-body system, step the integrator, and watch the trajectory + energy drift update in real time — all observable in the audit log panel.

> ⚡ **Dynamic backend (Phase 13) — one-click deploy to your own free Vercel + Neon Postgres:**
>
> [![Deploy to Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Ftestdemoqwenai2025-creator%2Ftestdemo2025qwenai-creator&env=DATABASE_URL,DATABASE_PROVIDER,NBODY_API_KEY&envDescription=DATABASE_URL%20%28Neon%20Postgres%20connection%20string%29%2C%20DATABASE_PROVIDER%20%28set%20to%20postgresql%29%2C%20NBODY_API_KEY%20%28optional%20write%20gate%29&project-name=nbody-fold-scala&repository-name=nbody-fold-scala)
> [![Deploy to Neon](https://neon.tech/button)](https://neon.tech/new)
>
> Once your Vercel deployment is live (e.g. `https://nbody-fold-scala-xxx.vercel.app`), point the static demo at it by appending `?backend=https://nbody-fold-scala-xxx.vercel.app` to the GitHub Pages URL — the same UI then talks to a real Postgres-backed dynamic backend with cross-user persistence. See **[docs/deploy-guide.md](docs/deploy-guide.md)** for the full step-by-step.

---

## What this is

A **commercial-grade six-pillar software architecture** with a reference implementation in **Scala 3.4.2 on JDK 21** with **zero third-party dependencies** (no Cats, no Spire, no Akka, no JMH — just the JDK and the Scala stdlib). The reference application is an N-body gravitational simulator that progressively layers 12 phases of engineering rigor, from domain modeling through parser combinators, RLE compression, symplectic integration, file I/O, streaming, verification, benchmarking, structured-data Computational Arbitrage, publication, and a zero-dependency web tier.

### The six pillars

1. **Zero-Dependency Sovereignty** — JDK 21 + Scala 3.4.2 stdlib only. No transitive dependency trees. The artifact you ship is the artifact you can audit.
2. **Parser Combinator** — `Parser[A] = String => Option[(String, A)]` opaque type. JSON, CSV, and route paths all share one combinator algebra.
3. **Functor-Applicative-Alternative-Monoid** — typeclass foundations (`Functor`, `Applicative`, `Alternative`, `Monoid`, `Foldable`) with `given` instances for the body hierarchy.
4. **Literate Workflow** — `Tangle` (extract code blocks) + `Weave` (render to HTML) — single source of truth is `nbody.lit.md`, the runnable spec.
5. **Computational Arbitrage** — RLE / Double RLE on structured inputs to achieve O(log N) per-step instead of O(N²). 5.48× speedup on lattice N=10648.
6. **Elite Toolkit** — every phase ships a runnable demo (`Phase1Demo` … `Phase12Demo`) with 15–60 self-checks each, totaling 246+ passing assertions.

## Phase status

| Phase | Status | Highlights |
|-------|--------|------------|
| 0 — Domain Modeling | ✅ | `Vec3`, `Mass`, `Body`, `Component`, `ComponentVector`, `Entity`, `System` |
| 1 — Typeclass Foundations | ✅ | `Functor`, `Applicative`, `Alternative`, `Monoid`, `Foldable` |
| 2 — Parser Combinator | ✅ | JSON + CSV parsers from one combinator algebra |
| 3 — RLE Engine | ✅ | `Eq[A]` typeclass + `RLE.encode/decode` + `RLEIndex` O(log runs) lookup |
| 4 — Double RLE | ✅ | `DoubleRLE.encode2/decode2` + `JumpIndex` for O(log doubleRuns) range queries |
| 5 — N-Body Engine | ✅ | Newtonian gravity (G=1, Plummer softening) + leapfrog KDK; energy drift 8e-7 / 1000 steps |
| 6 — File I/O (Three-Call) | ✅ | `MappedFileReader` mmap, streaming CSV, append-only trajectory writer |
| 7 — Corecursion & Streaming | ✅ | `LazyList.iterate` + `CheckpointPipe` + `SensorGate`; O(1) memory over 100k steps |
| 8 — Verification & Literate | ✅ | `Tangle` + `Weave`; 5-test suite (energy, momentum, angular momentum, Kepler, Plummer virial) |
| 9 — Benchmarking | ✅ | Zero-dep JMH-style harness; 4 algorithms × 3 N sizes; trimmed-mean CV ≤ 5% |
| 10 — Computational Arbitrage | ✅ | `GroupAggregateSolver` — 5.48× speedup vs BruteForce at N=10648 on lattice |
| 11 — Publication & Handoff | ✅ | `Manifest` + `ReleaseArtifact` (JSON round-trip) + SHA-256 tamper seal + handoff docs |
| 12 — Zero-Dependency Web Tier | ✅ | JDK `HttpServer` + file-backed DB + 6-layer middleware + REST routes + single-file frontend |
| 13 — Dynamic Backend Deployment | ✅ | Prisma → PostgreSQL (env-driven), `vercel.json`, GitHub Actions CI, `?backend=` dynamic mode for the static demo, one-click Vercel + Neon deploy buttons |

**Total: 246+ self-checks PASS across all phases.**

## Repository layout

```
.
├── docs/                          ← 🌐 Static demo served by GitHub Pages
│   ├── index.html                 ← UI shell
│   ├── styles.css                 ← Dark theme (mirrors Scala Frontend.scala palette)
│   ├── db.js                      ← IndexedDB wrapper (4 object stores)
│   ├── physics.js                 ← MutableBodySystem + Plummer/lattice/two-body generators
│   ├── middleware.js              ← 6-layer chain (error/log/auth/json/cors/dispatch)
│   ├── routes.js                  ← 8 REST endpoints + path-pattern dispatcher
│   ├── app.js                     ← DOM wiring, fetch shim, canvas rendering
│   └── README.md                  ← Architecture + try-it guide
│
├── download/nbody-fold-scala/     ← Scala 3 reference implementation
│   ├── build.sbt                  ← Zero-dependency Scala 3.4.2 build (no libraryDependencies)
│   ├── src/main/scala/nbody/      ← 12-phase source tree (see Status table above)
│   ├── results/                   ← Benchmark CSVs + plots + manifest.json
│   ├── HANDOFF.md                 ← 8-section maintainer onboarding
│   ├── RELEASE_NOTES.md           ← v1.0.0 release summary
│   ├── ScientificReport.md        ← Phase 9 full benchmark analysis
│   ├── nbody.lit.md               ← Literate source of truth (Phase 8)
│   └── README.md                  ← Scala project README (phase-by-phase build instructions)
│
├── src/                           ← Next.js 16 + Prisma web control plane (Phase 11 web layer)
│   ├── app/                       ← React UI + API routes
│   ├── lib/                       ← nbody.ts (TS port of Scala Phase 5), db.ts, audit.ts
│   └── middleware.ts              ← Edge middleware (logging + API-key gate)
│
├── prisma/                        ← Database schema (Simulation, Body, Snapshot, ApiAudit)
├── skills.md                      ← Full 12-phase workflow plan
├── worklog.md                     ← Multi-agent work log (Task IDs 1–14)
└── .github/                       ← (TBD) CI workflows, issue templates
```

## Quick start

### Option A — Static demo (no install, runs in browser)

Just open **[https://testdemoqwenai2025-creator.github.io/testdemo2025qwenai-creator/](https://testdemoqwenai2025-creator.github.io/testdemo2025qwenai-creator/)** in any modern browser. Type any non-empty value in the **API Key** field, pick a generator, click **Create System**, then **Step Forward**.

### Option B — Scala backend (local)

```bash
git clone https://github.com/testdemoqwenai2025-creator/testdemo2025qwenai-creator.git
cd testdemo2025qwenai-creator/download/nbody-fold-scala
sbt compile
sbt "runMain nbody.Phase12Demo"   # starts HttpServer on localhost:18080+ with 61 self-checks
```

Then open `http://localhost:<port>/` in your browser to see the same UI served by the Scala backend (instead of the static port).

### Option C — Next.js control plane (local)

```bash
cd testdemoqwenai2025-creator
npm install
npx prisma generate
npx prisma db push
npm run dev
# Open http://localhost:3000
```

## Architecture (end-to-end full-stack round-trip)

```
                ┌─────────────────────────────────────────────┐
                │              Browser / Client                │
                │                                              │
                │   ┌────────────────────────────────────┐    │
   click ─────▶│   │  Frontend (HTML/CSS/JS)             │    │
                │   │  • create-system form              │    │
                │   │  • trajectory canvas (x-y)         │    │
                │   │  • energy-drift canvas             │    │
                │   │  • audit log panel                 │    │
                │   └─────────────┬──────────────────────┘    │
                │                 │ fetch('/api/...')         │
                │                 ▼                            │
                │   ┌────────────────────────────────────┐    │
                │   │  Middleware chain (6 layers)       │    │
                │   │  errorHandler → requestLogger →    │    │
                │   │  authGate → jsonBody → corsHandler │    │
                │   │  → dispatcher                      │    │
                │   └─────────────┬──────────────────────┘    │
                │                 │                            │
                │                 ▼                            │
                │   ┌────────────────────────────────────┐    │
                │   │  Routes (8 endpoints)              │    │
                │   │  GET/POST /api/simulations         │    │
                │   │  POST /api/simulations/:id/step    │    │
                │   │  GET /api/audit, /api/health       │    │
                │   └─────────────┬──────────────────────┘    │
                │                 │                            │
                │       ┌─────────┴─────────┐                  │
                │       ▼                   ▼                  │
                │   ┌────────┐         ┌──────────┐            │
                │   │ DB     │         │ Physics  │            │
                │   │(IDB /  │◀───────▶│(Mutable  │            │
                │   │ Prisma │         │ KDK)     │            │
                │   │ /file) │         └──────────┘            │
                │   └────────┘                                 │
                └─────────────────────────────────────────────┘
```

The static demo, the Scala backend, and the Next.js control plane all implement the **same four-tier architecture** (frontend → middleware → routes → DB) with the **same physics engine** (leapfrog KDK, Plummer softening, G=1). The static demo is the zero-install entry point; the Scala backend is the reference implementation; the Next.js app is the production-shape control plane.

## Documentation

- **[skills.md](skills.md)** — Full 12-phase workflow plan (the spec)
- **[download/nbody-fold-scala/HANDOFF.md](download/nbody-fold-scala/HANDOFF.md)** — 8-section maintainer onboarding
- **[download/nbody-fold-scala/RELEASE_NOTES.md](download/nbody-fold-scala/RELEASE_NOTES.md)** — v1.0.0 release summary
- **[download/nbody-fold-scala/ScientificReport.md](download/nbody-fold-scala/ScientificReport.md)** — Phase 9 benchmark analysis
- **[download/nbody-fold-scala/README.md](download/nbody-fold-scala/README.md)** — Phase-by-phase build instructions
- **[docs/README.md](docs/README.md)** — Static demo architecture + try-it guide
- **[worklog.md](worklog.md)** — Multi-agent work log

## License

This project is shared for educational and reference purposes. See commit history for attribution.

## Tags / Releases

- **v1.0.0** — Phase 11 release (Publication & Handoff Package, 53/53 self-checks PASS)
- **v1.1.0** — Phase 12 release (Zero-Dependency Web Tier + static GitHub Pages demo, 61/61 self-checks PASS)
- **v1.2.0** — Phase 13 release (Dynamic Backend Deployment — Vercel + Neon + GitHub Actions CI + `?backend=` dynamic mode)
