// Tap-to-identify (lookup mode). Consumes a recorded tap, casts a ray against
// the body using a BVH (built once, lazily, the first time lookup is used) and
// selects the most specific card containing the first solid part hit.
// Ghosted (see-through) parts are skipped, so you can tap through them.
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { type Arena, Mode } from '../arena';

let bvh: MeshBVH | null = null;
let index: ArrayLike<number> = [];
let vertPart: Uint16Array = new Uint16Array(0);
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function build(a: Arena) {
  const db = a.db, m = db.model, g = a.gfx.geometry;
  const q = g.getAttribute('position').array as Uint16Array;
  const pos = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) pos[i] = m.min[i % 3] + q[i] * m.scale[i % 3];
  vertPart = new Uint16Array(m.vertexCount);
  db.parts.forEach((p, pi) => vertPart.fill(pi, p.v[0], p.v[0] + p.v[1]));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute((g.index!.array as Uint32Array).slice(), 1));
  bvh = new MeshBVH(geo); // reorders this copy's index; parts are looked up per vertex
  index = geo.index!.array;
}

export function pickSystem(a: Arena) {
  const inp = a.input;
  if (a.session.mode !== Mode.Lookup) { inp.tap = 0; return; }
  if (!bvh) build(a);
  if (!inp.tap) return;
  inp.tap = 0;
  const g = a.gfx;
  ndc.set((inp.tapX / g.width) * 2 - 1, -(inp.tapY / g.height) * 2 + 1);
  raycaster.setFromCamera(ndc, g.camera);
  const hits = bvh!.raycast(raycaster.ray, THREE.DoubleSide, g.camera.near, g.camera.far);
  hits.sort((x, y) => x.distance - y.distance);
  for (const h of hits) {
    const part = vertPart[index[h.faceIndex! * 3]];
    if (a.parts.alpha[part] < 0.5 && !a.parts.isTarget[part]) continue; // see-through
    const card = a.cards.partCard[part];
    if (card < 0) continue; // context-only geometry (teeth, cartilage, tendons)
    a.session.lookupReq = card * 4 + a.cards.partInst[part];
    return;
  }
}
