// Scheduling policy on top of FSRS: learning steps, review intervals, tier
// advancement and the "what card next" query. Operates directly on the arena's
// typed-array stores.
import { type Arena, CS, LOG_CAP, MAX_TIER } from '../arena';
import {
  type GradeN, forgetStability, initDifficulty, initStability, intervalDays,
  nextDifficulty, recallStability, retrievability, shortTermStability,
} from './fsrs';

const MIN = 60_000;
const DAY = 86_400_000;
/** Learning steps for new / lapsed cards (in-session re-tests). */
const LEARN_STEPS = [1 * MIN, 10 * MIN];
const RELEARN_STEPS = [10 * MIN];
const MAX_IVL_DAYS = 3650;
/** A tier unlocks new cards once this fraction of the previous tier has graduated. */
export const UNLOCK_FRACTION = 0.7;
/** Lets the user see learning cards up to this far ahead instead of waiting idle. */
const LEARN_AHEAD = 20 * MIN;

/** Day boundary at 4am local, like Anki, so late-night study counts for "today". */
export function dayStart(now: number) {
  const d = new Date(now - 4 * 3600_000);
  d.setHours(0, 0, 0, 0);
  return d.getTime() + 4 * 3600_000;
}

const elapsedDays = (a: Arena, c: number, now: number) =>
  a.srs.last[c] ? (now - a.srs.last[c]) / DAY : 0;

const reviewIvl = (S: number, retention: number) =>
  Math.min(MAX_IVL_DAYS, Math.max(1, Math.round(intervalDays(S, retention)))) * DAY;

/**
 * Compute the outcome of grading card c with g, without mutating.
 * Writes [state, S, D, due, step] into `out`.
 */
export function simulate(a: Arena, c: number, g: GradeN, now: number, out: Float64Array) {
  const st = a.srs.state[c] as CS;
  let S = a.srs.S[c], D = a.srs.D[c], step = a.srs.step[c];
  const ret = a.settings.retention;
  let state: CS = st, due: number;

  if (st === CS.New) {
    S = initStability(g);
    D = initDifficulty(g);
    step = 0;
    if (g === 1) { state = CS.Learning; due = now + LEARN_STEPS[0]; }
    else if (g === 2) { state = CS.Learning; due = now + (LEARN_STEPS[0] + LEARN_STEPS[1]) / 2; }
    else if (g === 3) { state = CS.Learning; step = 1; due = now + LEARN_STEPS[1]; }
    else { state = CS.Review; due = now + reviewIvl(S, ret); }
  } else if (st === CS.Learning || st === CS.Relearning) {
    const steps = st === CS.Learning ? LEARN_STEPS : RELEARN_STEPS;
    S = shortTermStability(S, g);
    D = nextDifficulty(D, g);
    if (g === 1) { step = 0; due = now + steps[0]; }
    else if (g === 2) { due = now + steps[Math.min(step, steps.length - 1)] * 1.5; }
    else if (g === 3 && step + 1 < steps.length) { step++; due = now + steps[step]; }
    else { state = CS.Review; step = 0; due = now + reviewIvl(S, ret) * (g === 4 ? 1.3 : 1); }
  } else {
    const t = elapsedDays(a, c, now);
    const R = retrievability(t, S);
    D = nextDifficulty(D, g);
    if (t < 1) {
      // reviewed again the same day (study-ahead): short-term update
      S = shortTermStability(S, g);
    } else {
      S = g === 1 ? forgetStability(a.srs.D[c], S, R) : recallStability(a.srs.D[c], S, R, g);
    }
    if (g === 1) { state = CS.Relearning; step = 0; due = now + RELEARN_STEPS[0]; }
    else {
      // keep Hard <= Good <= Easy ordering after rounding
      let ivl = reviewIvl(S, ret);
      if (g === 2) ivl = Math.min(ivl, Math.max(DAY, reviewIvl(a.srs.S[c], ret)));
      due = now + ivl;
    }
  }
  out[0] = state; out[1] = S; out[2] = D; out[3] = due; out[4] = step;
}

const tmp = new Float64Array(5);

/** Apply a grade: update memory state, append to log, mark for persistence. */
export function grade(a: Arena, c: number, g: GradeN, now: number) {
  const prev = a.srs.state[c];
  const R = prev === CS.Review ? retrievability(elapsedDays(a, c, now), a.srs.S[c]) : 0;
  simulate(a, c, g, now, tmp);
  a.srs.state[c] = tmp[0];
  a.srs.S[c] = tmp[1];
  a.srs.D[c] = tmp[2];
  a.srs.due[c] = tmp[3];
  a.srs.step[c] = tmp[4];
  a.srs.last[c] = now;
  a.srs.reps[c]++;
  if (g === 1 && prev === CS.Review) a.srs.lapses[c]++;

  const L = a.log;
  L.t[L.head] = now;
  L.card[L.head] = c;
  L.grade[L.head] = g;
  L.prevState[L.head] = prev;
  L.R[L.head] = R;
  L.head = (L.head + 1) % LOG_CAP;
  L.count = Math.min(LOG_CAP, L.count + 1);
  a.persist.dirty = true;
}

/** Preview the interval (ms from now) each grade would produce. */
export function previewIntervals(a: Arena, c: number, now: number, out: Float64Array) {
  for (let g = 1 as GradeN; g <= 4; g = (g + 1) as GradeN) {
    simulate(a, c, g, now, tmp);
    out[g - 1] = tmp[3] - now;
  }
}

/** Number of new cards introduced since today's day boundary (scans log backwards). */
export function newIntroducedToday(a: Arena, now: number) {
  const start = dayStart(now);
  const L = a.log;
  let n = 0;
  for (let k = 0; k < L.count; k++) {
    const i = (L.head - 1 - k + LOG_CAP) % LOG_CAP;
    if (L.t[i] < start) break;
    if (L.prevState[i] === CS.New) n++;
  }
  return n;
}

export const cardEnabled = (a: Arena, c: number) =>
  a.settings.tierEnabled[a.cards.tier[c]] === 1 && a.settings.kindEnabled[a.cards.kind[c]] === 1;

/** Highest tier from which new cards may be introduced. */
export function unlockedTier(a: Arena) {
  let unlocked = 1;
  for (let t = 1; t < MAX_TIER; t++) {
    let total = 0, grad = 0;
    for (let c = 0; c < a.nCards; c++) {
      if (a.cards.tier[c] !== t || a.settings.kindEnabled[a.cards.kind[c]] === 0) continue;
      total++;
      if (a.srs.state[c] === CS.Review) grad++;
    }
    // a tier you've disabled or that is empty doesn't block advancement
    const passed = total === 0 || a.settings.tierEnabled[t] === 0 || grad / total >= UNLOCK_FRACTION;
    if (passed) unlocked = t + 1;
    else break;
  }
  return unlocked;
}

const tierOpen = (a: Arena, t: number, unlocked: number) => t <= unlocked || a.settings.tierForced[t] === 1;

/**
 * Pick the next card. Priority:
 *   1. learning/relearning cards that are due (short-term memory re-tests)
 *   2. review cards that are due, lowest retrievability first
 *   3. new cards (daily limit, tier gating, biggest structures first)
 *   4. learning cards due within LEARN_AHEAD
 *   5. if `ahead`: anything, lowest retrievability first (cram mode)
 * Also refreshes the session counters shown in the header.
 */
export function pickNext(a: Arena, now: number, ahead: boolean): number {
  const s = a.session, srs = a.srs;
  const avoid = s.prevCard;
  let bestLearn = -1, bestLearnDue = Infinity;
  let bestRev = -1, bestRevR = Infinity;
  let bestAhead = -1, bestAheadDue = Infinity;
  let bestCram = -1, bestCramR = Infinity;
  let dueLearn = 0, dueReview = 0, nextDue = Infinity;

  for (let c = 0; c < a.nCards; c++) {
    if (!cardEnabled(a, c)) continue;
    const st = srs.state[c];
    if (st === CS.New) continue;
    const due = srs.due[c];
    if (due > now && due < nextDue) nextDue = due;
    if (st === CS.Learning || st === CS.Relearning) {
      if (due <= now) {
        dueLearn++;
        if (c !== avoid && due < bestLearnDue) { bestLearn = c; bestLearnDue = due; }
      } else if (due <= now + LEARN_AHEAD && c !== avoid && due < bestAheadDue) {
        bestAhead = c; bestAheadDue = due;
      }
    } else {
      const R = retrievability((now - srs.last[c]) / DAY, srs.S[c]);
      if (due <= now) {
        dueReview++;
        if (c !== avoid && R < bestRevR) { bestRev = c; bestRevR = R; }
      }
      if (c !== avoid && R < bestCramR) { bestCram = c; bestCramR = R; }
    }
  }

  const unlocked = unlockedTier(a);
  const newToday = newIntroducedToday(a, now);
  let newLeft = 0, firstNew = -1;
  for (let k = 0; k < a.nCards; k++) {
    const c = a.cards.order[k];
    if (srs.state[c] !== CS.New || !cardEnabled(a, c) || !tierOpen(a, a.cards.tier[c], unlocked)) continue;
    newLeft++;
    if (firstNew < 0 && c !== avoid) firstNew = c;
  }

  s.dueLearn = dueLearn;
  s.dueReview = dueReview;
  s.newToday = newToday;
  s.newLeft = newLeft;
  s.unlockedTier = unlocked;
  s.nextDueAt = nextDue === Infinity ? 0 : nextDue;
  s.countsAt = now;

  if (bestLearn >= 0) return bestLearn;
  if (bestRev >= 0) return bestRev;
  if (firstNew >= 0 && newToday < a.settings.newPerDay) return firstNew;
  if (bestAhead >= 0) return bestAhead;
  // only the card we just saw is left: allow repeating it
  if (avoid >= 0 && cardEnabled(a, avoid) && srs.state[avoid] !== CS.New && srs.due[avoid] <= now + LEARN_AHEAD) return avoid;
  if (ahead) {
    if (bestCram >= 0) return bestCram;
    if (firstNew >= 0) return firstNew; // ahead also lets you exceed today's new limit
  }
  return -1;
}

/** Wipe memory state for cards matching `tier` (0 = all). */
export function resetCards(a: Arena, tier: number) {
  for (let c = 0; c < a.nCards; c++) {
    if (tier && a.cards.tier[c] !== tier) continue;
    a.srs.state[c] = CS.New;
    a.srs.S[c] = 0; a.srs.D[c] = 0; a.srs.due[c] = 0; a.srs.last[c] = 0;
    a.srs.reps[c] = 0; a.srs.lapses[c] = 0; a.srs.step[c] = 0;
  }
  if (!tier) { a.log.head = 0; a.log.count = 0; }
  a.persist.dirty = true;
}
