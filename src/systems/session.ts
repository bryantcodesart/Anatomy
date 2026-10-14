// Flash-card state machine. On Phase.Advance it asks the scheduler for the next
// card, picks a random side (left/right copy), and computes the camera framing.
import { type Arena, Phase, rand } from '../arena';
import { pickNext } from '../srs/scheduler';
import { segmentHitsBox as rayHitsBox } from './geom';

const BODY_PIVOT = [0, 0.98, 0];

export function sessionSystem(a: Arena) {
  const s = a.session, now = a.time.now;
  if (s.paused) return;

  if (s.phase === Phase.Boot) s.phase = Phase.Advance;

  if (s.phase === Phase.Empty && now - s.countsAt > 5000) {
    // something may have become due (learning steps); check again
    if (pickNext(a, now, s.ahead) >= 0) s.phase = Phase.Advance;
    a.ui.version++;
  }

  if (s.phase !== Phase.Advance) return;

  const next = pickNext(a, now, s.ahead);
  s.prevCard = s.card;
  clearTarget(a);
  if (next < 0) {
    s.card = -1;
    s.phase = Phase.Empty;
    s.ahead = false;
    frameWholeBody(a);
  } else {
    s.card = next;
    const inst = a.db.cards[next].inst;
    s.inst = inst.length > 1 ? (rand(a) < 0.5 ? 0 : 1) : 0;
    setTarget(a, inst[s.inst].parts);
    frameTarget(a, inst[s.inst].side);
    s.phase = Phase.Asking;
    s.shownAt = now;
  }
  a.ui.version++;
}

function clearTarget(a: Arena) {
  a.parts.isTarget.fill(0);
  a.focus.active = false;
}

function setTarget(a: Arena, parts: number[]) {
  const f = a.focus, P = a.parts;
  f.min.fill(Infinity);
  f.max.fill(-Infinity);
  for (const p of parts) {
    P.isTarget[p] = 1;
    for (let k = 0; k < 3; k++) {
      f.min[k] = Math.min(f.min[k], P.min[p * 3 + k]);
      f.max[k] = Math.max(f.max[k], P.max[p * 3 + k]);
    }
  }
  for (let k = 0; k < 3; k++) f.center[k] = (f.min[k] + f.max[k]) / 2;
  f.radius = Math.max(0.02, 0.5 * Math.hypot(f.max[0] - f.min[0], f.max[1] - f.min[1], f.max[2] - f.min[2]));
  f.active = true;
}

function frameWholeBody(a: Arena) {
  const c = a.cam;
  c.homePivot.set(BODY_PIVOT);
  c.homeYaw = 0.35;
  c.homePitch = 0.08;
  c.homeDist = fitDistance(a, 1.0);
  goHome(a);
}

function goHome(a: Arena) {
  const c = a.cam;
  c.pivotGoal.set(c.homePivot);
  c.distGoal = c.homeDist;
  c.pitchGoal = c.homePitch;
  // rotate to the new yaw along the shortest arc from where we are
  let d = c.homeYaw - c.yawGoal;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  c.yawGoal += d;
  c.homeYaw = c.yawGoal;
}

/** Distance at which a sphere of radius r fills the view (portrait-safe). */
function fitDistance(a: Arena, r: number) {
  const t = Math.tan((a.cam.fovY * Math.PI) / 360) * a.cam.visibleFrac;
  const vfov = 2 * Math.atan(t);
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * a.cam.aspect);
  // leave room for the card UI at the bottom on phones
  return (r / Math.sin(Math.min(vfov, hfov) / 2)) * 1.1;
}

const YAWS = 16;
const PITCHES = [-0.35, 0, 0.35, 0.75];

/**
 * Choose a view direction around the target that sees it through as little
 * other anatomy as possible. Casts 5 rays (center + 4 offsets) per candidate
 * direction against every part's AABB; bones count more than muscles since
 * even ghosted they clutter the view. Biased to the side the copy is on.
 */
function frameTarget(a: Arena, side: 'L' | 'R' | 'M') {
  const f = a.focus, P = a.parts, n = a.nParts, c = a.cam;
  const dist = Math.max(0.12, fitDistance(a, f.radius));
  let best = Infinity, bestYaw = 0, bestPitch = 0;
  const off = f.radius * 0.45;
  for (let yi = 0; yi < YAWS; yi++) {
    const yaw = (yi / YAWS) * Math.PI * 2;
    for (const pitch of PITCHES) {
      const dx = Math.sin(yaw) * Math.cos(pitch), dy = Math.sin(pitch), dz = Math.cos(yaw) * Math.cos(pitch);
      // perpendicular basis for offset rays
      const rx = Math.cos(yaw), rz = -Math.sin(yaw);
      const ux = -Math.sin(yaw) * dy, uy = Math.cos(pitch), uz = -Math.cos(yaw) * dy;
      let cost = 0;
      for (let ray = 0; ray < 5; ray++) {
        const sx = ray === 1 ? off : ray === 2 ? -off : 0;
        const sy = ray === 3 ? off : ray === 4 ? -off : 0;
        const ox = f.center[0] + rx * sx + ux * sy;
        const oy = f.center[1] + uy * sy;
        const oz = f.center[2] + rz * sx + uz * sy;
        for (let p = 0; p < n; p++) {
          if (P.isTarget[p]) continue;
          if (rayHitsBox(ox, oy, oz, dx, dy, dz, dist, P.min, P.max, p, 0.12)) cost += P.kind[p] === 0 ? 2.5 : 1;
        }
      }
      // preferences: look from the copy's own side, mostly level, front over back
      const lateral = side === 'L' ? dx : side === 'R' ? -dx : 0; // L copy lives at +x
      cost += Math.max(0, -lateral) * 12;
      cost += Math.abs(pitch) * 3;
      cost += (1 - dz) * 0.8;
      if (cost < best) { best = cost; bestYaw = yaw; bestPitch = pitch; }
    }
  }
  c.homePivot.set(f.center);
  c.homeYaw = bestYaw;
  c.homePitch = bestPitch;
  c.homeDist = dist;
  goHome(a);
}
