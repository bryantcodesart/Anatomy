// Input: DOM listeners only *record* raw pointer data into arena.input.
// inputSystem() runs every tick and turns the accumulated deltas into camera goals.
import type { Arena } from '../arena';

export function attachInput(a: Arena, el: HTMLElement) {
  const inp = a.input;
  const slot = (id: number) => (inp.id[0] === id ? 0 : inp.id[1] === id ? 1 : -1);
  const fingers = () => inp.down[0] + inp.down[1];
  const pinch = () => Math.hypot(inp.x[0] - inp.x[1], inp.y[0] - inp.y[1]);
  let panButton = false;

  el.addEventListener('pointerdown', (e) => {
    const s = inp.down[0] ? (inp.down[1] ? -1 : 1) : 0;
    if (s < 0) return;
    el.setPointerCapture(e.pointerId);
    inp.id[s] = e.pointerId; inp.down[s] = 1; inp.x[s] = e.clientX; inp.y[s] = e.clientY;
    panButton = e.button === 2 || e.shiftKey;
    if (fingers() === 2) inp.pinchDist = pinch();
    if (fingers() === 1) { inp.downX = e.clientX; inp.downY = e.clientY; inp.downT = performance.now(); inp.moved = 0; }
    else inp.moved = 1e9; // multi-touch is never a tap
  });
  el.addEventListener('pointermove', (e) => {
    const s = slot(e.pointerId);
    if (s < 0 || !inp.down[s]) return;
    const dx = e.clientX - inp.x[s], dy = e.clientY - inp.y[s];
    inp.x[s] = e.clientX; inp.y[s] = e.clientY;
    inp.moved = Math.max(inp.moved, Math.hypot(e.clientX - inp.downX, e.clientY - inp.downY));
    if (fingers() === 2) {
      const d = pinch();
      if (inp.pinchDist > 0) inp.zoom += Math.log(inp.pinchDist / d);
      inp.pinchDist = d;
      inp.panX += dx / 2; inp.panY += dy / 2;
    } else if (panButton) {
      inp.panX += dx; inp.panY += dy;
    } else {
      inp.orbitX += dx; inp.orbitY += dy;
    }
  });
  const up = (e: PointerEvent) => {
    const s = slot(e.pointerId);
    if (s < 0) return;
    if (e.type === 'pointerup' && fingers() === 1 && inp.moved < 8 && performance.now() - inp.downT < 400) {
      const r = el.getBoundingClientRect();
      inp.tap = 1; inp.tapX = e.clientX - r.left; inp.tapY = e.clientY - r.top;
    }
    inp.down[s] = 0; inp.id[s] = -1; inp.pinchDist = 0;
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener('wheel', (e) => { e.preventDefault(); inp.zoom += e.deltaY * 0.0012; }, { passive: false });
}

export function inputSystem(a: Arena) {
  const inp = a.input, cam = a.cam;
  if (inp.orbitX || inp.orbitY) {
    cam.yawGoal -= inp.orbitX * 0.008;
    cam.pitchGoal = Math.max(-1.45, Math.min(1.45, cam.pitchGoal + inp.orbitY * 0.006));
  }
  if (inp.zoom) cam.distGoal = Math.max(0.06, Math.min(5, cam.distGoal * Math.exp(inp.zoom)));
  if (inp.panX || inp.panY) {
    // pan in the camera plane, scaled by distance
    const k = cam.dist * 0.0016;
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), sp = Math.sin(cam.pitch), cp = Math.cos(cam.pitch);
    // right = (cos yaw, 0, -sin yaw); up = (-sin yaw*sin pitch, cos pitch, -cos yaw*sin pitch)
    cam.pivotGoal[0] += (-inp.panX * cy + inp.panY * -sy * sp) * k;
    cam.pivotGoal[1] += (inp.panY * cp) * k;
    cam.pivotGoal[2] += (inp.panX * sy + inp.panY * -cy * sp) * k;
  }
  inp.orbitX = inp.orbitY = inp.panX = inp.panY = inp.zoom = 0;
}
