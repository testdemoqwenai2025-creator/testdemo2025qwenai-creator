# nbody-fold-scala

Zero-dependency N-body gravitational simulator in Scala 3, demonstrating the **Elite Generalist** framework's **Computational Arbitrage** pillar: replacing brute-force O(N²) pairwise computation with a bottom-up fold over the hierarchy **Component → ComponentVector → Entity → System**, accelerated by Double Run-Length Encoding ("Mathematical Jumping") to achieve O(log N) per-step on structured inputs.

> Workflow plan: see [`../skills.md`](../skills.md) for the full 10-phase design document.

## Status

| Phase | Status | Notes |
|-------|--------|-------|
| 0 — Domain Modeling | ✅ Scaffolded | `Vec3`, `Mass`, `Body`, `Component`, `ComponentVector`, `Entity`, `System` |
| 1 — Typeclass Foundations | ⏳ Pending | `Functor`, `Applicative`, `Alternative`, `Monoid`, `Foldable` |
| 2 — Parser Combinator | ⏳ Pending | Scala port of `ParserCombinator.hs` |
| 3 — RLE Engine | ⏳ Pending | encode / decode / `RLEIndex` |
| 4 — Double RLE | ⏳ Pending | Two-level RLE + `JumpIndex` |
| 5 — N-Body Engine | ⏳ Pending | Leapfrog integrator + bottom-up force fold |
| 6 — File I/O (Three-Call) | ⏳ Pending | `FileChannel.open` → `size()` → `map(READ_ONLY, …)` |
| 7 — Corecursion & Streaming | ⏳ Pending | `LazyList.iterate` of `System` states |
| 8 — Verification & Literate | ⏳ Pending | Tangle / Weave + conservation tests |
| 9 — Benchmarking | ⏳ Pending | Brute vs. fold vs. RLE vs. Double-RLE |

## Zero-Dependency Policy

- **Compile / runtime classpath:** Scala 3 stdlib + JDK 21 only. No Cats, no Spire, no Akka, no JMH.
- **Build tool:** sbt (used for compilation only; sbt's own transitive deps do not appear in your compiled artifacts).
- If you ever add a `libraryDependencies` entry, you are breaking Pillar 1 (Zero-Dependency Sovereignty). Document the justification in `skills.md` first.

## Build & Run

```bash
# Requires: JDK 21+, sbt 1.10+, Scala 3.4+
sbt compile

# Run the Phase 0 smoke test (two-body Kepler setup, prints diagnostics)
sbt "runMain nbody.KeplerDemo"

# Run the Phase 0 test suite
sbt "Test/runMain nbody.Phase0_Domain.DomainModelSpecRunner"
```

## Directory Layout

```
nbody-fold-scala/
├── build.sbt                                  ← Zero-dependency Scala 3 build
├── project/build.properties                   ← sbt version pin
├── .gitignore
├── README.md                                  ← This file
├── src/
│   ├── main/scala/
│   │   ├── nbody/
│   │   │   ├── KeplerDemo.scala               ← Phase 0 smoke test entrypoint
│   │   │   └── Phase0_Domain/
│   │   │       ├── Vec3.scala                 ← 3D vector
│   │   │       ├── Mass.scala                 ← opaque-typed mass newtype
│   │   │       ├── Body.scala                 ← single physical body
│   │   │       ├── Component.scala            ← Single | Cluster (sealed)
│   │   │       ├── ComponentVector.scala      ← spatial vector of Components
│   │   │       ├── Entity.scala               ← logical entity
│   │   │       └── System.scala               ← top-level simulation universe
│   └── test/scala/nbody/Phase0_Domain/
│       └── DomainModelSpec.scala              ← Hand-rolled tests (no test framework)
├── data/                                      ← Initial-condition CSVs (Phase 6 populates)
└── results/                                   ← Benchmark outputs (Phase 9 populates)
```

## Naming Note

The workflow document (`skills.md`) suggested `Vector3D.scala` for the second tier of the hierarchy. We renamed it to `ComponentVector.scala` to eliminate the confusing overlap with `Vec3` (the 3D vector type). The framework's own principle of literate clarity justifies the rename.

## Framework Pillar Coverage

| Pillar | How this project realizes it |
|--------|------------------------------|
| 1. Zero-Dependency | `libraryDependencies := Nil` in `build.sbt` |
| 3. Math Abstractions | (Phase 1) custom `Functor`/`Applicative`/`Alternative`/`Monoid`/`Foldable` traits |
| 4. Literate Workflow | (Phase 8) `nbody.lit.md` → `Tangle.scala` + `Weave.scala` |
| 5. Computational Arbitrage | (Phase 3-5) RLE → Double RLE → bottom-up force fold |
| 6. Elite Toolkit | (Phase 6) Three-Call mmap, (Phase 7) `LazyList` corecursion, (Phase 0) Zero-Initialization-Rule-compliant `Body.Zero` |

## Definition of Done

Tracked in [`../skills.md` §6](../skills.md). The project is "scientifically complete" when:
1. Kepler two-body preserves eccentricity to 1e-6 over 10 orbits
2. Energy drift < 1e-6 over 1000 steps on a 1k-body Plummer sphere
3. Fold + Double RLE beats brute force by ≥5× at N=10k
4. `nbody.lit.md` tangles to compilable source AND weaves to readable HTML
5. `git clone` → `sbt test` → green, reproducibly
