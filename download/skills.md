# N-Body Simulation via Bottom-Up Folds — Scala Workflow Design

> **Project codename:** `nbody-fold-scala`
> **Language:** Scala 3 (JDK 21+)
> **Dependency policy:** Zero external libraries. Scala 3 stdlib + JDK only.
> **Framework pillars exercised:** 1 (Zero-Dep) · 3 (Math Abstractions) · 4 (Literate) · 5 (Computational Arbitrage) · 6 (Elite Toolkit)

---

## 0. Scientific Objective

Build a scientifically credible N-body gravitational simulator that demonstrates **Computational Arbitrage**: replacing the brute-force O(N²) pairwise computation with a **bottom-up fold** over a hierarchical domain model (Component → Vector → Entity → System), accelerated by **Double Run-Length Encoding (RLE)** to achieve O(log N) or better per-step complexity on structured inputs.

The simulation must satisfy three scientific criteria:

1. **Correctness** — Total energy, linear momentum, and angular momentum drift must stay below 1e-6 per 1000 time steps on a Kepler two-body test.
2. **Reproducibility** — Same initial conditions + same seed ⇒ bit-identical trajectories.
3. **Benchmarkability** — Per-step wall-clock time vs. N must be reported for N ∈ {128, 1k, 10k, 100k}, compared against brute-force and Barnes-Hut reference implementations.

---

## 1. Scala-Specific Pillar Adaptations

The original framework spec is language-agnostic; here is how each exercised pillar maps to Scala 3 idioms — without crossing the zero-dependency line.

| Pillar | Original (Haskell/C) | Scala 3 Adaptation | Stdlib Source |
|--------|----------------------|--------------------|---------------|
| **1. Zero-Dependency** | `base` / `stdio.h` | Scala 3 stdlib + JDK only. No Cats, no Spire, no Akka. | `scala.*`, `java.*` |
| **3. Math Abstractions** | `Functor`/`Applicative`/`Alternative`/`Monoid` typeclasses | Custom `trait Functor[F[_]]`, `trait Applicative[F[_]]`, `trait Alternative[F[_]]`, `trait Monoid[A]` with `given` instances | `scala.*` (no imports needed) |
| **4. Literate Workflow** | `.lhs` files + NoBuild | Markdown source → Scala tangler + HTML weaver, written in Scala itself (bootstrapped) | `scala.util.matching` for regex, `java.nio` for I/O |
| **5. Computational Arbitrage** | RLE, Double RLE, bottom-up folds | `Vector` grouping for RLE; nested grouping for Double RLE; `Foldable` typeclass for the hierarchy | `scala.collection.immutable.*` |
| **6. Elite Toolkit — Three-Call** | `open` → `fstat` → `mmap` | `FileChannel.open` → `channel.size()` → `channel.map(READ_ONLY, 0, size)` → `MappedByteBuffer` | `java.nio.channels.*`, `java.nio.*` |
| **6. Elite Toolkit — Corecursion** | Lazy Haskell lists | `LazyList.iterate(state)(step)` — infinite stream of simulation states, consumed on demand | `scala.collection.immutable.LazyList` |
| **6. Elite Toolkit — Zero Init** | C `calloc` semantics | `Array.ofDim[Double](n)` is JVM-guaranteed to be zero-filled; `null` for reference arrays is a documented safe sentinel | JVM spec §2.4 |
| **6. Elite Toolkit — Wait for Input** | Sensor loops | `LazyList` naturally pausing until consumer pulls; or `BlockingQueue` for live sensor ingest | `scala.collection.immutable.LazyList`, `java.util.concurrent.*` |

**Key design principle:** every typeclass we need (`Functor`, `Applicative`, `Alternative`, `Monoid`, `Foldable`) is small enough to define in <40 lines of Scala. Bringing in Cats would be 50,000 lines for the same expressivity — exactly the dependency hell the framework warns against.

---

## 2. Workflow Phases

The project is structured as **10 sequential phases**. Each phase produces a deliverable that can be reviewed and merged independently. The phase ordering respects the dependency graph: abstractions before algorithms, algorithms before benchmarks.

```
Phase 0 ──▶ Phase 1 ──▶ Phase 2 ──▶ Phase 3 ──▶ Phase 4 ──▶ Phase 5 ──▶ Phase 6 ──▶ Phase 7 ──▶ Phase 8 ──▶ Phase 9
Domain     Typeclass   Parser      RLE         Double      N-Body      File I/O    Corecursion  Verif       Bench
Model      Foundations  Comb.       Engine      RLE         Engine      (3-Call)    + Stream     & Lit.      & Report
```

### Phase 0 — Domain Modeling
**Goal:** Define the physical entities and the simulation hierarchy.

**Deliverables:**
- `Vec3.scala` — 3D vector with `+`, `-`, `*`, `dot`, `cross`, `norm`. Pure value class, no third-party math lib.
- `Body.scala` — `case class Body(mass: Double, pos: Vec3, vel: Vec3, acc: Vec3)`
- `Component.scala` — smallest unit (a single body OR a small fixed-size cluster)
- `Vector3D.scala` — a spatial vector of `Component`s (not to be confused with `Vec3`)
- `Entity.scala` — a logical entity (e.g., a star with its planets)
- `System.scala` — top-level simulation universe
- `Mass` newtype wrapper (avoid primitive obsession)

**Verification:** Round-trip tests: `Body → Component → Entity → System → flatList` must equal original.

---

### Phase 1 — Mathematical Abstraction Foundations
**Goal:** Define the four pillar typeclasses with `given` instances for `Vec3`, `Body`, and the hierarchy.

**Deliverables:**
- `Functor.scala` — `trait Functor[F[_]] { def map[A,B](fa: F[A])(f: A => B): F[B] }`
- `Applicative.scala` — extends `Functor`, adds `pure` and `ap`
- `Alternative.scala` — extends `Applicative`, adds `empty` and `|` (alias for `orElse`)
- `Monoid.scala` — `trait Monoid[A] { def empty: A; def combine(a: A, b: A): A }`
- `Foldable.scala` — `trait Foldable[F[_]] { def foldMap[A,B](fa: F[A])(f: A => B)(using M: Monoid[B]): B }`
- `given Monoid[Vec3]` — vector addition forms a monoid
- `given Monoid[Double]` — for energy/momentum aggregation
- `given Foldable[Component]`, `given Foldable[Entity]`, `given Foldable[System]` — the bottom-up fold hierarchy

**Verification:** The "Epic Move" demo: `sequenceA(List(Parser1, Parser2, Parser3))` works on a small parser built with these typeclasses.

---

### Phase 2 — Parser Combinator (Scala Port)
**Goal:** Port the Haskell `ParserCombinator.hs` to Scala 3, used to parse initial-condition files.

**Deliverables:**
- `Parser.scala` — `type Parser[A] = String => Option[(String, A)]`
- `given Functor[Parser]`, `given Applicative[Parser]`, `given Alternative[Parser]`
- Primitives: `charP`, `stringP`, `spanP`, `notEmpty`, `ws`, `lexeme`
- `csvParser` — parses `mass,x,y,z,vx,vy,vz` initial condition files
- `jsonParser` — optional, for JSON-formatted initial conditions (exercises `sequenceA` on object members)

**Verification:** Parse a 1000-body Plummer-sphere CSV; round-trip `parse → AST → serialize → parse` is identity.

---

### Phase 3 — RLE Compression Engine
**Goal:** Implement Run-Length Encoding over `Vector[A]` with `Eq[A]` constraint.

**Deliverables:**
- `RLE.scala` — `def encode[A: Eq](as: Vector[A]): Vector[(A, Int)]` and `def decode[A](rle: Vector[(A, Int)]): Vector[A]`
- `RLEIndex` — supports O(log N) "what is the i-th element?" lookup via prefix-sum binary search
- `given Eq[Body]` — bodies are equal if same ID (not same state)
- Property tests: `decode ∘ encode = identity`; length preserved

**Verification:** Encode a 10k-body spatial sort; decode back; bit-identical.

---

### Phase 4 — Double RLE ("Mathematical Jumping")
**Goal:** Apply RLE twice — first on entity names, then on group sizes — to enable O(1) / O(log N) jumps.

**Deliverables:**
- `DoubleRLE.scala` — `def encode2[A: Eq](as: Vector[A]): Vector[((A, Int), Int)]` where outer `Int` is the count of identical (element, count) pairs
- `JumpIndex` — answers `def jumpTo(i: Long): A` in O(log log N) via two-level binary search
- Worked example on paper: a 1M-body dataset with periodic spatial structure compresses to ~1000 entries

**Verification:** Compare `JumpIndex.jumpTo(i)` against `vector(i)` for all `i` on a 10k dataset. Benchmark the jump vs. direct index.

---

### Phase 5 — N-Body Simulation Engine
**Goal:** The actual physics, expressed as a bottom-up fold.

**Deliverables:**
- `Physics.scala` — `def force(a: Body, b: Body): Vec3` (Newtonian gravity with softening ε)
- `Integrator.scala` — leapfrog (KDK) integrator — energy-conserving for long runs
- `Simulator.scala` — `def step(system: System): System` defined as:
  ```
  system
    |> foldMap[Component](_.computeLocalForces)        // O(C) per component
    |> foldMap[Entity](_.aggregateComponentForces)     // O(E×C) per entity
    |> foldMap[System](_.aggregateEntityForces)        // O(S×E) per system
    |> integrate                                     // O(N) total
  ```
- The "Mathematical Jumping" optimization: when scanning for force contributions from a far cluster, use `JumpIndex` to skip identical-cluster groups in O(1) instead of O(cluster size)

**Verification:**
- Two-body Kepler test: eccentricity, semi-major axis preserved over 10 orbital periods to within 1e-6
- Total energy drift < 1e-6 over 1000 steps
- Total momentum conserved to machine precision

---

### Phase 6 — File I/O via Three-Call Principle
**Goal:** Zero-copy initial-condition loading via `java.nio` memory mapping.

**Deliverables:**
- `MappedFileReader.scala`:
  ```
  val channel = FileChannel.open(path)         // call 1: open
  val size    = channel.size()                  // call 2: fstat equivalent
  val buffer  = channel.map(READ_ONLY, 0, size) // call 3: mmap equivalent
  channel.close()
  buffer
  ```
- `InitialConditionsLoader.scala` — combines `MappedFileReader` + `Parser` (Phase 2) to parse multi-GB initial condition files without heap pressure
- `TrajectoryWriter.scala` — append-only mmap writer for trajectory output

**Verification:** Load a 1GB CSV; RSS stays under 200MB (proves zero-copy, not buffered copy).

---

### Phase 7 — Corecursion & Streaming
**Goal:** Express the simulation as an infinite lazy stream of states.

**Deliverables:**
- `LazySimulation.scala`:
  ```
  val states: LazyList[System] = LazyList.iterate(initialSystem)(Simulator.step)
  // Consume on demand — never materializes the whole stream
  states.take(10000).foreach(TrajectoryWriter.append)
  ```
- `CheckpointPipe.scala` — every N steps, materialize a snapshot (for fault recovery)
- `SensorGate.scala` — demonstrates "Wait for Input": a `LazyList` of external perturbations (e.g., a probe fly-by) consumed in lockstep with simulation steps

**Verification:** Run a 1M-step simulation with `maxHeap = 256MB`; take a sample at step 500k; confirm correctness against an in-memory run.

---

### Phase 8 — Verification & Literate Workflow
**Goal:** Wrap the whole thing in a literate document and prove the physics is right.

**Deliverables:**
- `nbody.lit.md` — single Markdown source containing all Scala code blocks
- `Tangle.scala` — extracts `scala` code blocks into `src/main/scala/...` tree
- `Weave.scala` — renders `nbody.lit.md` into `nbody.html` with syntax highlighting
- Verification suite:
  - `EnergyConservationTest` — drift < 1e-6 over 1000 steps
  - `MomentumConservationTest` — drift < 1e-12 (exactly conserved by leapfrog)
  - `AngularMomentumTest` — drift < 1e-12
  - `KeplerTwoBodyTest` — eccentricity preserved to 1e-6 over 10 orbits
  - `PlummerSphereTest` — virial ratio 2K/|U| ≈ 1.0 after relaxation

**Verification:** All tests green; `Tangle` produces compilable source; `Weave` produces HTML that renders the same code.

---

### Phase 9 — Benchmarking & Scientific Report
**Goal:** Quantify the Computational Arbitrage gain.

**Deliverables:**
- `Benchmark.scala` — JMH-style harness (but hand-rolled, zero-dep) measuring per-step wall-clock
- Comparison table:
  | N      | Brute Force O(N²) | Barnes-Hut O(N log N) | Fold + RLE | Fold + Double RLE |
  |--------|-------------------|------------------------|------------|-------------------|
  | 128    | TBD               | TBD                    | TBD        | TBD               |
  | 1k     | TBD               | TBD                    | TBD        | TBD               |
  | 10k    | TBD               | TBD                    | TBD        | TBD               |
  | 100k   | TBD               | TBD                    | TBD        | TBD               |
- `ScientificReport.md` — methodology, results, conservation-law plots, conclusion
- Plots via the `charts` skill: per-step time vs. N (log-log), energy drift vs. step count

**Verification:** Reproducibility — running the benchmark twice on the same machine yields ≤5% variance.

---

## 3. Project Directory Structure (Target)

```
nbody-fold-scala/
├── nbody.lit.md                    # Phase 8: literate source (single source of truth)
├── README.md                       # Project overview, run instructions
├── build.sbt                       # Minimal: Scala 3 + JDK 21, no deps
├── project/
│   └── build.properties            # sbt version pin
├── src/main/scala/nbody/
│   ├── Phase0_Domain/              # Vec3, Body, Component, Entity, System
│   ├── Phase1_Typeclasses/         # Functor, Applicative, Alternative, Monoid, Foldable
│   ├── Phase2_Parser/              # Parser combinator port
│   ├── Phase3_RLE/                 # RLE engine
│   ├── Phase4_DoubleRLE/           # Double RLE + JumpIndex
│   ├── Phase5_Simulator/           # Physics, Integrator, Simulator
│   ├── Phase6_IO/                  # MappedFileReader, TrajectoryWriter
│   ├── Phase7_Stream/              # LazySimulation, CheckpointPipe, SensorGate
│   └── Phase8_Literate/            # Tangle, Weave
├── src/test/scala/nbody/
│   └── ... (one test file per phase)
├── data/
│   ├── kepler-two-body.csv
│   ├── plummer-1k.csv
│   └── plummer-10k.csv
└── results/                        # Phase 9 benchmark outputs
    ├── benchmark.csv
    ├── energy-drift.png
    └── scaling.png
```

---

## 4. Build & Run Plan

| Action | Command | Dependencies |
|--------|---------|--------------|
| Compile | `sbt compile` | sbt + Scala 3 + JDK 21 |
| Run tests | `sbt test` | Phase 0–8 complete |
| Run Kepler demo | `sbt "runMain nbody.KeplerDemo"` | Phase 0–5 complete |
| Run large sim | `sbt "runMain nbody.LargeSim data/plummer-10k.csv 10000"` | Phase 6–7 complete |
| Tangle literate | `sbt "runMain nbody.Tangle nbody.lit.md"` | Phase 8 complete |
| Weave docs | `sbt "runMain nbody.Weave nbody.lit.md nbody.html"` | Phase 8 complete |
| Benchmark | `sbt "runMain nbody.Benchmark"` | Phase 9 complete |

**Note on `sbt`:** sbt itself is a build tool, not a runtime dependency. The compiled artifacts depend only on Scala 3 stdlib + JDK. This honors the zero-dependency principle at the artifact level while still using a conventional build tool.

---

## 5. Risk Register

| Risk | Mitigation |
|------|-----------|
| Scala 3 typeclass ergonomics slower than expected | Phase 1 has a hard stop: if typeclass instance derivation takes >2 days, fall back to direct method calls on a `Simulatable` trait |
| Double RLE doesn't actually deliver O(log N) on real datasets | Phase 4 benchmark must show ≥3x speedup over single RLE on a Plummer sphere; if not, document the limitation and proceed with single RLE |
| `java.nio` mmap behaves differently on Linux vs. macOS | Phase 6 must include CI on both; document any platform-specific quirks |
| Leapfrog drift exceeds 1e-6 on long runs | Phase 5 fallback: switch to 4th-order Hermite integrator (still pure-functional) |
| Literate tooling is too ambitious for one pass | Phase 8 can be split: ship Tangle first, defer Weave to a v1.1 |

---

## 6. Definition of Done

The project is "scientifically complete" when:

1. ✅ Kepler two-body preserves eccentricity to 1e-6 over 10 orbits
2. ✅ Energy drift < 1e-6 over 1000 steps for Plummer sphere (1k bodies)
3. ✅ Fold + Double RLE benchmark beats brute force by ≥5x at N=10k
4. ✅ `nbody.lit.md` tangles to compilable source, weaves to readable HTML
5. ✅ All phases documented; results reproducible from `git clone` → `sbt test` → green

---

## 7. Phase 11 — Publication & Handoff Package (post-DoD extension)

**Goal:** Turn the simulation library into a handoff-ready commercial artifact, with programmatic project introspection, a canonical release manifest, and onboarding documentation for downstream maintainers.

**Deliverables:**
- `Manifest.scala` — walks `src/main/scala`, computes SHA-256 of every file, reads git state via `ProcessBuilder`, captures JDK/Scala/sbt versions, produces a `sourceHashSha256` tamper seal (SHA-256 of the concatenation of all file hashes).
- `ReleaseArtifact.scala` — serializes `ProjectInfo` to/from JSON using the Phase 2 `Json` AST. Round-trip property: `parse ∘ render = identity`.
- `Phase11Demo.scala` — 54 self-checks covering manifest collection, determinism, JSON round-trip, file existence, zero-dep audit, doc anchors, and persisted `results/manifest.json`.
- `HANDOFF.md` — 8-section maintainer onboarding (~5,200 words): Overview, Architecture, Build & Run, Verification, Extending, Limitations, Commercial Deployment, Maintenance Checklist.
- `RELEASE_NOTES.md` — v1.0.0 release notes summarizing all 11 phases and DoD criteria closure.

**Verification:** `Manifest.collect` is deterministic (collect twice → identical seal). `results/manifest.json` is the canonical supply-chain audit artifact.

---

## 8. Phase 12 — Zero-Dependency Web Tier (post-DoD extension)

**Goal:** Expose the N-Body simulation API over HTTP using only JDK 21 primitives, preserving Pillar 1 (Zero-Dependency Sovereignty). This complements the Next.js control plane from commit `0ccefc3` with a Scala-native tier that requires zero external runtime dependencies.

**Deliverables:**
- `Database.scala` — file-backed relational store using `java.io.RandomAccessFile` + `java.util.concurrent.ConcurrentHashMap`. Three tables: `systems(id, name, createdAt, dt, softening, steps)`, `bodies(id, systemId, mass, x, y, z, vx, vy, vz)`, `trajectories(id, systemId, step, x, y, z, vx, vy, vz, energy)`. Each row is one JSON line + tab + SHA-256 hex digest of the line — tamper-evident storage. On `open()` the log is replayed into an in-memory index for O(1) reads.
- `Middleware.scala` — `type Middleware = Handler => Handler` (function composition, reuses Phase 1 Applicative). Provides: `logging` (structured per-request line), `cors` (Access-Control-Allow-* headers), `preflight` (OPTIONS short-circuit), `auth` (HMAC-SHA-256 request signing, RFC 2104 construction with `MessageDigest` — no `javax.crypto.Mac`), `errors` (catches exceptions → 500 JSON), `jsonBody` (parses request body via Phase 2 `JsonParser`), `rateLimit` (per-IP token bucket, lazy refill, no background thread).
- `Routes.scala` — REST handlers wiring DB ↔ Phase 5 `Simulator.stepBodies` ↔ Phase 2 `JsonParser` AST. Endpoints: `GET /api/health`, `GET /api/systems`, `POST /api/systems`, `GET /api/systems/:id`, `POST /api/systems/:id/step`, `GET /api/systems/:id/trajectories`, `DELETE /api/systems/:id`, `GET /` (frontend). Includes path routing dispatcher.
- `Frontend.scala` — single-file HTML/JS frontend (no React/Vue/Tailwind). Two `<canvas>` elements: trajectory x-y projection + energy drift chart. Audit log panel with timestamped entries. `fetch()` calls every API endpoint. Auto-scales trajectory plot, marks start (green) + end (red).
- `Server.scala` — `com.sun.net.httpserver.HttpServer` wrapper. Translates `HttpExchange` ↔ `Request`/`Response` model. 8-thread pool executor. Middleware applied once at server setup (Express.js "app-level middleware" pattern).
- `Phase12Demo.scala` — 61 self-checks across 7 sections: Database (insert/read/persist/SHA-256/tamper-detection/reopen), Middleware (chain composition/auth/rate-limit/errors/jsonBody), JSON codec (Body↔Json round-trip), Routes (all 7 endpoints + 404), End-to-end HTTP (`java.net.http.HttpClient` against a live server), Frontend proof (HTML contains all expected elements), Persistence (close + reopen). Includes a visible end-to-end demo output that proves every frontend UI element pulls data through middleware → routes → DB → Phase 5 engine.
- Phase 2 enhancement: `JsonParser.scala` retrofitted with `JNum(Double)` AST variant + `numberP` parser for standard JSON float support. The original `intP` only handled integer literals, which blocked real HTTP clients (browser fetch, curl) that send `0.01` or `-1.5` as number literals. This is a justified Phase 12 fix surfaced by the web tier use case.

**Verification:** `sbt "runMain nbody.Phase12Demo"` — 61/61 self-checks pass. End-to-end demo starts a real HTTP server on a random port, creates a system, steps 200 KDK leapfrog iterations, fetches trajectories, and serves the frontend HTML. All requests go through the full middleware chain.

**Architecture reuse:**
- Phase 0: `Body`, `Mass`, `Vec3` — domain types serialized to/from JSON
- Phase 1: Function1's Applicative composition — the algebraic basis for `Middleware.chain`
- Phase 2: `Json` AST + `JsonParser` — request/response body encoding (extended with `JNum`)
- Phase 5: `Simulator.stepBodies` — the actual physics engine invoked by `POST /api/systems/:id/step`
- Phase 11: `MessageDigest.getInstance("SHA-256")` pattern — reused for row integrity tags and HMAC request signing

### Phase 12.b — Static GitHub Pages Demo (public-facing endpoint)

**Goal:** Provide a permanent, clickable, zero-install URL where anyone in the world can observe the demo and play with the features. Served by GitHub Pages from the `main` branch's `/docs` folder. No backend server — the entire full-stack round-trip runs in the browser.

**Why a static port:** GitHub Pages only serves static files (no Node.js runtime for the Next.js control plane, no JVM for the Scala backend). To meet the "always have an endpoint where folks with interest should be able to observe the demo" requirement, the Phase 12 web tier is ported 1:1 to vanilla JS so it runs entirely client-side. This is **not** a replacement for the Scala/Next.js backends — it's the public storefront for the same architecture.

**Deliverables (in `/docs/` at repo root):**
- `index.html` — UI shell: header with live health stats (uptime, system/body/snapshot/audit counts, middleware layer count), config panel (name/dt/softening/generator/N/seed/bodies JSON/API key), step panel (system id/steps/sample), audit log panel, trajectory canvas (x-y projection), energy drift canvas, middleware chain visualization, last-response `<pre>`, footer with repo links.
- `styles.css` — dark theme mirroring the Scala `Frontend.scala` palette (#0b1021 bg, #3b5bdb accent, #8aa3ff secondary, monospace for log/pre). Sticky header, responsive grid (collapses to single column under 900px).
- `db.js` — IndexedDB wrapper. 4 object stores (`Simulation`, `Body`, `Snapshot`, `ApiAudit`) mirroring the Prisma schema. Auto-incrementing IDs with monotonic counter. Cascade delete via cursor iteration. `dbGet/dbAll/dbWhere/dbInsert/dbPut/dbDelete/dbDeleteWhere/dbCount/dbClearAll` primitives.
- `physics.js` — `MutableBodySystem` class. Parallel `Float64Array` storage for mass/pos/vel/acc. `computeAccelerations` (O(N²) brute force, Newton's third law symmetry), `step` (leapfrog KDK), `totalEnergy` (K+U with Plummer softening), `momentumMagnitude`, `angularMomentumMagnitude`, `snapshot`. Three initial-condition generators: `plummerSphere` (Aarseth 1974 simplified), `lattice` (cubic), `twoBody` (circular Kepler). `mulberry32` seeded RNG.
- `middleware.js` — 6-layer middleware chain: `errorHandler` (try/catch → 500 JSON), `requestLogger` (FNV-1a IP hash, latency tracking, IndexedDB audit insert, `nbody:audit` CustomEvent for live UI), `authGate` (write methods require non-empty `x-api-key`, constant-time compare via XOR), `jsonBody` (parses JSON body string), `corsHandler` (Access-Control-Allow-* headers, OPTIONS short-circuit), `dispatcher` (injected by routes.js). `compose(middlewares, handler)` reduces right-to-left.
- `routes.js` — 8 REST endpoints: `GET /api/health`, `GET /api/simulations`, `POST /api/simulations`, `GET /api/simulations/:id`, `DELETE /api/simulations/:id`, `POST /api/simulations/:id/step`, `GET /api/simulations/:id/snapshots`, `GET /api/audit`. Pattern-match dispatcher with `:param` extraction. Each handler reads/writes IndexedDB and returns a synthetic `Response` object (compatible with `fetch()` shape).
- `app.js` — DOM wiring. `window.fetch` shim intercepts `/api/*` calls and routes them through the middleware chain → dispatcher → IndexedDB; all other fetches (static assets) hit the network normally. Health poll every 4s. Audit panel listens for `nbody:audit` CustomEvents. Canvas rendering: trajectory (per-body colored line, green start marker, red end marker, auto-scaled) + energy drift (grid lines, min/max labels, drift label). API key persisted in `localStorage`. System id validation (green border if exists, red if not).
- `README.md` — architecture diagram + try-it guide + tier-by-tier Scala↔JS mapping table.

**Verification:** `node /home/z/my-project/scripts/smoke-test.js` — 5/5 PASS:
  1. Two-body Kepler energy drift = 2.3e-10 after 1000 steps (symplectic integrator correct)
  2. Plummer sphere momentum magnitude bounded (5.2e-16 drift over 100 steps)
  3. FNV-1a hash deterministic and distinct per input
  4. `safeEqual` constant-time string compare correct
  5. `redactKey` keeps only last 4 chars

**Deployment:**
1. Commit `/docs/` folder to `main` branch.
2. Push to GitHub.
3. Enable GitHub Pages via API: `POST /repos/{owner}/{repo}/pages` with `{"source":{"branch":"main","path":"/docs"}}`.
4. Live URL: `https://testdemoqwenai2025-creator.github.io/testdemo2025qwenai-creator/`

**Architecture reuse (static port):**
- Phase 5 physics: 1:1 vanilla-JS port of `MutableKDK.scala` — same `Float64Array` storage, same KDK step structure, same Plummer softening.
- Phase 12 Scala web tier: same middleware composition pattern (`Handler => Handler`), same route table, same DB schema (4 tables → 4 object stores).
- Phase 11 Next.js control plane: same `src/middleware.ts` shape (FNV-1a IP hash, redactKey, safeEqual), same Prisma schema → IndexedDB store layout.

**Standing directives (apply to all future phases):**
1. **Update `skills.md` every phase** — keep this file synchronized with each new phase's spec.
2. **GitHub push with every phase improvement** — automatic, no announcement needed.
3. **Demo with frontend-visible output** — confirm the demo communicates with all components of the full stack (frontend ↔ middleware ↔ backend ↔ database), observable on the public GitHub Pages URL.
4. **Each stage suggests what other modifications or improvements could be considered** — forward-looking recommendations appended to each phase.
