// FSRS-5 (Free Spaced Repetition Scheduler) — pure functions, no allocation.
// Memory model: each card has Stability S (days until recall probability falls
// to 90%) and Difficulty D (1..10). After each review we update S and D from the
// grade and the retrievability R at the moment of review, then schedule the next
// review at the time R is predicted to hit the desired retention.
// Reference: https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm

export const Grade = { Again: 1, Hard: 2, Good: 3, Easy: 4 } as const;
export type GradeN = 1 | 2 | 3 | 4;

// Default FSRS-5 weights (trained on ~700M Anki reviews).
export const W = [
  0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192,
  1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621,
];
const DECAY = -0.5;
const FACTOR = 19 / 81; // makes R(S, S) = 0.9

const clampD = (d: number) => Math.min(10, Math.max(1, d));

export const retrievability = (elapsedDays: number, S: number) =>
  S <= 0 ? 0 : Math.pow(1 + (FACTOR * Math.max(0, elapsedDays)) / S, DECAY);

/** Days until R decays to `retention`. */
export const intervalDays = (S: number, retention: number) =>
  (S / FACTOR) * (Math.pow(retention, 1 / DECAY) - 1);

export const initStability = (g: GradeN) => Math.max(0.1, W[g - 1]);
export const initDifficulty = (g: GradeN) => clampD(W[4] - Math.exp(W[5] * (g - 1)) + 1);

export const nextDifficulty = (D: number, g: GradeN) => {
  const delta = -W[6] * (g - 3);
  const dp = D + (delta * (10 - D)) / 9; // linear damping
  return clampD(W[7] * initDifficulty(4) + (1 - W[7]) * dp); // mean reversion
};

export const recallStability = (D: number, S: number, R: number, g: GradeN) => {
  const hard = g === 2 ? W[15] : 1;
  const easy = g === 4 ? W[16] : 1;
  return S * (Math.exp(W[8]) * (11 - D) * Math.pow(S, -W[9]) * (Math.exp(W[10] * (1 - R)) - 1) * hard * easy + 1);
};

export const forgetStability = (D: number, S: number, R: number) =>
  Math.min(S, W[11] * Math.pow(D, -W[12]) * (Math.pow(S + 1, W[13]) - 1) * Math.exp(W[14] * (1 - R)));

/** Same-day (short-term) review stability update. */
export const shortTermStability = (S: number, g: GradeN) => S * Math.exp(W[17] * (g - 3 + W[18]));
