// Simplify + quantize the raw Z-Anatomy export (see scripts/blender-export.py) into
// public/model/body.bin.gz + body.json. Run: node scripts/build-model.mjs <rawDir> [triBudget]
import fs from 'node:fs';
import zlib from 'node:zlib';
import { MeshoptSimplifier } from 'meshoptimizer';

const rawDir = process.argv[2];
const BUDGET = Number(process.argv[3] ?? 380000);
if (!rawDir) throw new Error('usage: build-model.mjs <rawDir> [triBudget]');
await MeshoptSimplifier.ready;

const raw = JSON.parse(fs.readFileSync(`${rawDir}/raw.json`, 'utf8'));
const buf = (f) => fs.readFileSync(`${rawDir}/${f}`);
const P = new Float32Array(buf('raw_pos.f32').buffer.slice(0));
const N = new Float32Array(buf('raw_nor.f32').buffer.slice(0));
const I = new Uint32Array(buf('raw_idx.u32').buffer.slice(0));

const MIN_TRIS = 500;
const srcTris = raw.parts.map((p) => p.i[1] / 3);
// Solve for a global ratio r so that sum(max(min(t, MIN), t*r)) ~= BUDGET.
const total = (r) => srcTris.reduce((s, t) => s + Math.max(Math.min(t, MIN_TRIS), t * r), 0);
let lo = 0, hi = 1;
for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (total(m) > BUDGET) hi = m; else lo = m; }
const ratio = lo;
console.log('ratio', ratio.toFixed(4), 'expected tris', Math.round(total(ratio)));

let flipped = 0;
const out = [];
let gmin = [Infinity, Infinity, Infinity], gmax = [-Infinity, -Infinity, -Infinity];
for (const p of raw.parts) {
  const [v0, vc0] = p.v, [i0, ic] = p.i;
  const pos = P.subarray(v0 * 3, (v0 + vc0) * 3);
  const nor = N.subarray(v0 * 3, (v0 + vc0) * 3);
  const idx = I.subarray(i0, i0 + ic);
  const t = ic / 3;
  const targetTris = Math.min(t, Math.max(Math.min(t, MIN_TRIS), Math.floor(t * ratio)));
  let simp = idx;
  if (targetTris < t) {
    for (const err of [0.01, 0.03, 0.08]) {
      [simp] = MeshoptSimplifier.simplify(idx, pos, 3, targetTris * 3, err);
      if (simp.length <= targetTris * 3 * 1.15) break;
    }
  }
  // Safety net for inside-out meshes (e.g. mirrored left-side parts exported
  // without reversing faces): negative signed volume -> flip winding + normals.
  // (relative to the centroid so open sheets, not just closed shells, measure sensibly)
  let cx = 0, cy = 0, cz = 0;
  for (let k = 0; k < vc0; k++) { cx += pos[k * 3]; cy += pos[k * 3 + 1]; cz += pos[k * 3 + 2]; }
  cx /= vc0; cy /= vc0; cz /= vc0;
  let vol = 0;
  for (let t = 0; t < simp.length; t += 3) {
    const a = simp[t] * 3, b = simp[t + 1] * 3, c = simp[t + 2] * 3;
    const ax = pos[a] - cx, ay = pos[a + 1] - cy, az = pos[a + 2] - cz;
    const bx = pos[b] - cx, by = pos[b + 1] - cy, bz = pos[b + 2] - cz;
    const qx = pos[c] - cx, qy = pos[c + 1] - cy, qz = pos[c + 2] - cz;
    vol += ax * (by * qz - bz * qy) - ay * (bx * qz - bz * qx) + az * (bx * qy - by * qx);
  }
  const flip = vol < 0;
  if (flip) {
    flipped++;
    for (let t = 0; t < simp.length; t += 3) { const x = simp[t + 1]; simp[t + 1] = simp[t + 2]; simp[t + 2] = x; }
  }
  const [remap, count] = MeshoptSimplifier.compactMesh(simp);
  const np = new Float32Array(count * 3), nn = new Float32Array(count * 3);
  for (let o = 0; o < remap.length; o++) {
    const n = remap[o]; if (n === 0xffffffff) continue;
    np.set(pos.subarray(o * 3, o * 3 + 3), n * 3);
    for (let k = 0; k < 3; k++) nn[n * 3 + k] = flip ? -nor[o * 3 + k] : nor[o * 3 + k];
  }
  if (count > 65535) throw new Error(`part ${p.name} too many verts ${count}`);
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < count; k++) for (let a = 0; a < 3; a++) {
    const x = np[k * 3 + a]; if (x < mn[a]) mn[a] = x; if (x > mx[a]) mx[a] = x;
  }
  for (let a = 0; a < 3; a++) { gmin[a] = Math.min(gmin[a], mn[a]); gmax[a] = Math.max(gmax[a], mx[a]); }
  const m = /^(.*)\.(l|r)$/.exec(p.name);
  let base = m ? m[1] : p.name;
  if (base.startsWith('(') && base.endsWith(')')) base = base.slice(1, -1);
  out.push({ name: p.name, base: base.trim(), side: m ? m[2].toUpperCase() : 'M', kind: p.kind, pos: np, nor: nn, idx: simp, mn, mx });
}

// Quantize positions to uint16 over global bounds; normals to int8.
const scale = gmax.map((x, a) => (x - gmin[a]) / 65535);
let vtot = 0, itot = 0;
for (const r of out) { vtot += r.pos.length / 3; itot += r.idx.length; }
const qpos = new Uint16Array(vtot * 3), qnor = new Int8Array(vtot * 3 + ((4 - (vtot * 3) % 4) % 4)), qidx = new Uint16Array(itot);
let vo = 0, io = 0;
const parts = [];
for (const r of out) {
  const vc = r.pos.length / 3;
  for (let k = 0; k < vc; k++) {
    let nx = r.nor[k * 3], ny = r.nor[k * 3 + 1], nz = r.nor[k * 3 + 2];
    const l = Math.hypot(nx, ny, nz) || 1;
    for (let a = 0; a < 3; a++) {
      qpos[(vo + k) * 3 + a] = Math.round((r.pos[k * 3 + a] - gmin[a]) / scale[a]);
    }
    qnor[(vo + k) * 3] = Math.round((nx / l) * 127); qnor[(vo + k) * 3 + 1] = Math.round((ny / l) * 127); qnor[(vo + k) * 3 + 2] = Math.round((nz / l) * 127);
  }
  qidx.set(r.idx, io);
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  parts.push({ name: r.name, base: r.base, side: r.side, kind: r.kind, v: [vo, vc], i: [io, r.idx.length], min: r.mn.map(r4), max: r.mx.map(r4) });
  vo += vc; io += r.idx.length;
}
const posB = Buffer.from(qpos.buffer), norB = Buffer.from(qnor.buffer), idxB = Buffer.from(qidx.buffer);
const bin = Buffer.concat([posB, norB, idxB]);
fs.mkdirSync('public/model', { recursive: true });
fs.writeFileSync('public/model/body.bin.gz', zlib.gzipSync(bin, { level: 9 }));
fs.writeFileSync('data/model-parts.json', JSON.stringify({
  source: 'Z-Anatomy (CC BY-SA 4.0), derived from BodyParts3D (DBCLS)',
  min: gmin, scale, vertexCount: vtot, indexCount: itot,
  bytes: { pos: posB.length, nor: norB.length, idx: idxB.length },
  parts,
}));
console.log({ flipped, parts: parts.length, verts: vtot, tris: itot / 3, rawBytes: bin.length, gz: fs.statSync('public/model/body.bin.gz').size });
