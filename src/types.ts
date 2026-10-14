// Shapes of the static database shipped in public/db.json (built by scripts/build-db.mjs).

export type Side = 'L' | 'R' | 'M';

export interface CardInstance {
  side: Side;
  parts: number[]; // indices into Db.parts
  view?: [number, number]; // precomputed camera [yaw, pitch] (scripts/build-views.mjs)
}

export interface Card {
  id: string;
  kind: 'muscle' | 'bone';
  name: string;
  aka?: string[];
  region: string;
  tier: number;
  etymology: string;
  origin?: string;
  insertion?: string;
  actions?: string[];
  innervation?: string;
  articulations?: string[];
  landmarks?: string[];
  tip?: string;
  inst: CardInstance[];
}

export interface DbPart {
  n: string; // base name
  k: 0 | 1; // 0 bone, 1 muscle
  s: Side;
  v: [number, number]; // vertex offset, count
  i: [number, number]; // index offset, count
  b: [number, number, number, number, number, number]; // aabb min xyz, max xyz
}

export interface Db {
  model: {
    url: string;
    min: [number, number, number];
    scale: [number, number, number];
    vertexCount: number;
    indexCount: number;
    bytes: { pos: number; nor: number; idx: number };
  };
  parts: DbPart[];
  cards: Card[];
}
