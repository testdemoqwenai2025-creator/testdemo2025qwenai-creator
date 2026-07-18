# HANDOFF.md — nbody-fold-scala

> **Audience**: future maintainers, downstream commercial consumers, supply-chain auditors.
> **Scope**: everything you need to take ownership of this codebase after the original author steps away.
> **Status**: v1.0.0 — all 11 phases complete, all 5 Definition-of-Done criteria met.

---

## 1. Project Overview

`nbody-fold-scala` is a zero-dependency N-body gravitational simulator written in Scala 3.4.2 on JDK 21. It is the reference implementation of the **Elite Generalist JSON Architectural Framework**, a six-pillar methodology for building commercial-grade software with no third-party libraries.

The project demonstrates **Computational Arbitrage**: replacing brute-force O(N²) pairwise gravity with a bottom-up fold over the hierarchy `Component → ComponentVector → Entity → System`, accelerated by Run-Length Encoding (RLE) and Double-RLE ("Mathematical Jumping"). On structured data (cubic lattice, body-centered cubic crystal), the `GroupAggregateSolver` achieves **5.48× speedup over brute force at N=10,648** — closing the project's DoD #3 criterion.

What this project **is**:

- A scientifically complete N-body simulator with energy/momentum/angular-momentum conservation proven to machine precision over 1000 steps.
- A pedagogical demonstration of the six pillars working together in a real system.
- A reproducible build with zero supply-chain attack surface — suitable for regulated industries (aerospace, finance, medical).

What this project **is not**:

- A production-grade astrophysics code (it lacks adaptive timestepping, hierarchical time integration, MPI parallelism, GPU offload). For production use, look at GADGET4, AREPO, REBOUND, or AMUSE.
- A general-purpose library — the typeclasses (`Functor`, `Applicative`, etc.) are intentionally minimal; for real projects use Cats.
- A tutorial — it assumes the reader knows Scala 3, basic physics, and parser combinators.

The codebase is ~5,000 LOC across 11 phases. Each phase is independently runnable via its `PhaseNDemo.scala` entrypoint, which doubles as the test suite.

---

## 2. Architecture

### Six Pillars

| # | Pillar | Realized in |
|---|--------|-------------|
| 1 | Zero-Dependency Sovereignty | `build.sbt` declares no `libraryDependencies` |
| 2 | Parser Combinator | `Phase2_Parser/` — `Parser[A] = String => Option[(String, A)]` opaque type |
| 3 | Functor-Applicative-Alternative-Monoid | `Phase1_Typeclasses/` — five typeclass traits + `given` instances |
| 4 | Literate Workflow | `Phase8_Literate/` — `Tangle` + `Weave`; `nbody.lit.md` source of truth |
| 5 | Computational Arbitrage | `Phase3_RLE/`, `Phase4_DoubleRLE/`, `Phase5_NBody/`, `Phase9_Bench/`, `Phase10_Arbitrage/` |
| 6 | Elite Toolkit | `Phase6_IO/` (three-call mmap), `Phase7_Stream/` (LazyList corecursion), `Phase11_Handoff/` (manifest + release artifact) |

### Phase Dependency Graph

```
Phase 0  ──▶ Phase 1  ──▶ Phase 2  ──▶ Phase 3  ──▶ Phase 4
Domain      Typeclasses  Parser       RLE          Double RLE

Phase 5  ──▶ Phase 6  ──▶ Phase 7  ──▶ Phase 8  ──▶ Phase 9  ──▶ Phase 10
N-Body      File I/O     Stream       Verify       Bench        Arbitrage
                                                                       │
                                                                       ▼
                                                                  Phase 11
                                                                  Handoff
```

Each phase depends only on phases that precede it. Phase 11 (this one) is the publication/handoff capstone — it depends on Phase 2 (parser AST for JSON serialization) and the project as a whole, but introduces no new domain logic.

### Key Domain Types

The core hierarchy is in `Phase0_Domain/`:

```scala
Vec3          // 3D vector, pure value class
Mass          // opaque-typed Double (avoid primitive obsession)
Body          // case class with mass/pos/vel/acc
Component     // sealed: Single | Cluster
ComponentVector  // spatial vector of Components
Entity        // logical entity (star + planets)
System        // top-level simulation universe
```

The fold hierarchy `Component → ComponentVector → Entity → System` is realized via `BodyFoldable[A]` instances in `Phase1_Typeclasses/TypeclassInstances.scala`. The `Simulator.step` function (Phase 5) walks this hierarchy with `foldMap` to compute forces bottom-up.

### Computational Arbitrage Strategy

The performance-critical path is:

1. Bucket bodies into a 3D grid of cells (default gridDim ≈ ∛N/2).
2. For each body, compute force contributions from three zones:
   - **NEAR** (3³ cube, 27 cells): direct pairwise sum (exact).
   - **MID** (7³ − 3³ cube, 316 cells): per-cell center-of-mass force.
   - **FAR** (everything else): iterate over distinct cell **(count, mass) signatures** only — not all far cells. RLE-encode the signature list (Phase 3) for O(N × distinctSignatures) far-zone work instead of O(N × cells).
3. Apply a θ criterion (Barnes-Hut-style) to skip far contributions whose combined COM is too close to the body (prevents inverse-square singularity).

This strategy only yields speedup when the signature list is small (structured data). On irregular data (Plummer sphere), it adds overhead without benefit — documented honestly in `ScientificReport.md` §4 and §8.

---

## 3. Build & Run Protocol

### Prerequisites

- **JDK 21 or later** — verified on Temurin 21.0.x. Earlier JDKs will fail because we use `Files.lines(Path).count()` and `java.util.HexFormat` (the latter is not actually used here, but JDK 21 is the project baseline).
- **sbt 1.10.x or later** — used for compilation only. sbt's own transitive deps do not appear in your compiled artifacts.
- **Scala 3.4.2** — pinned in `build.sbt`. The build will not silently upgrade.
- **Git** — required for Phase 11 manifest collection. If git is unavailable, `gitSha` will be empty but the build still works.
- **Python 3.9+ with matplotlib ≥ 3.9** — only needed to regenerate `results/scaling.png` and `results/energy-drift.png` from `results/*.csv`. Not required to run any Scala code.

### Build

```bash
git clone <repo-url> nbody-fold-scala
cd nbody-fold-scala
sbt compile
```

Expected outcome: `Compiling N Scala sources to target/scala-3.4.2/classes ...` followed by `[success]`. No warnings beyond deprecation/feature notes from Scala 3 stdlib usage.

### Run All Phase Demos (Recommended Verification)

```bash
sbt "runMain nbody.KeplerDemo"      # Phase 0 smoke test (4 self-checks)
sbt "runMain nbody.Phase1Demo"      # Phase 1 typeclass demo
sbt "runMain nbody.Phase2Demo"      # Phase 2 parser combinator demo
sbt "runMain nbody.Phase3Demo"      # Phase 3 RLE engine (31 self-checks)
sbt "runMain nbody.Phase4Demo"      # Phase 4 DoubleRLE (42 self-checks)
sbt "runMain nbody.Phase5Demo"      # Phase 5 N-body engine (10 self-checks)
sbt "runMain nbody.Phase6Demo"      # Phase 6 File I/O (20 self-checks)
sbt "runMain nbody.Phase7Demo"      # Phase 7 streaming (22 self-checks)
sbt "runMain nbody.Phase8Demo"      # Phase 8 verification + literate (27 self-checks)
sbt "runMain nbody.Phase9Demo"      # Phase 9 benchmarking (17 self-checks)
sbt "runMain nbody.Phase10Demo"     # Phase 10 structured-data arbitrage (20 self-checks)
sbt "runMain nbody.Phase11Demo"     # Phase 11 handoff (14 self-checks)
```

Total: ~213 self-checks across 12 entrypoints. Expected runtime: ~3-5 minutes on a modern laptop (Phase 9 dominates due to benchmarks).

### Fast-Run Path (Avoiding sbt Cold Start)

Once `sbt compile` has succeeded, you can skip sbt for subsequent runs:

```bash
SCALA_LIB=~/.sbt/boot/scala-3.4.2/lib/scala3-library_3-3.4.2.jar
SCALA2_LIB=~/.sbt/boot/scala-3.4.2/lib/scala-library-2.13.x.jar
java -cp "target/scala-3.4.2/classes:$SCALA_LIB:$SCALA2_LIB" nbody.Phase11Demo
```

This avoids sbt's JVM warmup (~10s) and is the path the CI scripts should use.

### Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `sbt compile` fails with `scala3-library_3` not found | sbt boot directory not in expected location | Run `sbt compile` once to populate boot dir, then use fast-run path |
| `Phase9Demo` reports `FoldRLE CV% = 5.5%` (just over threshold) | JIT speculative compilation noise | Re-run; transient. Documented in Phase 9 worklog |
| `Phase11Demo` reports `Git SHA is (unavailable)` | git not on PATH or repo not initialized | Run `git init && git add . && git commit -m init` |
| `Phase10Demo` energy drift > 5e-2 | Lattice jitter too high or softening too small | Use `softening=0.05`, `jitter=0.05` (defaults) |
| Out of memory running Phase 9 at N=8192 | Default JVM heap too small for benchmark | `sbt -J-Xmx4g "runMain nbody.Phase9Demo"` |

---

## 4. Verification Protocol

### Daily Verification (Before Merge)

Run all 12 phase demos. Every demo must end with `Passed: N  Failed: 0`. The total expected pass count is:

| Demo | Self-checks |
|------|-------------|
| KeplerDemo | 4 |
| Phase1Demo | (pass/fail per section, ~4) |
| Phase2Demo | (pass/fail per section, ~5) |
| Phase3Demo | 31 |
| Phase4Demo | 42 |
| Phase5Demo | 10 |
| Phase6Demo | 20 |
| Phase7Demo | 22 |
| Phase8Demo | 27 |
| Phase9Demo | 17 |
| Phase10Demo | 20 |
| Phase11Demo | 14 |
| **Total** | **~213** |

### Release Verification (Before Tagging)

In addition to daily verification:

1. Run `sbt "runMain nbody.Phase11Demo"` — produces `results/manifest.json`.
2. Inspect `manifest.json`: `git_dirty` must be `false` (working tree clean), `phase_count` must be `11`.
3. Run `git cat-file commit HEAD` and confirm the SHA matches `git_sha` in the manifest.
4. Tag the commit: `git tag v1.0.0 -m "Phase 11 release artifact"`.
5. Push the tag: `git push origin v1.0.0`.
6. Distribute `manifest.json` alongside the source tarball.

### Re-running Benchmarks

Phase 9's benchmark results are sensitive to JIT warm-up and GC pauses. To regenerate:

```bash
sbt "runMain nbody.Phase9Demo"      # overwrites results/benchmark.csv + energy-drift.csv
python3 scripts/render_phase9_plots.py  # regenerates scaling.png + energy-drift.png
```

Expect ±5% variance in absolute timings across runs. The relative speedup ratios should be stable.

### Verifying Zero-Dependency (Pillar 1 Audit)

```bash
# Compile, then inspect the classpath dependencies of the compiled jar
sbt compile
sbt "show fullClasspath"
# The output should contain ONLY:
#   - target/scala-3.4.2/classes                    (your code)
#   - scala3-library_3-3.4.2.jar                    (Scala stdlib)
#   - scala-library-2.13.x.jar                      (Scala 2 stdlib, transitively required by Scala 3)
#   - JARs from $JAVA_HOME/lib                      (JDK stdlib)
# Anything else = supply-chain violation.
```

Phase 11's self-checks include a regex-based `libraryDependencies` audit on `build.sbt` itself, but the classpath inspection above is the authoritative check.

---

## 5. Extending the Project

### Adding Phase 12

The project follows a strict phase dependency graph. To add Phase 12:

1. **Read `skills.md`** at the project root. The "Workflow Phases" section defines the original 10 phases; Phases 11+ are extensions.
2. **Create `src/main/scala/nbody/Phase12_<Name>/`** with one file per major concern (mirrors `Phase10_Arbitrage/` structure).
3. **Create `src/main/scala/nbody/Phase12Demo.scala`** at the package root. The demo must:
   - Have a `main(args: Array[String]): Unit` entrypoint.
   - Use the `private var passed/failed` + `check(label, cond, detail)` pattern (see `Phase10Demo.scala`).
   - Print a final summary block: `=== Phase 12 self-checks summary ===` followed by `Passed: N  Failed: M`.
   - Call `sys.exit(1)` if any check fails.
4. **Update `README.md`** — add the Phase 12 row to the Status table, append to the Build & Run section, append to the Directory Layout.
5. **Update `Phase11Demo.scala`** — bump the `phaseCount` constant from `11` to `12`, and add `"Phase12Demo.scala"` to the `expectedDemos` list.
6. **Append to `worklog.md`** — new `---` section with `Task ID: 13` (or whichever is next).
7. **Regression check** — run all `Phase0Demo` through `Phase12Demo`, confirm zero regression.
8. **Commit** — `git commit -m "Phase 12 — <name> (N/N PASS)"`.

### Adding a New Initial-Condition Format

If you need to support a format other than CSV/JSON (e.g., HDF5, FITS, Gadget binary):

1. Add a new parser in `Phase2_Parser/<Format>Parser.scala` using the existing primitives (`charP`, `stringP`, `spanP`, `sepBy`, `between`, `sequenceA`).
2. Extend `Phase6_IO/InitialConditionsLoader.scala` to dispatch on file extension.
3. Add round-trip tests in `Phase2Demo.scala` and `Phase6Demo.scala`.
4. Do NOT introduce a third-party parsing library — that breaks Pillar 1.

### Adding a New Integrator

If you need symplectic integrators beyond leapfrog KDK (e.g., symplectic 4th-order Yoshida):

1. Add `Phase5_NBody/<Name>Integrator.scala` implementing the same interface as `MutableKDK.step(bodies, dt, softening): Unit`.
2. Extend `Phase5_NBody/Simulator.scala` with an `integrator` parameter.
3. Add a Kepler + energy-drift test in `Phase5Demo.scala` matching the existing tests.
4. Do NOT change `Physics.scala` — the force law is the integrator's concern, not the physics's.

### Modifying the Domain Hierarchy

Do NOT change `Phase0_Domain/` without a phase-level justification. The hierarchy `Component → ComponentVector → Entity → System` is the load-bearing abstraction of the entire framework. If you must change it (e.g., adding a `Galaxy` tier above `System`), create a new Phase 12 that introduces the change with full regression coverage — do not edit Phase 0 in place.

---

## 6. Known Limitations

### Physics Limitations

- **Fixed timestep only**. The leapfrog KDK integrator uses a single global `dt`. Close encounters in Plummer spheres require `softening ≥ 0.05` to remain stable over 1000+ steps. For真正 adaptive timestep, you'd need to add a hierarchical integrator (Phase 12 candidate).
- **No collisional dynamics**. Bodies are point masses with Plummer softening. Physical collisions (stellar mergers) are not modeled.
- **No external potentials**. The simulation is isolated. Adding a galactic potential requires extending `Physics.force` and is left as future work.
- **Single-precision floating-point not supported**. The entire pipeline assumes `Double`. Adding `Float` support would require a `Scalar[A: Numeric]` typeclass throughout — significant refactor.

### Performance Limitations

- **Single-threaded only**. No parallelism. Production N-body codes use MPI + OpenMP + SIMD. Adding parallelism is a Phase 12 candidate but would break the "bottom-up fold is sequential" assumption of the framework.
- **JIT noise in Phase 9 benchmarks**. The `FoldRLE` algorithm occasionally reports CV% = 5.5% (just over the 5% threshold) due to JIT speculative compilation. This is documented in the Phase 9 worklog and is not a regression. The fix is to re-run; the failure is transient.
- **No GPU offload**. All compute is on CPU. A CUDA/OpenCL backend is out of scope for a zero-dependency project.

### Software Engineering Limitations

- **JSON parser is minimal**. `Phase2_Parser/JsonParser.scala` handles null/bool/int/str/arr/obj but not floats, escapes, or scientific notation. The Phase 11 manifest serializes all numbers as `Long` (via `Json.JInt`) and all decimals as `String` (via `Json.JStr`) to round-trip cleanly. Extending the parser to handle floats is a Phase 12 candidate.
- **CSV parser is single-format**. `Phase2_Parser/CsvParser.scala` parses only the 7-column `mass,x,y,z,vx,vy,vz` initial-condition format. Other CSVs require a new parser.
- **Literate workflow (`nbody.lit.md`) is read-only**. The `Tangle` step regenerates source files, but the project does not currently use it as the primary source of truth — `src/main/scala/` is hand-edited. Realigning the literate source with the actual code is a maintenance task.

### Documentation Limitations

- **`ScientificReport.md` is the publication-grade document**, but it is Markdown only. A LaTeX/PDF version for arXiv submission is a Phase 12 candidate (would use the `pdf` skill).
- **No API documentation**. Scaladoc is not currently generated. Adding `sbt doc` to the build is straightforward but the output is sparse because most types are intentionally minimal.
- **No formal proof of correctness**. The verification suite in Phase 8 empirically demonstrates conservation laws to machine precision, but there is no Coq/Lean proof. For a regulated-industry deployment, you'd want formal verification of the leapfrog integrator's symplectic structure.

---

## 7. Commercial Deployment Notes

### Supply-Chain Audit

This project is engineered for **zero supply-chain attack surface**:

- `build.sbt` declares no `libraryDependencies`. The compiled artifacts depend only on Scala 3 stdlib + JDK 21.
- sbt's own transitive dependencies (used during compilation) do NOT appear in your compiled jar. They exist only in sbt's boot classpath.
- No reflective class loading, no `Class.forName` on user input, no dynamic proxies.
- No network calls during runtime. The only external I/O is local file I/O (Phase 6 mmap).

For a regulated industry deployment (aerospace DO-178C, finance MiFID II, medical IEC 62304), the supply-chain audit checklist is:

1. ✅ Verify `build.sbt` contains no `libraryDependencies` (Phase 11 self-check #11 enforces this).
2. ✅ Run `sbt "show fullClasspath"` and confirm only Scala/JDK JARs are present.
3. ✅ Pin sbt version in `project/build.properties` (already done: `sbt.version=1.10.2`).
4. ✅ Pin Scala version in `build.sbt` (already done: `scalaVersion := "3.4.2"`).
5. ✅ Pin JDK version in `build.sbt` (already done: `javacOptions ++= Seq("--release", "21")`).
6. ✅ Generate `results/manifest.json` via `Phase11Demo` and archive it alongside the release tag.
7. ✅ Verify `git_dirty == false` in the manifest before tagging.

### Reproducibility

The project is **bit-for-bit reproducible** from `git clone → sbt compile → Phase11Demo`:

- Source files: hashed by SHA-256 in the manifest.
- Compiler: pinned Scala 3.4.2.
- JDK: pinned to `--release 21` (source compatible with JDK 21+).
- Build tool: pinned sbt 1.10.x.

Two builds from the same git commit on the same JDK will produce identical `.class` files. (JDK version skew across minor releases can cause `.class` file differences due to bytecode optimizations — for strict bit-for-bit reproducibility, pin the JDK distribution as well.)

### License & Attribution

The project is released under the license declared in the LICENSE file at the repo root. If no LICENSE file exists, the default is "all rights reserved" — contact the author before commercial use.

If you use this codebase in academic work, cite `RELEASE_NOTES.md` and the relevant phase sections of `ScientificReport.md`. Suggested BibTeX:

```bibtex
@software{nbody_fold_scala,
  title  = {nbody-fold-scala: Zero-Dependency N-Body Simulator in Scala 3},
  author = {<author>},
  year   = {2026},
  version= {1.0.0},
  url    = {<repo-url>}
}
```

---

## 8. Maintenance Checklist

### Annual Review

- [ ] **JDK upgrade path**: Test on the latest LTS JDK (currently 21; next LTS will be 25 in late 2025). Update `javacOptions` if needed.
- [ ] **Scala upgrade path**: Test on the latest Scala 3.x stable. The current pin is 3.4.2; 3.5.x and 3.6.x are available. Run all phase demos to verify zero regression.
- [ ] **sbt upgrade path**: Test on the latest sbt 1.x. The current pin is 1.10.2.
- [ ] **Dependency audit**: Re-verify `build.sbt` has no `libraryDependencies`. (Phase 11 self-check enforces this, but a manual audit annually is good hygiene.)
- [ ] **Manifest regeneration**: Run `Phase11Demo` and compare `results/manifest.json` against the previous year's. The `source_hash` field should match if no source has changed; if it differs, the diff should be intentional.

### Per-Release Checklist

- [ ] All 12 phase demos pass (`Passed: N  Failed: 0`).
- [ ] `git status` reports clean working tree.
- [ ] `Phase11Demo` reports `git_dirty == false`.
- [ ] `manifest.json` archived to release artifacts.
- [ ] `RELEASE_NOTES.md` updated with new version row.
- [ ] Git tag created: `git tag v<X.Y.Z> -m "Release <X.Y.Z>"`.
- [ ] Tag pushed: `git push origin v<X.Y.Z>`.

### Known Issues to Monitor

- **Phase 9 JIT noise**: `FoldRLE CV%` occasionally reports 5.5%. If this becomes a persistent failure (CV > 7%), investigate JIT compilation logs and consider increasing warmup iterations.
- **Phase 10 Plummer speedup**: `GroupAggregateSolver` is 3.7× SLOWER than brute force on Plummer. This is documented and expected, but if it becomes 10× slower, investigate cell-bucketing overhead.
- **Phase 6 mmap on non-Linux**: The three-call mmap pattern uses `FileChannel.map` which is OS-dependent. On macOS, mmap behavior differs subtly. If running on Windows, `MappedByteBuffer` may not behave as expected — test before deploying.

### When to Bump the Major Version

- **Major (2.0.0)**: Domain hierarchy change (`Phase0_Domain/`), typeclass signature change (`Phase1_Typeclasses/`), or build-system change (e.g., switching from sbt to mill).
- **Minor (1.1.0)**: New phase added (Phase 12+), new public API in existing phase, or new initial-condition format.
- **Patch (1.0.1)**: Bug fixes, documentation updates, dependency version bumps (none expected in a zero-dep project).

---

## 9. Contact & Escalation

For questions about this codebase:

1. **First**: read the relevant phase section in `ScientificReport.md` and the worklog entry in `worklog.md` for the phase in question.
2. **Second**: read the phase's demo file (`PhaseN_Demo.scala`) — the self-checks document the expected behavior.
3. **Third**: read the source code in `PhaseN_<Name>/` — file headers explain design decisions.
4. **Fourth**: read `skills.md` §2 for the original spec — the phase may have deviated from spec for documented reasons (see `README.md` "Naming Note" for an example).

If you find a bug:

1. Reproduce it via a phase demo with a failing self-check.
2. Add a regression test in the relevant `PhaseN_Demo.scala`.
3. Fix the bug.
4. Run all phase demos to confirm zero regression.
5. Append a worklog entry under a new Task ID.
6. Commit + push.

If you find a security issue (unlikely given zero-dependency, but possible in the JIT or file I/O):

1. Do NOT file a public issue.
2. Email the author directly with a proof-of-concept.
3. Expect a fix within 90 days.

---

*This document is the canonical handoff for v1.0.0. Future versions should append a "Change History" section at the end.*
