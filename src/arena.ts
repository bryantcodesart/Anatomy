// The Arena: every piece of mutable state in the app, allocated once at boot.
//
// Data-oriented layout: stores are structs-of-arrays (typed arrays indexed by
// part id or card id). Systems (src/systems/*) are plain functions that run every
// tick in a fixed order (src/loop.ts) and mutate the arena. Nothing in here owns
// behaviour; nothing allocates after boot except the UI snapshot and the
// localStorage serializer.
import type * as THREE from 'three';
import type { Db } from './types';

export const MAX_TIER = 5;
export const LOG_CAP = 50_000;
export const CMD_CAP = 64;
export const STATE_TEX_W = 1024;

/** Card memory states (FSRS / Anki style). */
export const enum CS { New = 0, Learning = 1, Review = 2, Relearning = 3 }

/** Session phase of the flash-card state machine. */
export const enum Phase {
  Boot = 0, Advance = 1, Asking = 2, Revealed = 3, Empty = 4,
  /** lookup mode: nothing selected, whole body shown */
  Browse = 5,
  /** lookup mode: a card is selected and shown with its answer */
  Lookup = 6,
}

export const enum Mode { Study = 0, Lookup = 1 }

/** Commands: the only way the UI (or input) asks the simulation to change. */
export const enum Cmd {
  Reveal = 1,
  Grade = 2, // arg: 1..4
  Skip = 3,
  Recenter = 4,
  StudyAhead = 5,
  SetTierEnabled = 6, // arg: tier*10 + (0|1)
  SetTierForced = 7, // arg: tier*10 + (0|1)
  SetRetention = 8, // arg: 0.7..0.97
  SetNewPerDay = 9, // arg: n
  SetKindEnabled = 10, // arg: kind*10 + (0|1)  kind 0 bone, 1 muscle
  ResetTier = 11, // arg: tier
  ResetAll = 12,
  Pause = 13, // arg: 1 paused (dashboard open) | 0
  SetMode = 14, // arg: Mode
  LookupShow = 15, // arg: card * 4 + instance
  LookupClear = 16,
}

export interface Arena {
  db: Db;
  nParts: number;
  nCards: number;

  time: { now: number; dt: number; frame: number; last: number };

  /** Static per-part data + per-part visual state. */
  parts: {
    min: Float32Array; // 3n
    max: Float32Array; // 3n
    center: Float32Array; // 3n
    kind: Uint8Array; // 0 bone, 1 muscle
    side: Uint8Array; // 0 M, 1 L, 2 R
    isTarget: Uint8Array;
    alpha: Float32Array; // current opacity
    alphaGoal: Float32Array;
    hi: Float32Array; // current highlight amount 0..1
    hiGoal: Float32Array;
  };

  /** Per-card static attributes used by the scheduler. */
  cards: {
    tier: Uint8Array;
    kind: Uint8Array; // 0 bone, 1 muscle
    order: Uint16Array; // introduction order of new cards (index into cards)
    /** per part: most specific card containing it (-1 none) and which instance */
    partCard: Int16Array;
    partInst: Uint8Array;
  };

  /** Per-card memory state (FSRS). */
  srs: {
    state: Uint8Array;
    S: Float32Array; // stability (days)
    D: Float32Array; // difficulty 1..10
    due: Float64Array; // epoch ms
    last: Float64Array; // epoch ms of last review (0 = never)
    reps: Uint16Array;
    lapses: Uint16Array;
    step: Uint8Array; // learning step index
  };

  /** Append-only review log (ring buffer). */
  log: {
    t: Float64Array;
    card: Uint16Array;
    grade: Uint8Array;
    prevState: Uint8Array;
    R: Float32Array; // predicted retrievability at review time
    head: number; // next write slot
    count: number;
  };

  settings: {
    retention: number;
    newPerDay: number;
    tierEnabled: Uint8Array; // [MAX_TIER+1], index by tier
    tierForced: Uint8Array; // [MAX_TIER+1]
    kindEnabled: Uint8Array; // [2]
  };

  session: {
    mode: Mode;
    /** pending lookup selection: card*4+inst, -1 = clear, -2 = none */
    lookupReq: number;
    phase: Phase;
    card: number; // -1 none
    inst: number; // which instance (side) of the card is shown
    prevCard: number;
    shownAt: number;
    paused: boolean;
    ahead: boolean; // studying ahead of schedule
    intervals: Float64Array; // [4] preview of next interval per grade (ms)
    // counts for the UI header, refreshed by the session system
    dueLearn: number;
    dueReview: number;
    newLeft: number;
    newToday: number;
    nextDueAt: number;
    unlockedTier: number;
    countsAt: number;
  };

  /** Current focus target (union of target parts). */
  focus: {
    active: boolean;
    min: Float32Array;
    max: Float32Array;
    center: Float32Array;
    radius: number;
    /** debug/audit: ghost everything except the target */
    isolate: boolean;
  };

  cmd: { type: Uint8Array; arg: Float64Array; count: number };

  input: {
    // raw pointer slots (2 fingers max), written by DOM listeners
    id: Int32Array;
    x: Float32Array;
    y: Float32Array;
    down: Uint8Array;
    // accumulated deltas since last tick
    orbitX: number;
    orbitY: number;
    panX: number;
    panY: number;
    zoom: number; // log-scale accumulated
    pinchDist: number;
    // tap detection (short press without drag) for picking in lookup mode
    downX: number;
    downY: number;
    downT: number;
    moved: number;
    tap: number; // 1 when a tap is waiting to be consumed
    tapX: number; // canvas px
    tapY: number;
  };

  cam: {
    pivot: Float32Array; // current orbit pivot
    pivotGoal: Float32Array;
    yaw: number;
    pitch: number;
    dist: number;
    yawGoal: number;
    pitchGoal: number;
    distGoal: number;
    homeYaw: number;
    homePitch: number;
    homeDist: number;
    homePivot: Float32Array;
    pos: Float32Array; // world position (derived)
    fovY: number;
    aspect: number; // of the visible (uncovered) area
    visibleFrac: number; // visible height / canvas height
  };

  gfx: {
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    geometry: THREE.BufferGeometry;
    stateTex: THREE.DataTexture;
    stateData: Uint8Array;
    uniforms: { uTime: { value: number } };
    dirty: boolean;
    width: number;
    height: number;
    /** px of canvas covered by the card UI (bottom sheet / side panel); written by the UI */
    insetBottom: number;
    insetRight: number;
    appliedInset: number;
  };

  persist: { dirty: boolean; lastSave: number };

  /** UI bridge: systems bump `version` when anything the UI shows changes. */
  ui: { version: number; pushed: number };

  /** Seeded RNG state (xorshift32). */
  rng: { s: number };

  /** Scratch buffers reused by systems to avoid per-tick allocation. */
  scratch: {
    candidates: Float32Array; // view-direction search
    v3a: Float32Array;
    v3b: Float32Array;
  };
}

export function pushCmd(a: Arena, type: Cmd, arg = 0) {
  if (a.cmd.count >= CMD_CAP) return;
  a.cmd.type[a.cmd.count] = type;
  a.cmd.arg[a.cmd.count] = arg;
  a.cmd.count++;
}

export function rand(a: Arena) {
  let x = a.rng.s;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  a.rng.s = x >>> 0;
  return a.rng.s / 4294967296;
}

export function createArena(db: Db, gfx: Arena['gfx']): Arena {
  const n = db.parts.length;
  const c = db.cards.length;
  const parts: Arena['parts'] = {
    min: new Float32Array(n * 3),
    max: new Float32Array(n * 3),
    center: new Float32Array(n * 3),
    kind: new Uint8Array(n),
    side: new Uint8Array(n),
    isTarget: new Uint8Array(n),
    alpha: new Float32Array(n).fill(1),
    alphaGoal: new Float32Array(n).fill(1),
    hi: new Float32Array(n),
    hiGoal: new Float32Array(n),
  };
  for (let i = 0; i < n; i++) {
    const p = db.parts[i];
    for (let k = 0; k < 3; k++) {
      parts.min[i * 3 + k] = p.b[k];
      parts.max[i * 3 + k] = p.b[3 + k];
      parts.center[i * 3 + k] = (p.b[k] + p.b[3 + k]) / 2;
    }
    parts.kind[i] = p.k;
    parts.side[i] = p.s === 'L' ? 1 : p.s === 'R' ? 2 : 0;
  }

  const cards: Arena['cards'] = {
    tier: new Uint8Array(c),
    kind: new Uint8Array(c),
    order: new Uint16Array(c),
    partCard: new Int16Array(n).fill(-1),
    partInst: new Uint8Array(n),
  };
  // New-card order: by tier, then biggest structures first (easier to spot).
  const vol = new Float32Array(c);
  for (let i = 0; i < c; i++) {
    const card = db.cards[i];
    cards.tier[i] = Math.min(MAX_TIER, Math.max(1, card.tier));
    cards.kind[i] = card.kind === 'bone' ? 0 : 1;
    let v = 0;
    for (const pi of card.inst[0]?.parts ?? []) {
      const b = db.parts[pi].b;
      v += (b[3] - b[0]) * (b[4] - b[1]) * (b[5] - b[2]);
    }
    vol[i] = v;
  }
  // tap-to-identify: map each part to the smallest card that contains it
  const bestSize = new Int32Array(n).fill(1 << 30);
  for (let i = 0; i < c; i++) {
    db.cards[i].inst.forEach((it, k) => {
      for (const p of it.parts) {
        if (it.parts.length < bestSize[p]) { bestSize[p] = it.parts.length; cards.partCard[p] = i; cards.partInst[p] = k; }
      }
    });
  }
  const idx = Array.from({ length: c }, (_, i) => i);
  idx.sort((x, y) => cards.tier[x] - cards.tier[y] || vol[y] - vol[x]);
  cards.order.set(idx);

  return {
    db,
    nParts: n,
    nCards: c,
    time: { now: Date.now(), dt: 0, frame: 0, last: performance.now() },
    parts,
    cards,
    srs: {
      state: new Uint8Array(c),
      S: new Float32Array(c),
      D: new Float32Array(c),
      due: new Float64Array(c),
      last: new Float64Array(c),
      reps: new Uint16Array(c),
      lapses: new Uint16Array(c),
      step: new Uint8Array(c),
    },
    log: {
      t: new Float64Array(LOG_CAP),
      card: new Uint16Array(LOG_CAP),
      grade: new Uint8Array(LOG_CAP),
      prevState: new Uint8Array(LOG_CAP),
      R: new Float32Array(LOG_CAP),
      head: 0,
      count: 0,
    },
    settings: {
      retention: 0.9,
      newPerDay: 15,
      tierEnabled: new Uint8Array(MAX_TIER + 1).fill(1),
      tierForced: new Uint8Array(MAX_TIER + 1),
      kindEnabled: new Uint8Array([1, 1]),
    },
    session: {
      mode: Mode.Study,
      lookupReq: -2,
      phase: Phase.Boot,
      card: -1,
      inst: 0,
      prevCard: -1,
      shownAt: 0,
      paused: false,
      ahead: false,
      intervals: new Float64Array(4),
      dueLearn: 0,
      dueReview: 0,
      newLeft: 0,
      newToday: 0,
      nextDueAt: 0,
      unlockedTier: 1,
      countsAt: 0,
    },
    focus: {
      active: false,
      min: new Float32Array(3),
      max: new Float32Array(3),
      center: new Float32Array(3),
      radius: 1,
      isolate: false,
    },
    cmd: { type: new Uint8Array(CMD_CAP), arg: new Float64Array(CMD_CAP), count: 0 },
    input: {
      id: new Int32Array([-1, -1]),
      x: new Float32Array(2),
      y: new Float32Array(2),
      down: new Uint8Array(2),
      orbitX: 0,
      orbitY: 0,
      panX: 0,
      panY: 0,
      zoom: 0,
      pinchDist: 0,
      downX: 0,
      downY: 0,
      downT: 0,
      moved: 0,
      tap: 0,
      tapX: 0,
      tapY: 0,
    },
    cam: {
      pivot: new Float32Array([0, 1, 0]),
      pivotGoal: new Float32Array([0, 1, 0]),
      yaw: 0.6,
      pitch: 0.1,
      dist: 3.2,
      yawGoal: 0,
      pitchGoal: 0.05,
      distGoal: 2.6,
      homeYaw: 0,
      homePitch: 0.05,
      homeDist: 2.6,
      homePivot: new Float32Array([0, 1, 0]),
      pos: new Float32Array(3),
      fovY: 38,
      aspect: 1,
      visibleFrac: 1,
    },
    gfx,
    persist: { dirty: false, lastSave: 0 },
    ui: { version: 1, pushed: 0 },
    rng: { s: (Date.now() ^ 0x9e3779b9) >>> 0 || 1 },
    scratch: {
      candidates: new Float32Array(128 * 4),
      v3a: new Float32Array(3),
      v3b: new Float32Array(3),
    },
  };
}
