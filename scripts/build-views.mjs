// Precompute the best camera direction for every card instance (left/right copy)
// by ray casting against the real triangles (BVH), not bounding boxes.
// Output: data/views.json  { "<cardId>:<side>": [yaw, pitch] }, merged by build-db.
//
// For each candidate direction we cast rays from sample points on the target's
// surface toward the camera; a sample counts as "visible" when its surface faces
// the camera and no other structure lies in between. The direction with the most
// visible projected area wins (with mild preferences for level, front-ish, same-side views).
import fs from 'node:fs';
import zlib from 'node:zlib';
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

const db = JSON.parse(fs.readFileSync('public/db.json', 'utf8'));
const m = db.model;
const bin = zlib.gunzipSync(fs.readFileSync('public/model/body.bin.gz'));
const buf = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);
const qpos = new Uint16Array(buf, 0, m.vertexCount * 3);
const qnor = new Int8Array(buf, m.bytes.pos, m.vertexCount * 3);
const idx16 = new Uint16Array(buf, m.bytes.pos + m.bytes.nor, m.indexCount);

const pos = new Float32Array(m.vertexCount * 3);
for (let i = 0; i < pos.length; i++) pos[i] = m.min[i % 3] + qpos[i] * m.scale[i % 3];
const index = new Uint32Array(m.indexCount);
db.parts.forEach((p, pi) => {
  const [v0] = p.v, [i0, ic] = p.i;
  for (let k = 0; k < ic; k++) index[i0 + k] = idx16[i0 + k] + v0;
});
const geo = new THREE.BufferGeometry();
geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
geo.setIndex(new THREE.BufferAttribute(index, 1));
// The BVH reorders the index buffer, so map hit triangles to parts via their vertices.
const vertPart = new Uint16Array(m.vertexCount);
db.parts.forEach((p, pi) => vertPart.fill(pi, p.v[0], p.v[0] + p.v[1]));
const bvh = new MeshBVH(geo);
const ray = new THREE.Ray();

const YAWS = 24;
const PITCHES = [-0.45, -0.15, 0.15, 0.45, 0.85];
const SAMPLES = 48;
const views = {};
const t0 = Date.now();
const o = new THREE.Vector3(), d = new THREE.Vector3(), n = new THREE.Vector3();

for (const card of db.cards) {
  for (const inst of card.inst) {
    const target = new Set(inst.parts);
    // sample vertices spread over the target parts
    const verts = [];
    for (const pi of inst.parts) { const [v0, vc] = db.parts[pi].v; for (let k = 0; k < vc; k++) verts.push(v0 + k); }
    const step = Math.max(1, Math.floor(verts.length / SAMPLES));
    const samples = verts.filter((_, k) => k % step === 0).slice(0, SAMPLES);
    // bounding radius -> approximate camera distance
    const bmin = [Infinity, Infinity, Infinity], bmax = [-Infinity, -Infinity, -Infinity];
    for (const pi of inst.parts) { const b = db.parts[pi].b; for (let k = 0; k < 3; k++) { bmin[k] = Math.min(bmin[k], b[k]); bmax[k] = Math.max(bmax[k], b[3 + k]); } }
    const r = 0.5 * Math.hypot(bmax[0] - bmin[0], bmax[1] - bmin[1], bmax[2] - bmin[2]);
    const camDist = Math.max(0.15, r * 3.4);

    let best = -Infinity, bestYaw = 0, bestPitch = 0;
    for (let yi = 0; yi < YAWS; yi++) {
      const yaw = (yi / YAWS) * Math.PI * 2;
      for (const pitch of PITCHES) {
        d.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
        let visible = 0;
        for (const v of samples) {
          n.set(qnor[v * 3], qnor[v * 3 + 1], qnor[v * 3 + 2]).normalize();
          const facing = n.dot(d);
          if (facing < 0.15) continue; // surface faces away from this camera
          o.set(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]).addScaledVector(d, 0.0015);
          ray.set(o, d);
          const hits = bvh.raycast(ray, THREE.DoubleSide, 0, camDist);
          let blocked = false;
          for (const h of hits) {
            const a = geo.index.array[h.faceIndex * 3];
            if (!target.has(vertPart[a])) { blocked = true; break; }
          }
          if (!blocked) visible += facing; // projected (foreshortened) visible area
        }
        const lateral = inst.side === 'L' ? d.x : inst.side === 'R' ? -d.x : 0;
        const score = visible / samples.length
          - 0.18 * Math.abs(pitch)
          - 0.25 * Math.max(0, -lateral) // don't look at a left copy from the right
          + 0.03 * d.z; // tie-break toward anterior views
        if (score > best) { best = score; bestYaw = yaw; bestPitch = pitch; }
      }
    }
    views[`${card.id}:${inst.side}`] = [+bestYaw.toFixed(3), bestPitch];
  }
}
fs.writeFileSync('data/views.json', JSON.stringify(views));
console.log(`views for ${Object.keys(views).length} instances in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
