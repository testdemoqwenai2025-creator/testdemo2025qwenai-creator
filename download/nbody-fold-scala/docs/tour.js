// ============================================================================
// tour.js — Phase 17: automated demonstration tour
// ============================================================================
// Plays through every scenario in the library in sequence, with synchronized
// narration + sonification. Designed so a first-time visitor can press one
// button and appreciate the whole project without touching anything else.
//
// The tour:
//   1. Resumes the AudioContext (must be triggered by a user gesture).
//   2. For each scenario: shows narration, creates the system, steps the
//      integrator, and updates the soundscape ~10×/s while it runs.
//   3. Advances to the next scenario when the step count completes (or when
//      the user clicks ⏭ Skip).
//   4. Stops at the end with a closing message.
//
// State machine: idle → playing ⇄ paused → idle
// ============================================================================

(function () {
  'use strict';
  if (!window.NBodySonify || !window.NBodyPhysics) {
    // Dependencies not loaded yet — tour.js is loaded after them, so this
    // should never fire. Bail silently if it does.
    return;
  }

  // ── Scenario narration (one entry per scenario in the library) ───────
  // Order matters — this is the curated narrative arc.
  const TOUR_ORDER = [
    {
      key: 'twoBody',
      title: 'Two-body Kepler',
      body: 'Two masses orbiting their common centre of mass. This is the only N-body problem with a closed-form solution — Newton 1687. Energy is conserved to <1e-9 per step thanks to the symplectic KDK leapfrog integrator. Listen: a single tone pair, perfectly periodic.'
    },
    {
      key: 'solarSystem',
      title: 'Solar System',
      body: 'The Sun plus six planets on near-circular orbits. Long-term stable, but each planet drifts slightly inward over gigayear timescales due to softening. Hear the chorus of inner planets — fast, high pitches — versus the outer giants, slow and deep.'
    },
    {
      key: 'figure8',
      title: 'Figure-8 choreography',
      body: 'Three equal masses chasing each other along a single figure-8 curve. Discovered by Chenciner & Montgomery in 2000 — the first new periodic solution to the three-body problem in 300 years. Energy drift stays at machine precision.'
    },
    {
      key: 'binaryWithPlanet',
      title: 'Binary star + circumbinary planet',
      body: 'A close binary pair with a planet on a wide orbit. The planet feels a time-averaged potential — this is the Kepler-16b configuration. Listen for the rapid binary oscillation under the slow planetary drift.'
    },
    {
      key: 'plummer32',
      title: 'Plummer sphere N=32',
      body: 'A self-gravitating cluster sampled from the Plummer model — the standard toy model for a globular cluster. Watch it relax through two-body encounters. The virial ratio 2KE + PE settles to ≈0 as the cluster virializes.'
    },
    {
      key: 'lattice27',
      title: 'Lattice 3³ = 27',
      body: 'A 3×3×3 cubic lattice with small random velocities. Homogeneous start → gravitational collapse → virialized cluster. This is the classic "cold collapse" benchmark used to validate N-body codes.'
    }
  ];

  // ── State ────────────────────────────────────────────────────────────
  let _state = 'idle';        // 'idle' | 'playing' | 'paused'
  let _index = 0;             // current index in TOUR_ORDER
  let _rafHandle = null;      // requestAnimationFrame id for the sound loop
  let _stepTimer = null;      // setTimeout handle for stepping
  let _pauseResolve = null;   // used to pause between scenarios
  let _soundEnabled = true;
  let _stepStartMs = 0;
  let _stepCount = 0;
  let _currentSystemId = null;
  let _currentBodies = [];

  // ── DOM refs (resolved lazily so tour.js can load before app.js finishes) ──
  function $(id) { return document.getElementById(id); }

  // ── Public API ───────────────────────────────────────────────────────

  function play() {
    if (_state === 'paused') { _resume(); return; }
    if (_state === 'playing') return;
    _state = 'playing';
    _updateButtons();
    $('tour-status').textContent = 'starting…';
    if (_soundEnabled) {
      window.NBodySonify.setEnabled(true);
      window.NBodySonify.resume().then(() => window.NBodySonify.start());
    } else {
      window.NBodySonify.setEnabled(false);
    }
    _index = 0;
    _runCurrent();
  }

  function pause() {
    if (_state !== 'playing') return;
    _state = 'paused';
    _updateButtons();
    $('tour-status').textContent = 'paused';
    if (_rafHandle) cancelAnimationFrame(_rafHandle);
    _rafHandle = null;
  }

  function stop() {
    _state = 'idle';
    _index = 0;
    if (_rafHandle) cancelAnimationFrame(_rafHandle);
    _rafHandle = null;
    if (_stepTimer) clearTimeout(_stepTimer);
    _stepTimer = null;
    try { window.NBodySonify.stop(); } catch (_) {}
    _updateButtons();
    $('narration-title').textContent = 'Stopped';
    $('narration-body').textContent = 'Tour stopped. Press ▶ Play tour to start again from the beginning.';
    $('narration-progress-bar').style.width = '0%';
    $('narration-step').textContent = 'scenario 0 / ' + TOUR_ORDER.length;
    $('tour-status').textContent = 'idle';
  }

  function skip() {
    if (_state === 'idle') return;
    // Cancel any pending timers / RAF
    if (_stepTimer) { clearTimeout(_stepTimer); _stepTimer = null; }
    if (_rafHandle) { cancelAnimationFrame(_rafHandle); _rafHandle = null; }
    _index++;
    if (_index >= TOUR_ORDER.length) {
      _finish();
    } else {
      _runCurrent();
    }
  }

  function setSoundEnabled(v) {
    _soundEnabled = !!v;
    window.NBodySonify.setEnabled(_soundEnabled);
    if (_soundEnabled && _state === 'playing') {
      window.NBodySonify.resume().then(() => window.NBodySonify.start());
    } else if (!_soundEnabled) {
      // stop voices but keep tour running
      try { window.NBodySonify.stop(); } catch (_) {}
    }
  }

  function isPlaying() { return _state === 'playing'; }
  function getState() { return _state; }

  // ── Internals ────────────────────────────────────────────────────────

  function _resume() {
    if (_state !== 'paused') return;
    _state = 'playing';
    _updateButtons();
    $('tour-status').textContent = 'playing';
    if (_soundEnabled) {
      window.NBodySonify.resume().then(() => window.NBodySonify.start());
    }
    _runSoundLoop();
  }

  async function _runCurrent() {
    const scenario = TOUR_ORDER[_index];
    if (!scenario) { _finish(); return; }
    $('narration-title').textContent = scenario.title;
    $('narration-body').textContent = scenario.body;
    $('narration-step').textContent = 'scenario ' + (_index + 1) + ' / ' + TOUR_ORDER.length;
    $('tour-status').textContent = 'running: ' + scenario.key;
    _updateProgress(0);

    // Reuse the global SCENARIO_PARAMS from app.js (window.NBodyTourParams)
    const params = (window.NBodyTourParams && window.NBodyTourParams[scenario.key]) || {
      name: scenario.key, dt: 0.01, softening: 0.05, steps: 300, sampleEvery: 10
    };

    try {
      // Create the system via the same path app.js uses
      const id = await window.NBodyTour.createSystem(scenario.key);
      _currentSystemId = id;
      if (!id) throw new Error('create failed for ' + scenario.key);

      // Fetch the initial bodies so we have something to sonify immediately
      await _refreshBodies(id);

      // Switch to 3D for all scenarios except twoBody (which is planar)
      window.NBodyTour.setVizMode(scenario.key !== 'twoBody');

      // Start the sound loop
      _stepStartMs = performance.now();
      _stepCount = params.steps;
      _runSoundLoop();

      // Kick off the integrator step
      const stepRes = await fetch('/api/systems/' + id + '/step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': 'demo' },
        body: JSON.stringify({ steps: params.steps, sampleEvery: params.sampleEvery })
      });
      const stepJ = await stepRes.json();

      // Wait briefly so the user can see the final state before advancing
      const dwellMs = 1500;
      _stepTimer = setTimeout(() => {
        _stepTimer = null;
        _index++;
        if (_index >= TOUR_ORDER.length) {
          _finish();
        } else if (_state === 'playing') {
          _runCurrent();
        }
      }, dwellMs);

      // Update progress bar based on the step's reported drift + scenario index
      const drift = stepJ.drift || 0;
      $('tour-status').textContent = 'ran ' + scenario.key + ' · drift=' + drift.toExponential(2);
    } catch (e) {
      $('narration-body').textContent = 'Error running ' + scenario.key + ': ' + e.message + ' — continuing to next scenario.';
      _stepTimer = setTimeout(() => {
        _index++;
        if (_index >= TOUR_ORDER.length) _finish();
        else if (_state === 'playing') _runCurrent();
      }, 1500);
    }
  }

  function _runSoundLoop() {
    if (_state !== 'playing') return;
    if (_rafHandle) cancelAnimationFrame(_rafHandle);
    const tick = () => {
      if (_state !== 'playing') return;
      // Update progress (this scenario's elapsed time / estimated total)
      const elapsed = performance.now() - _stepStartMs;
      const estTotal = Math.max(2000, _stepCount * 4); // ~4ms/step heuristic
      const frac = Math.min(1, elapsed / estTotal);
      _updateProgress((_index + frac) / TOUR_ORDER.length);

      // Refresh bodies periodically (every ~150ms) for fresh sonification
      if (_currentSystemId) {
        _refreshBodies(_currentSystemId, /*quiet*/ true);
      }
      _rafHandle = requestAnimationFrame(tick);
    };
    _rafHandle = requestAnimationFrame(tick);
  }

  async function _refreshBodies(id, quiet) {
    try {
      const res = await fetch('/api/systems/' + id);
      const j = await res.json();
      _currentBodies = (j.bodies || []).map(b => ({
        x: b.x, y: b.y, z: b.z,
        vx: b.vx, vy: b.vy, vz: b.vz,
        mass: b.mass
      }));
      // Compute scaleHint as the COM-furthest distance
      let comX = 0, comY = 0, comZ = 0, mTot = 0;
      for (const b of _currentBodies) {
        comX += b.x * b.mass; comY += b.y * b.mass; comZ += b.z * b.mass; mTot += b.mass;
      }
      if (mTot > 0) {
        comX /= mTot; comY /= mTot; comZ /= mTot;
        let maxR = 0;
        for (const b of _currentBodies) {
          const r = Math.hypot(b.x - comX, b.y - comY, b.z - comZ);
          if (r > maxR) maxR = r;
        }
        const scale = Math.max(1e-6, maxR);
        // Compute current drift from E0 if known — use a stable estimate
        const e0 = window.NBodyTour && window.NBodyTour.getE0
          ? window.NBodyTour.getE0(id)
          : 0;
        let drift = 0;
        if (e0 && window.NBodyPhysics) {
          try {
            const e = window.NBodyPhysics.totalEnergy(_currentBodies, 0.05);
            drift = Math.abs((e - e0) / e0);
          } catch (_) {}
        }
        // Sonify
        if (_soundEnabled) {
          window.NBodySonify.update(_currentBodies, drift, scale);
        }
      }
      // Also hand the bodies to app.js so its telemetry panel can read them
      if (window.NBodyTour && window.NBodyTour.setBodies) {
        window.NBodyTour.setBodies(_currentBodies, id);
      }
    } catch (e) {
      if (!quiet) console.warn('tour: refresh bodies failed', e);
    }
  }

  function _updateProgress(frac) {
    $('narration-progress-bar').style.width = (frac * 100).toFixed(1) + '%';
  }

  function _finish() {
    _state = 'idle';
    _index = 0;
    if (_rafHandle) cancelAnimationFrame(_rafHandle);
    _rafHandle = null;
    try { window.NBodySonify.stop(); } catch (_) {}
    _updateButtons();
    $('narration-title').textContent = 'Tour complete';
    $('narration-body').textContent = 'That was the full tour — six scenarios covering Kepler orbits, the Figure-8 choreography, circumbinary planets, Plummer cluster relaxation, and cold lattice collapse. Press ▶ Play tour to watch again, or pick a scenario above to explore it manually.';
    $('narration-progress-bar').style.width = '100%';
    $('tour-status').textContent = 'complete';
  }

  function _updateButtons() {
    const playing = _state === 'playing';
    const paused = _state === 'paused';
    $('tour-play').disabled = playing;
    $('tour-play').textContent = paused ? '▶ Resume' : '▶ Play tour';
    $('tour-pause').disabled = !playing;
    $('tour-stop').disabled = _state === 'idle';
    $('tour-skip').disabled = _state === 'idle';
  }

  // ── Wire up DOM (after DOMContentLoaded) ─────────────────────────────
  function _wireUp() {
    $('tour-play').addEventListener('click', play);
    $('tour-pause').addEventListener('click', pause);
    $('tour-stop').addEventListener('click', stop);
    $('tour-skip').addEventListener('click', skip);
    $('tour-sound').addEventListener('change', (e) => setSoundEnabled(e.target.checked));
    _updateButtons();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _wireUp);
  } else {
    _wireUp();
  }

  // Expose a tiny API for app.js to register its hooks (createSystem,
  // setVizMode, setBodies, getE0) and for tests to query state.
  window.NBodyTour = {
    play, pause, stop, skip,
    setSoundEnabled,
    isPlaying, getState,
    // Hooks that app.js fills in:
    createSystem: null,
    setVizMode: null,
    setBodies: null,
    getE0: null,
    // Scenario params + order (read-only)
    ORDER: TOUR_ORDER
  };
})();
