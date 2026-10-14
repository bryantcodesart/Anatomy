// The one requestAnimationFrame loop. Every system runs every tick, in this
// order. Reading this function top to bottom is reading the whole frame.
import type { Arena } from './arena';
import { commandSystem } from './systems/commands';
import { inputSystem } from './systems/input';
import { persistSystem } from './systems/persist';
import { sessionSystem } from './systems/session';
import { cameraSystem, fadeSystem, focusSystem, renderSystem, resizeSystem } from './systems/visual';

export function tick(a: Arena, t: number) {
  a.time.dt = Math.min(0.1, Math.max(0, (t - a.time.last) / 1000));
  a.time.last = t;
  a.time.now = Date.now();
  a.time.frame++;

  inputSystem(a); //    1. raw pointer deltas -> camera goals
  commandSystem(a); //  2. UI commands -> grading, settings, resets
  sessionSystem(a); //  3. pick next card, choose side, frame camera goal
  resizeSystem(a); //   4. canvas size -> renderer + aspect
  cameraSystem(a); //   5. damp camera toward goals, derive world position
  focusSystem(a); //    6. which parts are target / ghosted (uses camera position)
  fadeSystem(a); //     7. animate per-part state -> GPU state texture
  renderSystem(a); //   8. draw if anything changed
  persistSystem(a); //  9. throttled save to localStorage
}

export function start(a: Arena, onFrame: (a: Arena) => void) {
  const frame = (t: number) => {
    tick(a, t);
    onFrame(a); // 10. UI sync (pushes a snapshot to Solid when ui.version changed)
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
