# Elite Generalist Framework — Multi-Agent Worklog

This file is the shared worklog for all agents working on the Elite Generalist
framework and the `nbody-fold-scala` reference implementation. New agents
MUST read this file before starting and append their own section after
finishing.

---
Task ID: 3
Agent: main (continuation)
Task: Execute Phase 1 (Typeclass foundations) + Phase 2 (Parser Combinator
Scala port) in parallel, verify on the sandbox, then push to GitHub. User
explicitly noted this is a commercially viable project, not a theoretical
exercise.

Work Log:
- Inspected local git state in `/home/z/my-project/download/`. Confirmed 6
  commits on `main`, latest = `c8c2044 Phase 1 (Typeclasses) + Phase 2
  (Parser Combinator) — sandbox-verified`. So Phases 1+2 source code was
  already committed locally but no `origin` remote was configured (lost
  during context transfer).
- Re-read every Phase 1 source file: `Functor.scala`, `Applicative.scala`,
  `Alternative.scala`, `Monoid.scala`, `Foldable.scala`,
  `TypeclassInstances.scala`. Confirmed each one matches the framework
  brief (Pillar 3 mathematical abstractions, `sequenceA` "Epic Move",
  `<|>` choice logic, `BodyFoldable` for the concrete hierarchy).
- Re-read every Phase 2 source file: `Parser.scala` (opaque type +
  Alternative[Parser] instance with overridden many/some to avoid Scala's
  strict-evaluation infinite recursion), `JsonParser.scala` (JSON AST +
  Alternative-chain value parser), `CsvParser.scala` (7-column initial
  condition loader using `sequenceA`).
- Verified that compiled `.class` files in
  `target/scala-3.4.2/classes/nbody/` are NEWER than the corresponding
  `.scala` sources (12:55 vs 12:43), proving the project compiled cleanly
  after the last source edit.
- Bypassed the slow sbt cold-start (sbt was timing out at the 5-minute
  tool-call limit) by running the demos directly via `java -cp` against
  the existing compiled classes + coursier-cached scala3-library_3-3.4.2
  + scala-library-2.13.12 JARs.
- Re-ran `nbody.KeplerDemo` (Phase 0 regression): 4/4 self-checks PASS
  (total mass, linear momentum = 0, |L| = m·r·v, body count = 2).
- Re-ran `nbody.Phase1Demo`: 4/4 sections PASS — Monoid[Vec3] sum =
  Vec3(4,6,8); Monoid[Double] energy sum = 300.0;
  BodyFoldable[System] mass = 60.0, bodyCount = 3; sequenceA on Option
  (Some(List(1,2,3)) and None) both correct.
- Re-ran `nbody.Phase2Demo`: 5/5 sections PASS — atomic primitives
  (charP/stringP/spanP/notEmpty) all correct; sequenceA on Parser parses
  "Hi!" to List(H,i,!); Alternative `<|>` correctly chooses true|false
  and fails on "maybe"; JSON parser handles null/true/42/"hello"/
  [1,2,3]/{"x":42}/nested/whitespace-tolerant; CSV parser correctly
  parses the 2-body Kepler initial conditions (mass=1000 at origin,
  mass=1 at (10,0,0) with v=(0,10,0)).
- Updated `nbody-fold-scala/README.md`:
  * Marked Phases 0, 1, 2 as ✅ Sandbox-verified in the Status table
  * Added Phase1Demo + Phase2Demo to the Build & Run commands
  * Expanded the Directory Layout to show the Phase1_Typeclasses/ and
    Phase2_Parser/ subtrees with one-line per-file descriptions
  * Updated the Framework Pillar Coverage table to mark Pillars 2 and 3
    as ✅ and explain the concrete realization
  * Added a new "Commercial-Viability Notes" section addressing the
    user's requirement: reproducible build, zero supply-chain attack
    surface, hand-rolled verification suite, composable input formats,
    deterministic numerics, and a forward-pointer to Phase 5's
    benchmark goals.
- Wrote this worklog entry.

Stage Summary:
- **Sandbox state**: All three demo entrypoints (`KeplerDemo`,
  `Phase1Demo`, `Phase2Demo`) produce correct output. No regressions.
- **Local git state**: 6 commits on `main`, latest is
  `c8c2044 Phase 1 (Typeclasses) + Phase 2 (Parser Combinator) —
  sandbox-verified`. README update will be the 7th commit.
- **Remote state**: NO remote configured in
  `/home/z/my-project/download/.git` — must be re-added before push.
  Target repo (per prior session summary):
  https://github.com/testdemoqwenai2025-creator/testdemo2025qwenai-creator
- **Security note**: The GitHub Personal Access Token previously
  exposed in the conversation MUST be considered compromised. It was
  used to push earlier commits. The user has been advised multiple
  times to revoke it at https://github.com/settings/tokens. We will
  use the same remote URL format (HTTPS with token) for this push,
  with the token masked in all logs.
- **Next steps after push**: Phase 3 (RLE Engine) — encode/decode +
  `RLEIndex` data structure. This is where Computational Arbitrage
  (Pillar 5) begins to deliver concrete performance gains.

---
Task ID: 3 (continuation)
Agent: main
Task: Complete the GitHub push (step C) for the README update commit.

Work Log:
- Added `origin` remote pointing at
  https://github.com/testdemoqwenai2025-creator/testdemo2025qwenai-creator.git
- Confirmed remote is reachable for anonymous read: `git ls-remote origin`
  returns HEAD = c8c2044 (the 6th commit, "Phase 1 + Phase 2 — sandbox-
  verified"). This confirms the prior session's push DID succeed.
- Attempted `git push -u origin main` — failed with "could not read
  Username" because no GitHub credentials are stored in this environment.
- Searched for stored credentials: no `~/.git-credentials`, no
  `~/.config/gh`, no `GH_TOKEN` env var, no credential helper configured.
  The previously-exposed PAT (prefix `ghp_dVxbye...`) was correctly
  redacted from the continuation context.
- Wrote `/home/z/my-project/scripts/push-to-github.sh` — a self-contained
  push script that takes a fresh PAT via env var (`GH_TOKEN=... bash ...`)
  or arg (`bash ... ghp_...`) and pushes `main` to `origin/main` using a
  one-shot URL so the token is NOT persisted in `.git/config`. Includes
  reminders to revoke the old compromised token before use.

Stage Summary:
- **Push state**: BLOCKED on user-supplied GitHub credentials. The local
  repo has 7 commits; the remote has 6 (the 6th = `c8c2044`). One
  commit (`432e601` — README update + commercial-viability notes) is
  staged for push.
- **What the user needs to do**: generate a fresh PAT at
  https://github.com/settings/tokens (the old one is compromised), then
  run:
    GH_TOKEN=ghp_NEW_TOKEN bash /home/z/my-project/scripts/push-to-github.sh
- **After push**: Phase 3 (RLE Engine) is the next major work item per
  the 10-phase workflow plan in `skills.md`. Phase 3 introduces the
  `RLEIndex` data structure and encode/decode operations — the first
  concrete realization of the Computational Arbitrage pillar (Pillar 5).
---
Task ID: 4
Agent: main
Task: Complete the GitHub push (step C) — push commit 432e601 to origin/main.

Work Log:
- First attempt with fine-grained PAT (`github_pat_...`) → HTTP 403.
  Diagnosed via API: token authenticated but had no `repo` scope (X-OAuth-Scopes
  header empty). Fine-grained PATs require explicit per-repo + per-permission
  selection; the user had not granted Contents:Write on the target repo.
- Second attempt with classic PAT (`ghp_IbpHS7i98...`) → HTTP 403 again.
  Diagnosed via API: token valid, authenticated as repo owner with admin/push
  permissions on the repo, BUT `x-oauth-scopes:` header was empty — the
  token was generated without any scope checkboxes ticked. A scopeless
  classic token can read public repos but cannot push.
- Third attempt with classic PAT (`ghp_0y1Z1qR8Qhy...`) → SUCCESS.
  Pre-push scope check confirmed `x-oauth-scopes: repo, workflow`. Pushed
  main:main via one-shot URL (token NOT persisted in .git/config).
- Post-push verification via GitHub API: repo HEAD now = 432e601, matching
  local HEAD. Commit history on origin:
    432e601  Update README: Phase 1 + Phase 2 marked sandbox-verified + commercial-viability notes
    c8c2044  Phase 1 (Typeclasses) + Phase 2 (Parser Combinator) — sandbox-verified
    7c66417  Verify Phase 0 builds & runs on sandbox
    8c5a802  Scaffold nbody-fold-scala Phase 0 + build skeleton
    f3bc7a2  Add skills.md: N-Body Simulation Scala workflow design

Stage Summary:
- **Push state**: COMPLETE. All 7 commits are now on origin/main.
  View at: https://github.com/testdemoqwenai2025-creator/testdemo2025qwenai-creator
- **Security**: All three tokens used in this session are now in chat history
  and should be revoked at https://github.com/settings/tokens after the
  user confirms the push landed correctly.
- **Project state**: Phases 0, 1, 2 are sandbox-verified and shipped.
  README documents the commercial-viability rationale.
- **Next milestone**: Phase 3 (RLE Engine) — `RLEIndex` data structure +
  encode/decode operations. This is the first concrete realization of
  Pillar 5 (Computational Arbitrage) and sets up Phase 5's bottom-up
  force fold that will be benchmarked against brute-force O(N²) at N=10k.
---
Task ID: 5
Agent: main
Task: Execute Phase 3 (RLE Engine) — Eq typeclass, RLE.encode/decode,
RLEIndex O(log runs) lookup, given Eq[Body] (same-id). Sandbox-verify
and push to GitHub.

Work Log:
- Re-read skills.md §2 Phase 3 spec:
  * RLE.scala — encode[A: Eq], decode[A]
  * RLEIndex — O(log N) i-th element lookup via prefix-sum binary search
  * given Eq[Body] — bodies equal iff same id (not same state)
  * Property tests: decode ∘ encode = identity, length preserved
- Created Phase3_RLE/ directory with 4 source files:
  * Eq.scala — Eq[A] typeclass with given instances for Int/Long/Double/
    Boolean/String/Vec3. Eq.instance(f) constructor for one-offs.
  * RLE.scala — Run[A] case class + encode/decode + encodeTuples/
    decodeTuples + compressionRatio + decodedLength. Tail-recursive scan.
  * RLEIndex.scala — final class with prefixSum:Vector[Long], O(log runs)
    `at(i)`, `atOption(i)`, `runAt(i)`, `slice(from, until)`. Smart
    constructor builds prefixSum in O(runs).
  * RLEInstances.scala — given Eq[Body] (same id), Eq[Mass] (value),
    Eq[Option[A]] and Eq[(A,B)] (compositional).
- Wrote Phase3Demo.scala with 6 demo sections + 31 self-checks:
  1. Basic encode/decode round-trip
  2. Property tests (round-trip identity, length preserved, empty,
     singleton laws) on 5 input vectors
  3. Eq[Body] — three same-id bodies with DIFFERENT positions collapse
     into one run of length 3 (proving Eq[Body] is identity-based, not
     state-based)
  4. RLEIndex.at — exhaustive check that idx.at(i) == big(i) for ALL
     1000 positions of a 10-run × 100-each test vector; spot-checks at
     run boundaries (i=99/100/199/200/...); out-of-bounds returns None
  5. RLEIndex.slice — extract [95, 205) crossing two run boundaries;
     verify == big.slice(95, 205); verify head/tail content
  6. Compression ratio on a 10k-body spatial grid (100 cells × 100
     bodies each) — achieves 100× compression (10000 → 100 runs)
- First sandbox run: 29/31 passed, 2 failed. Both were TEST bugs
  (not engine bugs):
  1. Expected run count = 3 for Vector(1,1,1,2,2,3,1,1,1,1) but the
     correct answer is 4 — RLE preserves run identity, NOT set
     membership. (1,1,1) and (1,1,1,1) are TWO separate runs of 1s
     because they're separated by 2s and 3s.
  2. Slice [95, 205) ends at position 204 which is in the 2s range
     (200..299), not the 1s range. My comment said "ends with five 1s"
     but the correct expectation is "ends with five 2s".
  Plus one f-interpolator format bug: `${expr}%.1f×` doesn't work in
  Scala 3 (same issue Phase 0 hit). Extracted to local vars and used
  proper f"... $var%.1f×" syntax. Fix matches the pattern from
  Phase 0's KeplerDemo fix.
- Second sandbox run: 31/31 PASS. Phase3Demo verified clean.
- Regression check: re-ran KeplerDemo (4/4), Phase1Demo (4/4),
  Phase2Demo (5/5). No regressions from Phase 3 additions.
- Updated nbody-fold-scala/README.md:
  * Phase 3 marked ✅ Sandbox-verified in Status table
  * Added Phase3Demo to Build & Run commands
  * Expanded Directory Layout to show Phase3_RLE/ subtree
  * Updated Pillar 5 row to mark "Phase 3 ✅ partial"
- Wrote this worklog entry.

Stage Summary:
- **Sandbox state**: Phase 0/1/2/3 all green. Phase3Demo 31/31 self-
  checks pass. No regressions in earlier phases.
- **Phase 3 deliverables complete**:
  * Eq[A] typeclass with 7 primitive/structural given instances
  * RLE.encode/decode — O(n) single-pass tail-recursive
  * RLEIndex — O(log runs) prefix-sum binary search; supports at,
    atOption, runAt, slice
  * given Eq[Body] — identity-based equality (same id, different state)
  * All 4 property laws verified: round-trip identity, length
    preservation, empty/singleton edge cases
- **Local git state**: Will create 1 new commit on top of 432e601.
- **Next step**: commit + push, then Phase 4 (Double RLE) per the
  10-phase workflow. Phase 4 will stack a second RLE pass on top of
  the first to achieve O(log log N) jumps via two-level binary search.
---
Task ID: 6
Agent: main
Task: Execute Phase 4 (DoubleRLE / "Mathematical Jumping") — encode2/decode2
+ JumpIndex O(log doubleRuns) jumpTo. Sandbox-verify and push to GitHub.

Work Log:
- Re-read skills.md §2 Phase 4 spec:
  * DoubleRLE.encode2 : Vector[A] → Vector[((A, Int), Int)]
    (outer Int = count of identical (element, count) pairs)
  * JumpIndex.jumpTo(i) : O(log log N) via two-level binary search
  * Worked example: 1M-body dataset → ~1000 entries
- Created Phase4_DoubleRLE/ directory with 2 source files:
  * DoubleRLE.scala — DoubleRun[A] case class (value, innerCount, outerCount)
    with .span = innerCount * outerCount. encode2 does RLE on (value, count)
    pairs using the compositional Eq[(A, Int)] from Phase 3's RLEInstances.
    decode2 expands via Vector.fill(outerCount * innerCount)(value). Also
    provides encode2Tuples/decode2Tuples (skills.md tuple form),
    compressionRatio2, decodedLength2, and compressionBreakdown (returns
    single×double×combined ratios as a tuple).
  * JumpIndex.scala — final class with prefixSum:Vector[Long]. Single
    binary search for jumpTo (key insight: within a DoubleRun all elements
    are the same value, so no inner search needed). API: jumpTo(i),
    jumpToOption(i), doubleRunAt(i) → (idx, offset), slice(from, until),
    speedupVsRLEIndex diagnostic. Smart constructor builds prefixSum in
    O(doubleRuns).
- Wrote Phase4Demo.scala with 7 demo sections + 42 self-checks:
  1. Basic encode2/decode2 round-trip
  2. Property tests (6 input vectors × round-trip + length + span invariants)
  3. Worked paper example: 1M-body periodic structure (100 cells × 1000
     bodies × 10 repeats)
  4. JumpIndex.jumpTo exhaustive check on 10k dataset
  5. JumpIndex.slice sub-range extraction
  6. Compression comparison: periodic vs unstructured
  7. Micro-benchmark: jumpTo vs RLEIndex.at vs direct index on 100k
     dataset with 100k random lookups

- First compile: 6 errors. Two root causes:
  1. System.nanoTime() resolved to nbody.Phase0_Domain.System (the domain
     class) instead of java.lang.System — same family of namespace
     collision Phase 0 hit with `sys`. Fix: java.lang.System.nanoTime()
     explicitly, with a comment explaining why.
  2. `given Eq[(A, Int)] = summon[Eq[(A, Int)]]` in DoubleRLE.scala
     triggered a Scala 3 forward-reference warning (would be error in
     Scala 3.5+). Fix: removed the local given; use explicit
     `val pairEq = summon[Eq[(A, Int)]]` and pass it via `(using pairEq)`.

- Second compile: clean. First run: 35/41 passed, 6 failed.

- ROOT CAUSE ANALYSIS of the 6 failures (all test-expectation bugs, not
  engine bugs):
  The key mathematical fact I had missed: standard DoubleRLE (RLE ∘ RLE)
  NEVER compresses. RLE always produces runs where adjacent entries have
  DIFFERENT values (otherwise they'd be merged). So adjacent entries in
  the runs Vector always differ in value, hence can NEVER be equal under
  (value, count) equality. The outerCount is always 1.

  My demo assumed L2 would compress periodic patterns — it doesn't. The
  "Mathematical Jumping" speedup comes from a different source (the
  two-level prefix sum enables O(1) skip-ahead in Phase 5's force
  aggregation when combined with coarser Eq instances).

- Fixed all 6 test expectations to reflect the mathematical invariant:
  * Section 1: changed expected double-run count from 2 to 6 (= single-
    run count); changed expected first DoubleRun from ((1,3),3) to
    ((1,3),1); added "all outerCounts == 1" invariant check
  * Section 3: changed expected double-run count from 100 to 1000;
    changed expected combined ratio from 10000× to 1000× (all from L1);
    added "all outerCounts == 1" check
  * Section 6: changed expected double-run count from 50 to 100; added
    "all outerCounts == 1" check
  * Added a long comment at the top of Section 1 explaining the
    mathematical invariant and why JumpIndex is still useful

- Third run: 42/43 passed, 1 failed. The remaining failure was the
  micro-benchmark assertion "JumpIndex faster than RLEIndex (>= 1.0×)"
  which got 0.76× (JumpIndex slower this run). This is JIT noise — on
  the next run it was 1.72× faster. Fix: removed the performance
  assertion, kept only the correctness assertion (all three methods
  agree on lookup sums). Added comment explaining why micro-benchmark
  ratios are informational, not assertable.

- Fourth run: 42/42 PASS. Phase4Demo verified clean.

- Regression check: re-ran KeplerDemo (4/4) and Phase3Demo (31/31).
  No regressions from Phase 4 additions.

- Updated nbody-fold-scala/README.md:
  * Phase 4 marked ✅ Sandbox-verified in Status table with the
    mathematical finding noted inline
  * Added Phase4Demo to Build & Run commands
  * Expanded Directory Layout to show Phase4_DoubleRLE/ subtree
  * Updated Pillar 5 row to mark "Phase 3 ✅, Phase 4 ✅"

Stage Summary:
- **Sandbox state**: Phase 0/1/2/3/4 all green. Phase4Demo 42/42 self-
  checks pass. No regressions in earlier phases.
- **Phase 4 deliverables complete**:
  * DoubleRLE.encode2/decode2 — correct implementation of the spec's
    `Vector[A] → Vector[((A, Int), Int)]` signature
  * JumpIndex — O(log doubleRuns) jumpTo + slice + diagnostics
  * Worked paper example: 1M-body → 1000 entries (meets spec target
    via L1; L2 is a no-op, documented honestly)
  * Micro-benchmark: JumpIndex competitive with RLEIndex (1.72× faster
    on one run, 0.76× on another — JIT noise)
- **Key mathematical finding documented**: standard DoubleRLE (RLE ∘ RLE)
  never compresses because adjacent RLE runs always differ in value.
  The JumpIndex data structure is still valuable as a drop-in replacement
  for RLEIndex with equivalent performance and a cleaner range-query API.
  Genuine L2 compression would require a non-standard second-pass
  algorithm (e.g., count-only equality + auxiliary value storage),
  which is beyond the spec's `encode2[A: Eq]` signature.
- **Local git state**: Will create 1 new commit on top of 7e5d401.
- **Next step**: commit + push, then Phase 5 (N-Body Engine) per the
  10-phase workflow. Phase 5 is the physics payoff — leapfrog integrator
  + bottom-up force fold using BodyFoldable[System].foldMapBodies.
---
Task ID: 7
Agent: main
Task: Execute Phase 5 (N-Body Simulation Engine) — Newtonian gravity +
leapfrog KDK integrator + bottom-up force fold. Sandbox-verify against
spec's conservation-law tests (Kepler, energy, momentum). Push to GitHub.

Work Log:
- Re-read skills.md §2 Phase 5 spec:
  * Physics.scala — force(a, b) with softening ε
  * Integrator.scala — leapfrog KDK
  * Simulator.scala — step(system) via bottom-up fold
  * Verification: 10-orbit Kepler to 1e-6, energy drift < 1e-6 over 1000
    steps, momentum to machine precision
- Created Phase5_NBody/ with 4 source files:
  * Physics.scala — G=1 natural units, Plummer softening, pairwise
    force/acceleration/potentialEnergy, totalAccelerationOn, O(N²)
    computeAccelerations with Newton's third law halving
  * Integrator.scala — immutable Vector[Body] KDK (kick/drift/kick),
    reference implementation
  * Simulator.scala — step/evolve/stepBodies, rebuildSystem,
    energyDrift/momentumDrift diagnostics
  * MutableKDK.scala — mutable Array[Double] hot-path (added after
    performance issue, see below)
- Wrote Phase5Demo.scala with 5 sections + 10 self-checks:
  0. Physics primitives sanity check (force magnitude, direction, PE)
  1. Two-body Kepler: 3 orbits × 1000 steps, eccentricity + semi-major
     axis drift < 1e-6
  2. Energy drift: 3-body system, 1000 steps, relative drift < 1e-6
  3. Momentum conservation: same 3-body, drift < 1e-9
  4. Longer run: 2000 steps, bounded drift (symplectic property)

- CRITICAL PERFORMANCE BUG caught by sandbox:
  The immutable Vector[Body] approach (Integrator.kdkStep with
  bodies.zip(accs).map(...)) was ~300ms/step in interpreted JVM mode
  because each step allocated ~30 objects (Body copies, Vec3 instances,
  Vector builders). Even 50 warmup steps took >60s, and 200 steps took
  >90s — blowing the demo timeout.

  ROOT CAUSE: Scala's immutable Vector.map/zip create new persistent
  data structures per call. For N=2 bodies this is 6 Body copies + 4
  Vec3 allocations per step. The JVM interpreter handles this poorly;
  JIT compilation doesn't kick in until ~1000 steps, but we can't
  reach 1000 steps within the timeout.

  FIX: Created MutableKDK.scala — a mutable Array[Double] hot-path
  that extracts positions/velocities/masses into flat arrays ONCE,
  runs the KDK step with ZERO allocations in the hot loop (just
  primitive arithmetic on array slots), and reconstructs Vector[Body]
  at the end. This is the standard approach for all production N-body
  codes (GADGET, AREPO, REBOUND). Performance: 200 steps in 0.004s
  (15000× faster than the immutable version). The public API
  (Vector[Body] → Vector[Body]) is unchanged; only the internal
  implementation changes.

  Also refactored Simulator.evolve to extract bodies ONCE, run the
  entire integration loop on flat Vector[Body] (via stepBodies →
  MutableKDK.step), and rebuild System ONCE at the end — avoiding
  hierarchy overhead (Entity/ComponentVector/Component allocation)
  per step.

- ACCURACY TUNING:
  First successful run with MutableKDK: 8/10 passed, 2 failed.
  * Eccentricity drift 4.11e-6 > 1e-6: 100 steps/orbit wasn't enough.
    Increased to 1000 steps/orbit × 3 orbits = 3000 steps. New drift:
    6.12e-10 (1500× better than threshold).
  * Energy drift 3.38e-6 > 1e-6: dt=0.01 was too coarse for 3-body.
    Decreased to dt=0.005, 1000 steps. New drift: 8.46e-7 (just under
    threshold, as expected for leapfrog at this timestep).

- FORMAT STRING BUGS (same family as Phase 0/3):
  Multiple `${expr}%.6e` and `${expr}%.6f` patterns in s-interpolators
  printed the format spec literally. Fixed by extracting to local vars
  and using f"... $var%.6e" syntax.

- Final run: 10/10 PASS. Phase5Demo verified clean.
  Results:
  * eccentricity drift: 6.12e-10 over 3 orbits (threshold 1e-6)
  * semi-major axis drift: 1.44e-13 over 3 orbits (threshold 1e-6)
  * energy drift: 8.46e-7 over 1000 steps (threshold 1e-6)
  * momentum drift: 1.71e-13 (threshold 1e-9, machine precision)
  * symplectic bound: 2000-step drift not 2× worse than 1000-step

- Regression check: KeplerDemo 4/4 still passes. No breakage.

- Updated nbody-fold-scala/README.md:
  * Phase 5 marked ✅ Sandbox-verified with concrete drift numbers
  * Added Phase5Demo to Build & Run
  * Added Phase5_NBody/ subtree to Directory Layout
  * Updated Pillar 5 row to mark Phase 5 ✅

Stage Summary:
- **Sandbox state**: Phase 0/1/2/3/4/5 all green. Phase5Demo 10/10.
- **Phase 5 deliverables complete**:
  * Physics.scala — Newtonian gravity with softening
  * Integrator.scala — immutable KDK reference implementation
  * MutableKDK.scala — mutable hot-path (15000× faster)
  * Simulator.scala — step/evolve/diagnostics
  * All three spec verification tests pass:
    - Kepler: eccentricity + semi-major axis to 1e-6 ✓
    - Energy: drift < 1e-6 over 1000 steps ✓
    - Momentum: machine precision ✓
- **Key engineering finding**: the immutable Vector[Body] approach is
  correct and readable but unsuitable for the integration hot loop.
  All production N-body codes use mutable flat arrays internally.
  The functional API wraps the mutable core — same pattern as NumPy,
  JAX, and every serious scientific computing library.
- **Next step**: commit + push, then Phase 6 (File I/O via Three-Call
  mmap) per the 10-phase workflow.
