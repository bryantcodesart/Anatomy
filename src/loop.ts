// The one requestAnimationFrame loop. Every system runs every tick, in this
// order. Reading this function top to bottom is reading the whole frame.
import type { Arena } from './arena';
import { commandSystem } from './systems/commands';
import { inputSystem } from './systems/input';
import { persistSystem } from './systems/persist';
import { pickSystem } from './systems/pick';
import { sessionSystem } from './systems/session';
import { cameraSystem, fadeSystem, focusSystem, renderSystem, resizeSystem } from './systems/visual';

export function tick(a: Arena, t: number) {
  a.time.dt = Math.min(0.1, Math.max(0, (t - a.time.last) / 1000));
  a.time.last = t;
  a.time.now = Date.now();
  a.time.frame++;

  inputSystem(a); //    1. raw pointer deltas -> camera goals
  pickSystem(a); //     2. lookup mode: tap -> ray cast -> selection request
  commandSystem(a); //  3. UI commands -> grading, settings, mode, resets
  sessionSystem(a); //  4. study: next card + side + camera; lookup: apply selection
  resizeSystem(a); //   5. canvas size -> renderer + aspect
  cameraSystem(a); //   6. damp camera toward goals, derive world position
  focusSystem(a); //    7. which parts are target / ghosted (uses camera position)
  fadeSystem(a); //     8. animate per-part state -> GPU state texture
  renderSystem(a); //   9. draw if anything changed
  persistSystem(a); // 10. throttled save to localStorage
}

export function start(a: Arena, onFrame: (a: Arena) => void) {
  const frame = (t: number) => {
    tick(a, t);
    onFrame(a); // 11. UI sync (pushes a snapshot to Solid when ui.version changed)
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
