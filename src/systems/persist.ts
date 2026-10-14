// localStorage persistence. Serialised by card *id* (not index) so progress
// survives database updates that add, remove or reorder cards.
import { type Arena, LOG_CAP, MAX_TIER } from '../arena';

const KEY = 'anatomy-flashcards.v1';
const SAVE_EVERY_MS = 800;

interface Saved {
  v: 1;
  cards: Record<string, [number, number, number, number, number, number, number, number]>;
  log: [number, string, number, number, number][]; // t, id, grade, prevState, R
  settings: { retention: number; newPerDay: number; tierEnabled: number[]; tierForced: number[]; kindEnabled: number[] };
}

export function load(a: Arena) {
  let raw: string | null = null;
  try { raw = localStorage.getItem(KEY); } catch { return; }
  if (!raw) return;
  let s: Saved;
  try { s = JSON.parse(raw); } catch { return; }
  if (s.v !== 1) return;
  const index = new Map(a.db.cards.map((c, i) => [c.id, i]));
  for (const [id, r] of Object.entries(s.cards ?? {})) {
    const c = index.get(id);
    if (c === undefined) continue;
    const S = a.srs;
    [S.state[c], S.S[c], S.D[c], S.due[c], S.last[c], S.reps[c], S.lapses[c], S.step[c]] = r;
  }
  const L = a.log;
  for (const [t, id, g, ps, R] of (s.log ?? []).slice(-LOG_CAP)) {
    const c = index.get(id);
    if (c === undefined) continue;
    L.t[L.head] = t; L.card[L.head] = c; L.grade[L.head] = g; L.prevState[L.head] = ps; L.R[L.head] = R;
    L.head = (L.head + 1) % LOG_CAP; L.count = Math.min(LOG_CAP, L.count + 1);
  }
  const st = s.settings;
  if (st) {
    a.settings.retention = st.retention ?? 0.9;
    a.settings.newPerDay = st.newPerDay ?? 15;
    for (let t = 0; t <= MAX_TIER; t++) {
      a.settings.tierEnabled[t] = st.tierEnabled?.[t] ?? 1;
      a.settings.tierForced[t] = st.tierForced?.[t] ?? 0;
    }
    a.settings.kindEnabled[0] = st.kindEnabled?.[0] ?? 1;
    a.settings.kindEnabled[1] = st.kindEnabled?.[1] ?? 1;
  }
}

function save(a: Arena) {
  const cards: Saved['cards'] = {};
  const S = a.srs;
  for (let c = 0; c < a.nCards; c++) {
    if (S.reps[c] === 0 && S.state[c] === 0) continue;
    cards[a.db.cards[c].id] = [S.state[c], +S.S[c].toFixed(4), +S.D[c].toFixed(4), S.due[c], S.last[c], S.reps[c], S.lapses[c], S.step[c]];
  }
  const L = a.log, log: Saved['log'] = [];
  for (let k = L.count - 1; k >= 0; k--) {
    const i = (L.head - 1 - k + LOG_CAP) % LOG_CAP;
    log.push([L.t[i], a.db.cards[L.card[i]].id, L.grade[i], L.prevState[i], +L.R[i].toFixed(3)]);
  }
  const set = a.settings;
  const out: Saved = {
    v: 1, cards, log,
    settings: {
      retention: set.retention, newPerDay: set.newPerDay,
      tierEnabled: [...set.tierEnabled], tierForced: [...set.tierForced], kindEnabled: [...set.kindEnabled],
    },
  };
  try { localStorage.setItem(KEY, JSON.stringify(out)); } catch { /* storage full or blocked */ }
}

export function persistSystem(a: Arena) {
  if (!a.persist.dirty || a.time.now - a.persist.lastSave < SAVE_EVERY_MS) return;
  save(a);
  a.persist.dirty = false;
  a.persist.lastSave = a.time.now;
}

/** Flush immediately (page hide). */
export function flush(a: Arena) {
  if (a.persist.dirty) { save(a); a.persist.dirty = false; }
}
