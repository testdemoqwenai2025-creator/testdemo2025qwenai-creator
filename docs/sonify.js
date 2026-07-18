// ============================================================================
// sonify.js — Phase 17: Web Audio sonification engine
// ============================================================================
// Maps the live N-body state to a small polyphonic soundscape:
//   • Each body (up to 8 simultaneously) drives one oscillator. The pitch
//     encodes radial distance from the centre of mass (closer = higher), the
//     amplitude encodes mass, and a lowpass filter encodes speed (faster =
//     brighter). The result is a chorus of "planet tones" that drift in
//     pitch as the system evolves.
//   • Close encounters (pairwise distance below a threshold) trigger a soft
//     percussive "ping" — a short sine envelope — so chaotic interactions
//     become audible.
//   • Total energy drift modulates an ambient drone: a stable system stays
//     on a clean root pitch; a drifting system adds detuning + gain so the
//     listener can HEAR the integrator losing accuracy.
//
// All built with the zero-dependency Web Audio API. No samples, no MIDI,
// no external assets. Browsers gate AudioContext creation behind a user
// gesture; the tour controller calls resume() on the first click.
// ============================================================================

(function () {
  'use strict';

  const AUDIO_CTX_CTOR = window.AudioContext || window.webkitAudioContext;
  if (!AUDIO_CTX_CTOR) {
    // Browser without Web Audio — provide a no-op stub so the rest of the
    // app keeps working. The stub mirrors the full public API surface so
    // tour.js / app.js can call setEnabled/isEnabled without crashing.
    window.NBodySonify = {
      enabled: false,
      _enabled: false,
      isEnabled() { return false; },
      setEnabled() {},
      resume() { return Promise.resolve(); },
      start() {}, stop() {}, update() {}, ping() {}
    };
    return;
  }

  // ── Constants ────────────────────────────────────────────────────────
  const MAX_VOICES = 8;            // hard cap on simultaneous body tones
  const ROOT_HZ = 110;             // A2 — base pitch for the drone
  const ENCOUNTER_THRESHOLD = 0.15; // in simulation units (auto-rescaled)
  const ENCOUNTER_DEBOUNCE_MS = 80;

  let _ctx = null;
  let _master = null;
  let _drone = null;               // { oscA, oscB, gain, filter }
  let _voices = [];                // [{ osc, gain, filter, bodyId }]
  let _lastEncounterTs = 0;
  let _enabled = true;
  let _started = false;

  // ── Public API ───────────────────────────────────────────────────────

  function isEnabled() { return _enabled; }
  function setEnabled(v) {
    _enabled = !!v;
    if (_master) {
      _master.gain.setTargetAtTime(_enabled ? 0.6 : 0.0, _ctx.currentTime, 0.05);
    }
  }

  function resume() {
    if (!_ctx) _initCtx();
    if (_ctx.state === 'suspended') return _ctx.resume();
    return Promise.resolve();
  }

  function start() {
    if (!_ctx) _initCtx();
    if (_ctx.state === 'suspended') _ctx.resume();
    if (_started) return;
    _startDrone();
    _started = true;
  }

  function stop() {
    if (!_started) return;
    // Fade out voices + drone then close them
    const now = _ctx.currentTime;
    if (_drone) {
      _drone.gain.gain.setTargetAtTime(0, now, 0.1);
      setTimeout(() => {
        try { _drone.oscA.stop(); _drone.oscB.stop(); } catch (_) {}
        _drone = null;
      }, 250);
    }
    for (const v of _voices) {
      try { v.gain.gain.setTargetAtTime(0, now, 0.1); } catch (_) {}
      setTimeout(() => { try { v.osc.stop(); } catch (_) {} }, 250);
    }
    _voices = [];
    _started = false;
  }

  // Update the soundscape from the current simulation state.
  //   bodies:    [{x,y,z,vx,vy,vz,mass}, ...] (current positions/velocities)
  //   drift:     number (relative energy drift |ΔE|/|E₀|)
  //   scaleHint: number (typical spatial extent, used to normalize distances)
  function update(bodies, drift, scaleHint) {
    if (!_started || !_enabled) return;
    if (!bodies || bodies.length === 0) return;

    const now = _ctx.currentTime;
    const scale = Math.max(1e-6, scaleHint || 1.0);

    // ── Update drone: detune by log10(drift), gain by drift magnitude ──
    if (_drone) {
      const d = Math.max(1e-12, Math.min(1.0, drift || 0));
      // -1200..+1200 cents detune for drift 1e-12..1
      const cents = (Math.log10(d) + 12) * 100;
      _drone.oscB.detune.setTargetAtTime(cents, now, 0.1);
      // Quieter base drone; louder as drift grows (audible warning)
      const droneGain = 0.04 + Math.min(0.15, d * 5);
      _drone.gain.gain.setTargetAtTime(droneGain, now, 0.1);
    }

    // ── Compute centre of mass ──
    let comX = 0, comY = 0, comZ = 0, mTot = 0;
    for (const b of bodies) {
      comX += b.x * b.mass; comY += b.y * b.mass; comZ += b.z * b.mass;
      mTot += b.mass;
    }
    if (mTot === 0) return;
    comX /= mTot; comY /= mTot; comZ /= mTot;

    // ── Pick the MAX_VOICES most massive bodies to sonify ──
    const sorted = bodies
      .map((b, i) => ({ b, i }))
      .sort((a, b) => b.b.mass - a.b.mass)
      .slice(0, MAX_VOICES);

    // ── Ensure we have exactly the right voices allocated ──
    while (_voices.length < sorted.length) _allocateVoice();
    while (_voices.length > sorted.length) {
      const v = _voices.pop();
      try { v.gain.gain.setTargetAtTime(0, now, 0.05); } catch (_) {}
      setTimeout(() => { try { v.osc.stop(); } catch (_) {} }, 200);
    }

    // ── Per-voice updates ──
    let encounterCount = 0;
    for (let k = 0; k < sorted.length; k++) {
      const { b } = sorted[k];
      const v = _voices[k];
      const dx = b.x - comX, dy = b.y - comY, dz = b.z - comZ;
      const r = Math.sqrt(dx * dx + dy * dy + dz * dz) / scale; // 0..~1
      const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy + b.vz * b.vz);
      // Pitch: closer to COM → higher (1/r mapping, clamped to a 5-octave range)
      const pitchHz = ROOT_HZ * 4 * Math.pow(2, -Math.min(2.5, r * 2.5));
      v.osc.frequency.setTargetAtTime(pitchHz, now, 0.05);
      // Amplitude: mass (normalized against heaviest)
      const amp = 0.04 + 0.10 * Math.min(1, b.mass / sorted[0].b.mass);
      v.gain.gain.setTargetAtTime(amp, now, 0.05);
      // Filter cutoff: speed → brightness (200Hz..4000Hz)
      const cutoff = 200 + Math.min(3800, speed * 1500);
      v.filter.frequency.setTargetAtTime(cutoff, now, 0.05);

      // Close-encounter detection: any other voice body within threshold
      for (let j = k + 1; j < sorted.length; j++) {
        const b2 = sorted[j].b;
        const dx2 = b.x - b2.x, dy2 = b.y - b2.y, dz2 = b.z - b2.z;
        const d2 = Math.sqrt(dx2 * dx2 + dy2 * dy2 + dz2 * dz2) / scale;
        if (d2 < ENCOUNTER_THRESHOLD) encounterCount++;
      }
    }

    if (encounterCount > 0 && (now * 1000 - _lastEncounterTs) > ENCOUNTER_DEBOUNCE_MS) {
      _ping(encounterCount);
      _lastEncounterTs = now * 1000;
    }
  }

  // ── Internals ────────────────────────────────────────────────────────

  function _initCtx() {
    _ctx = new AUDIO_CTX_CTOR();
    _master = _ctx.createGain();
    _master.gain.value = _enabled ? 0.6 : 0.0;
    _master.connect(_ctx.destination);
  }

  function _startDrone() {
    if (!_ctx) return;
    // Two detuned sawtooth oscillators → root + fifth, lowpassed to a warm pad
    const oscA = _ctx.createOscillator();
    oscA.type = 'sawtooth';
    oscA.frequency.value = ROOT_HZ;
    const oscB = _ctx.createOscillator();
    oscB.type = 'sawtooth';
    oscB.frequency.value = ROOT_HZ * 1.5; // perfect fifth
    oscB.detune.value = 0;
    const filter = _ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    filter.Q.value = 0.7;
    const gain = _ctx.createGain();
    gain.gain.value = 0.05;
    oscA.connect(filter); oscB.connect(filter);
    filter.connect(gain); gain.connect(_master);
    oscA.start(); oscB.start();
    _drone = { oscA, oscB, gain, filter };
  }

  function _allocateVoice() {
    if (!_ctx) return;
    const osc = _ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 440;
    const filter = _ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1000;
    filter.Q.value = 0.5;
    const gain = _ctx.createGain();
    gain.gain.value = 0;
    osc.connect(filter); filter.connect(gain); gain.connect(_master);
    osc.start();
    _voices.push({ osc, gain, filter });
  }

  function _ping(intensity) {
    if (!_ctx) return;
    // Short percussive ping: sine envelope, frequency scaled by encounter count
    const now = _ctx.currentTime;
    const osc = _ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 600 + Math.min(2000, intensity * 200);
    const gain = _ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.12, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    osc.connect(gain); gain.connect(_master);
    osc.start(now);
    osc.stop(now + 0.22);
  }

  window.NBodySonify = {
    enabled: true,
    isEnabled, setEnabled,
    resume, start, stop, update,
    ping: _ping,
    _ctx: () => _ctx  // for tests / debugging
  };
})();
