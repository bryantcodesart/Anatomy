// The UI bridge: the last step of every frame. When a system bumped
// arena.ui.version we copy the few values the UI shows into a Solid store.
// The UI never mutates the arena directly — it pushes commands (arena.pushCmd).
import { createStore, reconcile } from 'solid-js/store';
import { type Arena, Mode, Phase } from '../arena';
import type { Card } from '../types';

export interface UiState {
  ready: boolean;
  mode: Mode;
  inst: number;
  phase: Phase;
  card: Card | null;
  cardIndex: number;
  side: 'L' | 'R' | 'M';
  intervals: number[];
  dueLearn: number;
  dueReview: number;
  newLeft: number;
  newToday: number;
  newPerDay: number;
  unlockedTier: number;
  nextDueAt: number;
  version: number;
}

export const [ui, setUi] = createStore<UiState>({
  ready: false,
  mode: Mode.Study,
  inst: 0,
  phase: Phase.Boot,
  card: null,
  cardIndex: -1,
  side: 'M',
  intervals: [0, 0, 0, 0],
  dueLearn: 0,
  dueReview: 0,
  newLeft: 0,
  newToday: 0,
  newPerDay: 15,
  unlockedTier: 1,
  nextDueAt: 0,
  version: 0,
});

export function uiSyncSystem(a: Arena) {
  if (a.ui.pushed === a.ui.version) return;
  a.ui.pushed = a.ui.version;
  const s = a.session;
  const card = s.card >= 0 ? a.db.cards[s.card] : null;
  setUi(reconcile({
    ready: true,
    mode: s.mode,
    inst: s.inst,
    phase: s.phase,
    card,
    cardIndex: s.card,
    side: card ? card.inst[s.inst].side : 'M',
    intervals: Array.from(s.intervals),
    dueLearn: s.dueLearn,
    dueReview: s.dueReview,
    newLeft: Math.max(0, Math.min(s.newLeft, a.settings.newPerDay - s.newToday)),
    newToday: s.newToday,
    newPerDay: a.settings.newPerDay,
    unlockedTier: s.unlockedTier,
    nextDueAt: s.nextDueAt,
    version: a.ui.version,
  }, { merge: true }));
}
