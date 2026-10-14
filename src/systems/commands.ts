// Drains the command queue written by the UI. Each command is a small, explicit
// state transition; nothing else in the app mutates settings or memory state.
import { type Arena, Cmd, MAX_TIER, Mode, Phase } from '../arena';
import type { GradeN } from '../srs/fsrs';
import { grade, previewIntervals, resetCards } from '../srs/scheduler';

export function commandSystem(a: Arena) {
  const q = a.cmd, s = a.session, set = a.settings;
  for (let k = 0; k < q.count; k++) {
    const arg = q.arg[k];
    switch (q.type[k] as Cmd) {
      case Cmd.Reveal:
        if (s.phase === Phase.Asking) {
          s.phase = Phase.Revealed;
          previewIntervals(a, s.card, a.time.now, s.intervals);
        }
        break;
      case Cmd.Grade:
        if (s.phase === Phase.Revealed && s.card >= 0) {
          grade(a, s.card, arg as GradeN, a.time.now);
          s.phase = Phase.Advance;
        }
        break;
      case Cmd.Skip:
        if (s.phase === Phase.Asking || s.phase === Phase.Revealed) s.phase = Phase.Advance;
        break;
      case Cmd.Recenter:
        a.cam.yawGoal = a.cam.homeYaw;
        a.cam.pitchGoal = a.cam.homePitch;
        a.cam.distGoal = a.cam.homeDist;
        a.cam.pivotGoal.set(a.cam.homePivot);
        break;
      case Cmd.StudyAhead:
        s.ahead = true;
        if (s.phase === Phase.Empty) s.phase = Phase.Advance;
        break;
      case Cmd.SetTierEnabled:
        set.tierEnabled[Math.floor(arg / 10)] = arg % 10;
        break;
      case Cmd.SetTierForced:
        set.tierForced[Math.floor(arg / 10)] = arg % 10;
        break;
      case Cmd.SetRetention:
        set.retention = Math.min(0.97, Math.max(0.7, arg));
        break;
      case Cmd.SetNewPerDay:
        set.newPerDay = Math.max(0, Math.min(200, Math.round(arg)));
        break;
      case Cmd.SetKindEnabled:
        set.kindEnabled[Math.floor(arg / 10)] = arg % 10;
        break;
      case Cmd.ResetTier:
        if (arg >= 1 && arg <= MAX_TIER) resetCards(a, arg);
        break;
      case Cmd.ResetAll:
        resetCards(a, 0);
        set.tierForced.fill(0);
        break;
      case Cmd.Pause:
        s.paused = arg === 1;
        break;
      case Cmd.SetMode:
        if (arg === s.mode) break;
        s.mode = arg as Mode;
        // entering lookup shows the whole body; returning to study re-picks the
        // next due card (the one being asked was never graded, so nothing is lost)
        if (s.mode === Mode.Lookup) { s.phase = Phase.Browse; s.lookupReq = -1; }
        else { s.phase = Phase.Advance; s.lookupReq = -2; }
        break;
      case Cmd.LookupShow:
        if (s.mode === Mode.Lookup) s.lookupReq = arg;
        break;
      case Cmd.LookupClear:
        if (s.mode === Mode.Lookup) s.lookupReq = -1;
        break;
    }
    if (q.type[k] >= Cmd.SetTierEnabled && q.type[k] <= Cmd.ResetAll) {
      a.persist.dirty = true;
      // the current card may no longer be eligible: re-pick unless mid-answer
      if (s.mode === Mode.Study && (s.phase === Phase.Asking || s.phase === Phase.Empty)) s.phase = Phase.Advance;
    }
    a.ui.version++;
  }
  q.count = 0;
}
