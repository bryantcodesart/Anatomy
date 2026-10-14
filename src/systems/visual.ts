// Per-tick visual systems: focus (decide goals), camera (damp toward goals),
// fade (animate per-part state into the GPU texture), render.
import { type Arena, Phase } from '../arena';
import { boxGap, segmentHitsBox } from './geom';

const GHOST_MUSCLE = 0.16;
const GHOST_BONE = 0.22;

/**
 * Decide each part's goal opacity + highlight.
 *  - target parts: opaque, highlighted
 *  - parts in the target's vicinity, or between the camera and the target: ghosted
 *  - everything else: opaque
 * Runs every tick so that free-orbiting re-evaluates what is in the way.
 */
export function focusSystem(a: Arena) {
  const P = a.parts, f = a.focus, n = a.nParts;
  if (!f.active) {
    P.alphaGoal.fill(1);
    P.hiGoal.fill(0);
    return;
  }
  const revealed = a.session.phase === Phase.Revealed || a.session.phase === Phase.Lookup;
  const near = Math.max(0.015, f.radius * 0.35);
  const cx = a.cam.pos[0], cy = a.cam.pos[1], cz = a.cam.pos[2];
  // rays from camera to the target center and to 4 points on its bounds
  const r = f.radius * 0.5;
  for (let p = 0; p < n; p++) {
    if (P.isTarget[p]) {
      P.alphaGoal[p] = 1;
      P.hiGoal[p] = revealed ? 0.8 : 1;
      continue;
    }
    P.hiGoal[p] = 0;
    let ghost = f.isolate || boxGap(P.min, P.max, p, f.min, f.max) < near;
    for (let k = 0; !ghost && k < 5; k++) {
      const tx = f.center[0] + (k === 1 ? r : k === 2 ? -r : 0);
      const ty = f.center[1] + (k === 3 ? r : k === 4 ? -r : 0);
      const tz = f.center[2];
      const dx = tx - cx, dy = ty - cy, dz = tz - cz;
      const len = Math.hypot(dx, dy, dz);
      if (len < 1e-6) continue;
      ghost = segmentHitsBox(cx, cy, cz, dx / len, dy / len, dz / len, len, P.min, P.max, p, 0.08);
    }
    P.alphaGoal[p] = ghost ? (P.kind[p] === 0 ? GHOST_BONE : GHOST_MUSCLE) : 1;
  }
}

/** Critically-damped-ish exponential smoothing of the orbit camera toward its goals. */
export function cameraSystem(a: Arena) {
  const c = a.cam, dt = a.time.dt;
  const k = 1 - Math.exp(-dt * 5);
  const before = c.yaw + c.pitch * 3 + c.dist * 7 + c.pivot[0] + c.pivot[1] * 5 + c.pivot[2] * 11;
  c.yaw += (c.yawGoal - c.yaw) * k;
  c.pitch += (c.pitchGoal - c.pitch) * k;
  // zoom in log space so it feels uniform at every scale
  c.dist = Math.exp(Math.log(c.dist) + (Math.log(c.distGoal) - Math.log(c.dist)) * k);
  for (let i = 0; i < 3; i++) c.pivot[i] += (c.pivotGoal[i] - c.pivot[i]) * k;
  const after = c.yaw + c.pitch * 3 + c.dist * 7 + c.pivot[0] + c.pivot[1] * 5 + c.pivot[2] * 11;

  const cp = Math.cos(c.pitch);
  c.pos[0] = c.pivot[0] + c.dist * Math.sin(c.yaw) * cp;
  c.pos[1] = c.pivot[1] + c.dist * Math.sin(c.pitch);
  c.pos[2] = c.pivot[2] + c.dist * Math.cos(c.yaw) * cp;

  const cam = a.gfx.camera;
  cam.position.set(c.pos[0], c.pos[1], c.pos[2]);
  cam.lookAt(c.pivot[0], c.pivot[1], c.pivot[2]);
  cam.near = Math.max(0.005, c.dist * 0.05);
  cam.far = c.dist + 4;
  cam.updateProjectionMatrix();
  if (Math.abs(after - before) > 1e-6) a.gfx.dirty = true;
}

/** Animate current per-part state toward goals; pack into the state texture. */
export function fadeSystem(a: Arena) {
  const P = a.parts, n = a.nParts, data = a.gfx.stateData;
  const k = a.focus.isolate ? 1 : 1 - Math.exp(-a.time.dt * 7); // audit mode snaps
  let changed = false;
  for (let p = 0; p < n; p++) {
    let al = P.alpha[p], hi = P.hi[p];
    const ag = P.alphaGoal[p], hg = P.hiGoal[p];
    if (al !== ag) { al += (ag - al) * k; if (Math.abs(ag - al) < 0.004) al = ag; P.alpha[p] = al; }
    if (hi !== hg) { hi += (hg - hi) * k; if (Math.abs(hg - hi) < 0.004) hi = hg; P.hi[p] = hi; }
    const R = Math.round(hi * 255), G = al >= 1 ? 255 : Math.min(254, Math.round(al * 255));
    if (data[p * 4] !== R || data[p * 4 + 1] !== G) {
      data[p * 4] = R; data[p * 4 + 1] = G; changed = true;
    }
  }
  if (changed) { a.gfx.stateTex.needsUpdate = true; a.gfx.dirty = true; }
}

export function resizeSystem(a: Arena) {
  const g = a.gfx, el = g.renderer.domElement;
  const w = el.clientWidth, h = el.clientHeight;
  const inset = g.insetBottom * 10007 + g.insetRight;
  if (w === g.width && h === g.height && inset === g.appliedInset) return;
  g.width = w; g.height = h; g.appliedInset = inset;
  g.renderer.setSize(w, h, false);
  g.camera.aspect = w / Math.max(1, h);
  // The card UI covers part of the canvas: shift the projection so the orbit
  // pivot sits in the middle of the *visible* area, and frame for that area.
  const vw = Math.max(1, w - g.insetRight), vh = Math.max(1, h - g.insetBottom);
  g.camera.setViewOffset(w, h, g.insetRight / 2, g.insetBottom / 2, w, h);
  a.cam.aspect = vw / vh;
  a.cam.visibleFrac = vh / h;
  g.dirty = true;
}

export function renderSystem(a: Arena) {
  const g = a.gfx;
  // the highlight pulses, so keep drawing while something is highlighted
  if (a.focus.active && !a.focus.isolate) { g.uniforms.uTime.value = a.time.now / 1000 % 1000; g.dirty = true; }
  if (!g.dirty || a.session.paused) return;
  g.renderer.render(g.scene, g.camera);
  g.dirty = false;
}
