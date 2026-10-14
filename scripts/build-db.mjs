// Merge data/cards/*.json with data/model-parts.json into public/db.json.
// Validates every card's `parts` against the meshes actually present in the model.
import fs from 'node:fs';

const model = JSON.parse(fs.readFileSync('data/model-parts.json', 'utf8'));
const files = fs.readdirSync('data/cards').filter((f) => f.endsWith('.json')).sort();
const cards = files.flatMap((f) => JSON.parse(fs.readFileSync(`data/cards/${f}`, 'utf8')).map((c) => ({ ...c, _file: f })));

// A few meshes have no .l/.r suffix but only exist on one side
// (e.g. Z-Anatomy ships iliocostalis colli for the left only): infer from position.
for (const p of model.parts) {
  if (p.side !== 'M') continue;
  if (p.min[0] > 0.005) p.side = 'L'; // anatomical left is +x
  else if (p.max[0] < -0.005) p.side = 'R';
}

const byBase = new Map();
model.parts.forEach((p, idx) => {
  if (!byBase.has(p.base)) byBase.set(p.base, []);
  byBase.get(p.base).push(idx);
});

// Precomputed camera directions (scripts/build-views.mjs); optional.
const views = fs.existsSync('data/views.json') ? JSON.parse(fs.readFileSync('data/views.json', 'utf8')) : {};

const errors = [];
const ids = new Set();
const used = new Set();
const out = [];
for (const c of cards) {
  if (ids.has(c.id)) errors.push(`duplicate id ${c.id}`);
  ids.add(c.id);
  for (const k of ['id', 'kind', 'name', 'region', 'tier', 'parts', 'etymology']) if (c[k] == null) errors.push(`${c.id}: missing ${k}`);
  if (c.kind === 'muscle') for (const k of ['origin', 'insertion', 'actions', 'innervation']) if (c[k] == null) errors.push(`${c.id}: missing ${k}`);
  const L = [], R = [], M = [];
  for (const base of c.parts ?? []) {
    const idxs = byBase.get(base);
    if (!idxs) { errors.push(`${c._file} ${c.id}: unknown part "${base}"`); continue; }
    used.add(base);
    for (const i of idxs) ({ L, R, M })[model.parts[i].side].push(i);
  }
  const inst = [];
  if (L.length || R.length) {
    if (L.length) inst.push({ side: 'L', parts: [...L, ...M] });
    if (R.length) inst.push({ side: 'R', parts: [...R, ...M] });
  } else if (M.length) inst.push({ side: 'M', parts: M });
  for (const it of inst) { const v = views[`${c.id}:${it.side}`]; if (v) it.view = v; }
  const { _file, parts, ...rest } = c;
  out.push({ ...rest, inst });
}
const KNOWN_CONTEXT = /tooth|incisor|canine|premolar|molar|cartilage|Calcaneal tendon|Iliotibial tract|Tendon of/;
const uncovered = [...byBase.keys()].filter((b) => !used.has(b) && !KNOWN_CONTEXT.test(b));
if (uncovered.length) console.warn('model parts not covered by any card:', uncovered.join(' | '));
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }

out.sort((a, b) => a.tier - b.tier || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
const db = {
  model: {
    url: 'model/body.bin.gz', min: model.min, scale: model.scale,
    vertexCount: model.vertexCount, indexCount: model.indexCount, bytes: model.bytes,
  },
  parts: model.parts.map((p) => ({ n: p.base, k: p.kind === 'bone' ? 0 : 1, s: p.side, v: p.v, i: p.i, b: [...p.min, ...p.max] })),
  cards: out,
};
fs.writeFileSync('public/db.json', JSON.stringify(db));
const tiers = out.reduce((m, c) => ((m[c.tier] = (m[c.tier] ?? 0) + 1), m), {});
console.log(`db.json: ${out.length} cards`, tiers, `${(fs.statSync('public/db.json').size / 1024).toFixed(0)} KB`);
