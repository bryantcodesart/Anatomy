// ?audit — developer hook used to visually verify every card's highlighted meshes.
// window.__audit.show(cardIndex, instIndex) isolates that card and snaps the camera.
import { type Arena, Phase } from './arena';
import { clearTarget, frameTarget, setTarget } from './systems/session';

export function installAudit(a: Arena) {
  a.session.paused = false;
  a.focus.isolate = true;
  (window as unknown as { __audit: unknown }).__audit = {
    count: a.nCards,
    card: (i: number) => a.db.cards[i],
    show(i: number, inst = 0) {
      const card = a.db.cards[i];
      const k = Math.min(inst, card.inst.length - 1);
      clearTarget(a);
      setTarget(a, card.inst[k].parts);
      a.session.card = i;
      a.session.inst = k;
      a.session.phase = Phase.Asking;
      frameTarget(a, card.inst[k].side, card.inst[k].view);
      const c = a.cam;
      c.yaw = c.yawGoal; c.pitch = c.pitchGoal; c.dist = c.distGoal; c.pivot.set(c.pivotGoal);
      // snap fades on the next tick
      a.time.last = performance.now() - 5000;
      a.ui.version++;
    },
  };
}
