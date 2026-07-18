// ============================================================================
// viz3d.js — Tiny zero-dependency 3D engine for trajectory visualization
// ============================================================================
// Phase 14 deliverable.
//
// ~180 LOC of hand-rolled 3D math: Vec3 ops, rotation matrices, perspective
// projection, mouse-drag camera control, auto-rotate. No Three.js, no WebGL,
// no external deps — just Canvas 2D + sin/cos.
//
// Public API:
//   Viz3D.Vec3(x, y, z)                    — Vec3 factory
//   Viz3D.rotX(v, a) / rotY / rotZ         — rotate Vec3 around axis
//   Viz3D.project(v, camera)               — perspective project to {x, y, scale}
//   Viz3D.Camera                            — class with yaw/pitch/dist/focal
//   Viz3D.Renderer                          — class, attaches to a canvas
//
// Renderer API:
//   const r = new Viz3D.Renderer(canvas);
//   r.setTrajectory(rows);                  // [{x,y,z,step,energy}, ...]
//   r.setBodies(bodies);                    // [{x,y,z,mass}, ...]
//   r.setAutoRotate(true);                  // slow spin when not dragging
//   r.render();                             // draw one frame
//   // Mouse drag on the canvas updates yaw/pitch automatically.
// ============================================================================

(function (global) {
  'use strict';

  // ── Vec3 ops (plain objects, no class allocation in hot loop) ─────────────
  function Vec3(x, y, z) { return { x: +x, y: +y, z: +z }; }
  function vAdd(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
  function vSub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
  function vScale(a, s) { return { x: a.x * s, y: a.y * s, z: a.z * s }; }
  function vDot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
  function vCross(a, b) {
    return {
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x
    };
  }
  function vLen(a) { return Math.sqrt(vDot(a, a)); }
  function vNorm(a) { const l = vLen(a) || 1; return vScale(a, 1 / l); }

  // ── Rotation matrices (right-handed, positive = counterclockwise) ────────
  function rotX(v, a) {
    const c = Math.cos(a), s = Math.sin(a);
    return { x: v.x, y: c * v.y - s * v.z, z: s * v.y + c * v.z };
  }
  function rotY(v, a) {
    const c = Math.cos(a), s = Math.sin(a);
    return { x: c * v.x + s * v.z, y: v.y, z: -s * v.x + c * v.z };
  }
  function rotZ(v, a) {
    const c = Math.cos(a), s = Math.sin(a);
    return { x: c * v.x - s * v.y, y: s * v.x + c * v.y, z: v.z };
  }

  // ── Camera ───────────────────────────────────────────────────────────────
  // Yaw rotates around Y axis (left/right drag), pitch around X (up/down drag).
  // `dist` is the camera distance from origin; `focal` is the perspective
  // focal length (larger = more orthographic, smaller = more fisheye).
  class Camera {
    constructor(opts) {
      opts = opts || {};
      this.yaw   = opts.yaw   ?? 0.6;     // ~34° — shows Z axis nicely
      this.pitch = opts.pitch ?? 0.3;     // ~17° — slight downward tilt
      this.dist  = opts.dist  ?? 8.0;     // pull back far enough to see orbit
      this.focal = opts.focal ?? 600;     // perspective strength
    }

    // Apply camera transform to a world-space point:
    //   1. Rotate by -yaw around Y, then -pitch around X (inverse camera rotation)
    //   2. Translate by -dist along Z (move camera to origin, push scene back)
    worldToView(v) {
      let p = rotY(v, -this.yaw);
      p = rotX(p, -this.pitch);
      p = { x: p.x, y: p.y, z: p.z + this.dist };
      return p;
    }
  }

  // Perspective projection: divide x and y by z, scale by focal length.
  // Returns null if the point is behind the camera (z <= 0).
  function project(v, camera, canvasW, canvasH) {
    const view = camera.worldToView(v);
    if (view.z <= 0.01) return null;  // behind camera, cull
    const sx = (view.x * camera.focal / view.z) + canvasW / 2;
    const sy = (-view.y * camera.focal / view.z) + canvasH / 2;  // flip Y (canvas Y grows down)
    return { x: sx, y: sy, scale: camera.focal / view.z, z: view.z };
  }

  // ── Renderer ─────────────────────────────────────────────────────────────
  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.camera = new Camera();
      // Phase 15: trajectories is now an array of {bodyId, samples:[{x,y,z,step,energy}, ...]}
      // For backwards compatibility, setTrajectory(rows) still accepts a flat
      // array and treats it as bodyId=0.
      this.trajectories = [];   // [{bodyId, samples}, ...]
      this.bodies = [];         // [{x,y,z,mass}, ...] — current positions
      this.stars = [];          // background star field
      this.autoRotate = true;
      this.dragging = false;
      this.lastMouse = null;
      // Phase 15: optional callback fired after camera changes (for URL hash sync)
      this.onCameraChange = null;
      // Phase 15: read initial camera state from URL hash (#cam=yaw,pitch,dist)
      this._loadCameraFromHash();
      // Debounce hash updates so rapid mouse drags don't thrash the URL
      this._hashUpdateTimer = null;

      // Generate a static star field (deterministic, doesn't change between frames)
      this._generateStars(180);

      // Mouse drag handlers
      canvas.addEventListener('mousedown', (e) => {
        this.dragging = true;
        this.lastMouse = { x: e.clientX, y: e.clientY };
        canvas.style.cursor = 'grabbing';
      });
      window.addEventListener('mouseup', () => {
        if (this.dragging) {
          this.dragging = false;
          canvas.style.cursor = 'grab';
          // Phase 15: sync camera to URL hash on mouse release
          this._saveCameraToHash();
        }
      });
      window.addEventListener('mousemove', (e) => {
        if (!this.dragging) return;
        const dx = e.clientX - this.lastMouse.x;
        const dy = e.clientY - this.lastMouse.y;
        this.camera.yaw   += dx * 0.008;
        this.camera.pitch += dy * 0.008;
        // Clamp pitch to avoid gimbal lock
        const lim = Math.PI / 2 - 0.05;
        if (this.camera.pitch >  lim) this.camera.pitch =  lim;
        if (this.camera.pitch < -lim) this.camera.pitch = -lim;
        this.lastMouse = { x: e.clientX, y: e.clientY };
      });

      // Wheel zoom
      canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        this.camera.dist *= (1 + e.deltaY * 0.001);
        if (this.camera.dist < 2)    this.camera.dist = 2;
        if (this.camera.dist > 50)   this.camera.dist = 50;
        // Phase 15: sync camera to URL hash after zoom (debounced)
        this._scheduleHashUpdate();
      }, { passive: false });

      // Phase 15: respond to URL hash changes (e.g., user pastes a share link)
      window.addEventListener('hashchange', () => this._loadCameraFromHash());

      canvas.style.cursor = 'grab';
    }

    // ── Phase 15: URL hash sync ────────────────────────────────────────────
    // Format: #cam=yaw,pitch,dist — shareable deep link to a specific 3D view.
    _loadCameraFromHash() {
      const h = (window.location.hash || '').replace(/^#/, '');
      if (!h.startsWith('cam=')) return;
      const parts = h.slice(4).split(',');
      if (parts.length !== 3) return;
      const yaw = parseFloat(parts[0]);
      const pitch = parseFloat(parts[1]);
      const dist = parseFloat(parts[2]);
      if (Number.isFinite(yaw))   this.camera.yaw   = yaw;
      if (Number.isFinite(pitch)) this.camera.pitch = pitch;
      if (Number.isFinite(dist))  this.camera.dist  = Math.max(2, Math.min(50, dist));
    }

    _saveCameraToHash() {
      const h = 'cam=' +
        this.camera.yaw.toFixed(3) + ',' +
        this.camera.pitch.toFixed(3) + ',' +
        this.camera.dist.toFixed(2);
      if (window.location.hash !== '#' + h) {
        // Use replaceState-style hash update to avoid creating extra history entries
        try {
          history.replaceState(null, '', '#' + h);
        } catch (_) {
          window.location.hash = h;
        }
      }
      if (this.onCameraChange) this.onCameraChange(this.camera);
    }

    _scheduleHashUpdate() {
      if (this._hashUpdateTimer) clearTimeout(this._hashUpdateTimer);
      this._hashUpdateTimer = setTimeout(() => this._saveCameraToHash(), 250);
    }

    _generateStars(n) {
      // Use mulberry32 from physics.js if available, else Math.random
      let rng;
      if (global.NBodyPhysics && global.NBodyPhysics.mulberry32) {
        rng = global.NBodyPhysics.mulberry32(2024);
      } else {
        rng = Math.random;
      }
      this.stars = [];
      for (let i = 0; i < n; i++) {
        // Place stars on a large sphere around the scene
        const theta = Math.acos(2 * rng() - 1);
        const phi = 2 * Math.PI * rng();
        const r = 40 + rng() * 10;
        this.stars.push({
          x: r * Math.sin(theta) * Math.cos(phi),
          y: r * Math.sin(theta) * Math.sin(phi),
          z: r * Math.cos(theta),
          brightness: 0.3 + rng() * 0.7
        });
      }
    }

    // Phase 15: setTrajectory accepts either:
    //   (a) flat array of samples — treated as bodyId=0 (backwards compat)
    //   (b) array of {bodyId, samples} — multi-body shape (preferred)
    setTrajectory(rowsOrByBody) {
      if (!Array.isArray(rowsOrByBody)) {
        this.trajectories = [];
        return;
      }
      // Detect multi-body shape: first element has a `samples` array
      if (rowsOrByBody.length > 0 && Array.isArray(rowsOrByBody[0].samples)) {
        this.trajectories = rowsOrByBody.map(g => ({
          bodyId: g.bodyId,
          samples: g.samples || []
        }));
      } else {
        // Flat-array shape — wrap as single-body for backwards compat
        this.trajectories = [{ bodyId: 0, samples: rowsOrByBody }];
      }
    }
    setBodies(bodies)   { this.bodies = bodies || []; }
    setAutoRotate(v)    { this.autoRotate = !!v; }
    resetCamera() {
      this.camera.yaw = 0.6;
      this.camera.pitch = 0.3;
      this.camera.dist = 8.0;
      this._saveCameraToHash();
    }

    // Phase 15: deterministic per-body color (HSL wheel).
    // bodyId 0 → red (sun/primary), 1 → cyan, 2 → lime, etc.
    bodyColor(bodyId, alpha) {
      const hue = (bodyId * 137.508) % 360;  // golden-angle stepping
      const sat = 80;
      const light = 60;
      if (alpha === undefined) return 'hsl(' + hue + ',' + sat + '%,' + light + '%)';
      return 'hsla(' + hue + ',' + sat + '%,' + light + '%,' + alpha + ')';
    }

    // Phase 21: per-body tint lookup that honors named colors from the
    // physics layer (Sun, Mercury, Venus, Earth, Mars, Jupiter, Saturn,
    // Uranus, Neptune, Moon, Halley). Falls back to bodyColor() for
    // synthetic scenarios (figure-8, binary, etc.) where bodies don't
    // have a baked-in color.
    bodyTint(bodyId, alpha) {
      const b = this.bodies[bodyId];
      if (b && typeof b.color === 'string' && b.color[0] === '#') {
        // Convert #rrggbb → rgba() with optional alpha
        const hex = b.color.slice(1);
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const bl = parseInt(hex.slice(4, 6), 16);
        if (alpha === undefined) return 'rgb(' + r + ',' + g + ',' + bl + ')';
        return 'rgba(' + r + ',' + g + ',' + bl + ',' + alpha + ')';
      }
      return this.bodyColor(bodyId, alpha);
    }

    // Phase 21: Draw a comet tail for any body marked isComet.
    // Anti-solar direction (away from the Sun / first body). Two-layer tail:
    //   - ion (blue, straight, narrow, points exactly anti-solar)
    //   - dust (white-cream, curved, wider)
    // Length scales with 1/r² (closer to Sun = more sublimation = longer tail).
    // Uses additive blending for the glow. The Sun is taken as the first body
    // in the system (bodies[0]); if no Sun exists, no tail is drawn.
    drawCometTail(bodyIndex, ctx, W, H) {
      const b = this.bodies[bodyIndex];
      if (!b || !b.isComet) return;
      const sun = this.bodies[0];
      if (!sun) return;

      // Anti-solar direction in world space (comet → away from Sun)
      const dx = b.x - sun.x;
      const dy = b.y - sun.y;
      const dz = b.z - sun.z;
      const rSun = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (rSun < 1e-6) return;  // sitting on the Sun — no tail

      // Distance to Sun in sim units (AU). Tail length scales as 1/r² — at
      // r=1 AU the tail is `BASE_LEN` long; at r=0.5 AU it's 4× longer; at
      // r=5 AU it shrinks to 4% of BASE_LEN. This is a cartoon of the real
      // 1/r² sublimation rate (actual comet tails also depend on helio-
      // centric latitude, nucleus active area, etc.).
      const BASE_LEN = 2.5;
      const tailLen = BASE_LEN / Math.max(0.1, rSun * rSun);
      // Tail length capped so we don't draw a screen-filling comet at perihelion
      const tailLenCapped = Math.min(tailLen, 8.0);

      // Unit anti-solar vector
      const ux = dx / rSun;
      const uy = dy / rSun;
      const uz = dz / rSun;

      // Project the comet position (head) — already projected by caller,
      // but we re-project here so we can compute screen-space direction.
      const pHead = project(b, this.camera, W, H);
      if (!pHead) return;

      // Tail tip = head + tailLen · anti-solar unit vector (world space)
      const tip = {
        x: b.x + ux * tailLenCapped,
        y: b.y + uy * tailLenCapped,
        z: b.z + uz * tailLenCapped
      };
      const pTip = project(tip, this.camera, W, H);
      if (!pTip) return;

      // Curved dust tail: bend the tip by ~25° in the direction of orbital
      // motion (perpendicular to anti-solar, in the orbital plane). We don't
      // have the orbital plane here without velocity, so we approximate by
      // using the comet's velocity direction projected onto the plane
      // perpendicular to the anti-solar vector. If velocity is missing,
      // skip the curve (just use the straight tip).
      let pTipDust = pTip;
      if (typeof b.vx === 'number' && typeof b.vy === 'number' && typeof b.vz === 'number') {
        // Tangent direction: velocity component perpendicular to anti-solar
        const vDotU = b.vx * ux + b.vy * uy + b.vz * uz;
        let tx = b.vx - vDotU * ux;
        let ty = b.vy - vDotU * uy;
        let tz = b.vz - vDotU * uz;
        const tLen = Math.sqrt(tx * tx + ty * ty + tz * tz);
        if (tLen > 1e-6) {
          tx /= tLen; ty /= tLen; tz /= tLen;
          // Dust tail bends ~25° off the anti-solar axis (real Halley at
          // 1986 perihelion: ~12° dust lag angle; we exaggerate to 25° for
          // visibility).
          const dustBend = 0.42;  // sin(25°) ≈ 0.42
          const cosBend = 0.91;   // cos(25°)
          const dustTip = {
            x: b.x + (ux * cosBend + tx * dustBend) * tailLenCapped * 0.85,
            y: b.y + (uy * cosBend + ty * dustBend) * tailLenCapped * 0.85,
            z: b.z + (uz * cosBend + tz * dustBend) * tailLenCapped * 0.85
          };
          const pDust = project(dustTip, this.camera, W, H);
          if (pDust) pTipDust = pDust;
        }
      }

      // ── Draw the ion tail (blue, straight, narrow) ─────────────────────
      // Multiple stroked layers from wide+faint to narrow+bright for a glow.
      const ionColor = 'rgba(120, 200, 255, ';  // cool blue
      const headX = pHead.x, headY = pHead.y;
      const ionTipX = pTip.x, ionTipY = pTip.y;

      const ionLayers = [
        { w: 14, a: 0.05 },
        { w: 8,  a: 0.12 },
        { w: 4,  a: 0.25 },
        { w: 2,  a: 0.50 }
      ];
      for (const layer of ionLayers) {
        ctx.strokeStyle = ionColor + layer.a + ')';
        ctx.lineWidth = layer.w;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(headX, headY);
        ctx.lineTo(ionTipX, ionTipY);
        ctx.stroke();
      }

      // ── Draw the dust tail (cream, curved, wider) ──────────────────────
      // Quadratic curve from head → control point → dust tip.
      const dustColor = 'rgba(255, 235, 200, ';  // warm cream
      const dustTipX = pTipDust.x, dustTipY = pTipDust.y;
      const ctrlX = (headX + dustTipX) / 2 + (dustTipX - headX) * 0.1;
      const ctrlY = (headY + dustTipY) / 2 + (dustTipY - headY) * 0.1;

      const dustLayers = [
        { w: 18, a: 0.04 },
        { w: 10, a: 0.09 },
        { w: 5,  a: 0.18 },
        { w: 2.5, a: 0.35 }
      ];
      for (const layer of dustLayers) {
        ctx.strokeStyle = dustColor + layer.a + ')';
        ctx.lineWidth = layer.w;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(headX, headY);
        ctx.quadraticCurveTo(ctrlX, ctrlY, dustTipX, dustTipY);
        ctx.stroke();
      }
    }

    // Render one frame. Call from a requestAnimationFrame loop OR on demand.
    render() {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;

      // Auto-rotate when not dragging
      if (this.autoRotate && !this.dragging) {
        this.camera.yaw += 0.003;
      }

      // Pure black background (user feedback: "keep the background complete black")
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, W, H);

      // ── Star field (project stars, draw as faint dots) ──────────────────
      // Phase 18: drawn with normal blending first so they stay subtle.
      for (const s of this.stars) {
        const p = project(s, this.camera, W, H);
        if (!p) continue;
        const alpha = s.brightness * 0.55;
        ctx.fillStyle = 'rgba(255,255,255,' + alpha.toFixed(3) + ')';
        ctx.fillRect(p.x, p.y, 1, 1);
      }

      // ── Phase 18: ADDITIVE BLENDING for trails + body glows ─────────────
      // 'lighter' makes overlapping RGB add up — neon bloom against pure
      // black, just like the 2D renderer. Stars above are already drawn;
      // we now switch composite op for everything that should "pop".
      ctx.globalCompositeOperation = 'lighter';

      // ── Multi-body trajectories (Phase 15) ──────────────────────────────
      // Each body's trajectory gets its own color (HSL golden-angle wheel,
      // or the body's real color if it has one — Phase 21).
      // Within a body's trajectory, older samples fade to lower alpha so the
      // head of the trail is bright and the tail dims into the background.
      let totalSamples = 0;
      for (const traj of this.trajectories) {
        const samples = traj.samples;
        if (samples.length < 2) { totalSamples += samples.length; continue; }

        // Pass 1: faint wide bloom underlay (the "neon halo" behind each trail)
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (let i = 1; i < samples.length; i++) {
          const a = project(samples[i - 1], this.camera, W, H);
          const b = project(samples[i], this.camera, W, H);
          if (!a || !b) continue;
          const t = i / samples.length;
          const alpha = 0.10 + 0.20 * t;
          ctx.strokeStyle = this.bodyTint(traj.bodyId, alpha);
          ctx.lineWidth = 5;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }

        // Pass 2: bright core stroke
        for (let i = 1; i < samples.length; i++) {
          const a = project(samples[i - 1], this.camera, W, H);
          const b = project(samples[i], this.camera, W, H);
          if (!a || !b) continue;
          const t = i / samples.length;
          const alpha = 0.30 + 0.70 * t;
          ctx.strokeStyle = this.bodyTint(traj.bodyId, alpha);
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
        totalSamples += samples.length;
      }

      // ── Phase 21: Comet tails (drawn BEFORE body glows so the comet head
      // glow sits on top of the tail's origin, looking like the head is
      // "emitting" the tail. Still under additive blending.)
      for (let i = 0; i < this.bodies.length; i++) {
        this.drawCometTail(i, ctx, W, H);
      }

      // ── Body points (current positions, Phase 15: color per body) ───────
      // Phase 18: layered glow — outer wide bloom, mid halo, then a crisp
      // white core (drawn with normal blending so it stays sharp).
      // Phase 21: use bodyTint() so each body renders in its real color
      // (Earth blue, Mars red, Halley blue, etc.) instead of the HSL wheel.
      for (let i = 0; i < this.bodies.length; i++) {
        const b = this.bodies[i];
        const p = project(b, this.camera, W, H);
        if (!p) continue;
        // Phase 21: comets get a larger radius than their tiny mass would
        // suggest, so they're visible. Halley's mass is ~1e-16 (rendering
        // fiction); we use a fixed minimum radius for comets.
        const isComet = !!b.isComet;
        const baseR = isComet ? 3.0 : Math.cbrt(Math.max(1e-9, b.mass)) * 3;
        const radius = Math.max(1.5, baseR * (p.scale / 100));
        // Outer wide bloom
        const bloom = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius * 4.5);
        bloom.addColorStop(0,   this.bodyTint(i, 0.55));
        bloom.addColorStop(0.4, this.bodyTint(i, 0.18));
        bloom.addColorStop(1,   this.bodyTint(i, 0));
        ctx.fillStyle = bloom;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius * 4.5, 0, Math.PI * 2);
        ctx.fill();
        // Mid glow
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius * 2.2);
        grad.addColorStop(0,   this.bodyTint(i, 0.95));
        grad.addColorStop(0.5, this.bodyTint(i, 0.35));
        grad.addColorStop(1,   this.bodyTint(i, 0));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius * 2.2, 0, Math.PI * 2);
        ctx.fill();
      }

      // ── Restore normal blending for the crisp white cores + HUD ─────────
      ctx.globalCompositeOperation = 'source-over';
      for (let i = 0; i < this.bodies.length; i++) {
        const b = this.bodies[i];
        const p = project(b, this.camera, W, H);
        if (!p) continue;
        const radius = Math.max(1.5, Math.cbrt(Math.max(1e-9, b.mass)) * 3 * (p.scale / 100));
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }

      // ── HUD overlay (camera params + body count) ────────────────────────
      ctx.fillStyle = 'rgba(139,148,158,0.8)';
      ctx.font = '10px monospace';
      ctx.fillText('yaw=' + this.camera.yaw.toFixed(2) +
                   '  pitch=' + this.camera.pitch.toFixed(2) +
                   '  dist=' + this.camera.dist.toFixed(1) +
                   (this.autoRotate ? '  [auto-rotate]' : '  [paused]'),
                   8, H - 8);
      ctx.fillText('drag to rotate · wheel to zoom · N=' + this.bodies.length +
                   ' · trails=' + this.trajectories.length + ' · samples=' + totalSamples,
                   8, 14);
    }

    // Start a requestAnimationFrame loop. Returns a stop() function.
    startAnimationLoop() {
      let running = true;
      const loop = () => {
        if (!running) return;
        this.render();
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
      return () => { running = false; };
    }
  }

  global.Viz3D = {
    Vec3, vAdd, vSub, vScale, vDot, vCross, vLen, vNorm,
    rotX, rotY, rotZ,
    Camera, project, Renderer
  };

})(typeof window !== 'undefined' ? window : globalThis);
