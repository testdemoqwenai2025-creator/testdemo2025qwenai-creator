// ============================================================================
// playback.js — Phase 19: live trajectory playback + scrubber
// ============================================================================
// Turns the stored trajectory into a scrubable, playable animation. Instead
// of drawing the entire trail at once (the existing renderTrajectory* path),
// this module animates bodies along their recorded positions in real time.
//
// Features:
//   • Play / pause / stop controls
//   • Range-slider scrubber (drag to seek anywhere in the timeline)
//   • Variable speed (0.25× → 4×)
//   • Adjustable trail length (0 → 100% of the trajectory)
//   • Syncs with the existing 2D / 3D renderers
//   • Falls back to the static "draw everything" mode when paused at t=0
//
// The playback engine does NOT touch the integrator — it only reads the
// trajectory samples that loadTrajectories() already fetched. This means
// it works in both STATIC and DYNAMIC mode, and the simulation does not
// need to be re-run to scrub.
//
// Public API:
//   window.NBodyPlayback = {
//     setTrajectory(byBody),   // [{bodyId, samples:[{x,y,z,...}, ...]}, ...]
//     play(), pause(), stop(),
//     seek(frac),              // 0..1
//     isPlaying(),
//     getProgress(),           // 0..1
//     setSpeed(mult),
//     setTrailFrac(frac),      // 0..1 — fraction of trajectory to draw as trail
//     renderAt(frac)           // one-shot render at fraction (used by scrubber)
//   };
//
// Hooks (filled in by app.js):
//   onRender(state)            // called every frame with {positions, trail, frac}
//                              // app.js dispatches to renderTrajectory2D/3D
// ============================================================================

(function () {
  'use strict';

  // ── State ────────────────────────────────────────────────────────────
  let _byBody = [];           // [{bodyId, samples:[{x,y,z,...}]}]
  let _totalLen = 0;          // length of the longest trajectory (frames)
  let _frac = 0;              // 0..1 — current playback position
  let _playing = false;
  let _speed = 1.0;
  let _trailFrac = 0.40;      // 40% of trajectory shown as trail by default
  let _rafHandle = null;
  let _lastTs = 0;

  // Playback runs at ~60fps but advances the simulation frame at a rate
  // determined by speed. At 1× we play 60 frames/sec (i.e. 1 sim-second per
  // real-second if the sample rate was 1/60). Speed multipliers scale this.
  const BASE_FPS = 60;

  function $(id) { return document.getElementById(id); }

  // ── Public API ───────────────────────────────────────────────────────

  function setTrajectory(byBody) {
    _byBody = (byBody || []).map(g => ({
      bodyId: g.bodyId,
      samples: g.samples || []
    }));
    _totalLen = _byBody.reduce((m, g) => Math.max(m, g.samples.length), 0);
    _frac = 0;
    _updateScrubber();
    _renderFrame();
  }

  function play() {
    if (_totalLen < 2) return;
    if (_frac >= 1) _frac = 0;        // rewind if at end
    _playing = true;
    _lastTs = performance.now();
    _updatePlayButton();
    _tick();
  }

  function pause() {
    _playing = false;
    if (_rafHandle) cancelAnimationFrame(_rafHandle);
    _rafHandle = null;
    _updatePlayButton();
  }

  function stop() {
    pause();
    _frac = 0;
    _updateScrubber();
    _renderFrame();
  }

  function seek(frac) {
    _frac = Math.max(0, Math.min(1, frac));
    _updateScrubber();
    _renderFrame();
  }

  function isPlaying()  { return _playing; }
  function getProgress() { return _frac; }
  function setSpeed(m)   { _speed = Math.max(0.0625, Math.min(8, +m || 1)); }
  function setTrailFrac(f) { _trailFrac = Math.max(0, Math.min(1, +f || 0)); }

  function renderAt(frac) {
    _frac = Math.max(0, Math.min(1, frac));
    _renderFrame();
    _updateScrubber();
  }

  // ── Internals ────────────────────────────────────────────────────────

  function _tick() {
    if (!_playing) return;
    const now = performance.now();
    const dt = (now - _lastTs) / 1000;     // seconds
    _lastTs = now;
    // Advance frac. At 1× speed, we play the whole trajectory in
    // (_totalLen / BASE_FPS) seconds.
    const totalDur = Math.max(0.5, _totalLen / BASE_FPS);
    _frac += (dt * _speed) / totalDur;
    if (_frac >= 1) {
      _frac = 1;
      pause();   // auto-stop at end
      _updateScrubber();
      _renderFrame();
      return;
    }
    _updateScrubber();
    _renderFrame();
    _rafHandle = requestAnimationFrame(_tick);
  }

  function _currentFrameIndex() {
    if (_totalLen < 2) return 0;
    return Math.round(_frac * (_totalLen - 1));
  }

  // Build the state to render at the current frac:
  //   positions: [{x,y,z,mass, bodyId}]   — current body positions
  //   trail:     [{bodyId, samples}]      — trailing samples behind current
  function _buildState() {
    const idx = _currentFrameIndex();
    const trailLen = Math.max(0, Math.round(_trailFrac * _totalLen));
    const positions = [];
    const trails = [];
    for (const g of _byBody) {
      const s = g.samples;
      if (s.length === 0) continue;
      const i = Math.min(idx, s.length - 1);
      const cur = s[i];
      positions.push({
        bodyId: g.bodyId,
        x: cur.x, y: cur.y, z: cur.z || 0,
        mass: cur.mass !== undefined ? cur.mass : 1
      });
      const startIdx = Math.max(0, i - trailLen);
      const trailSamples = [];
      for (let j = startIdx; j <= i; j++) {
        const sm = s[j];
        trailSamples.push({ x: sm.x, y: sm.y, z: sm.z || 0 });
      }
      trails.push({ bodyId: g.bodyId, samples: trailSamples });
    }
    return { positions, trails, frac: _frac, idx, total: _totalLen };
  }

  function _renderFrame() {
    const state = _buildState();
    // Update the time readout
    const timeEl = $('play-time');
    if (timeEl) {
      timeEl.textContent = (state.idx + 1) + ' / ' + state.total;
    }
    // Hand off to app.js
    if (window.NBodyPlayback && window.NBodyPlayback.onRender) {
      window.NBodyPlayback.onRender(state);
    }
  }

  function _updateScrubber() {
    const el = $('play-scrub');
    if (!el) return;
    const v = Math.round(_frac * 1000);
    el.value = String(v);
    // Drive the CSS gradient that shows progress along the track
    el.style.setProperty('--scrub-pct', (_frac * 100).toFixed(1) + '%');
  }

  function _updatePlayButton() {
    const btn = $('play-play');
    if (!btn) return;
    if (_playing) {
      btn.textContent = '⏸';
      btn.classList.add('playing');
      btn.title = 'Pause (k)';
    } else {
      btn.textContent = '▶';
      btn.classList.remove('playing');
      btn.title = 'Play (k)';
    }
  }

  // ── Wire up DOM (after DOMContentLoaded) ─────────────────────────────
  function _wireUp() {
    const playBtn = $('play-play');
    const stopBtn = $('play-stop');
    const scrub   = $('play-scrub');
    const speed   = $('play-speed');
    const trail   = $('play-trail');

    if (playBtn) playBtn.addEventListener('click', () => {
      if (_playing) pause(); else play();
    });
    if (stopBtn) stopBtn.addEventListener('click', stop);
    if (scrub) scrub.addEventListener('input', (e) => {
      // User is dragging the scrubber — pause live playback and seek
      if (_playing) pause();
      const v = parseInt(e.target.value, 10) / 1000;
      seek(v);
    });
    if (speed) speed.addEventListener('change', (e) => setSpeed(e.target.value));
    if (trail) trail.addEventListener('input', (e) => {
      setTrailFrac(parseInt(e.target.value, 10) / 100);
      _renderFrame();
    });

    // Keyboard shortcut: 'k' toggles play/pause (matches video players)
    document.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (/^(INPUT|TEXTAREA|SELECT)$/i.test(tag)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        if (_playing) pause(); else play();
      }
    });

    _updatePlayButton();
    _updateScrubber();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _wireUp);
  } else {
    _wireUp();
  }

  // ── Expose ───────────────────────────────────────────────────────────
  window.NBodyPlayback = {
    setTrajectory, play, pause, stop, seek,
    isPlaying, getProgress, setSpeed, setTrailFrac, renderAt,
    // Hook that app.js fills in:
    onRender: null,
    // For diagnostics:
    _state: () => ({ frac: _frac, totalLen: _totalLen, playing: _playing, speed: _speed, trailFrac: _trailFrac })
  };
})();
