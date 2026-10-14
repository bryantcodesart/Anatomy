// Allocation-free geometric helpers shared by systems.

function slab(o: number, d: number, lo: number, hi: number, t: Float64Array) {
  if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
  let ta = (lo - o) / d, tb = (hi - o) / d;
  if (ta > tb) { const x = ta; ta = tb; tb = x; }
  if (ta > t[0]) t[0] = ta;
  if (tb < t[1]) t[1] = tb;
  return t[0] <= t[1];
}

const T = new Float64Array(2);

/**
 * Does the segment o + t*d (t in (0, len]) hit box p of the SoA bounds,
 * shrunk on each axis by `shrink` (fraction of its extent)?
 */
export function segmentHitsBox(
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, len: number,
  min: Float32Array, max: Float32Array, p: number, shrink: number,
) {
  T[0] = 1e-4; T[1] = len;
  const i = p * 3;
  const sx = (max[i] - min[i]) * shrink, sy = (max[i + 1] - min[i + 1]) * shrink, sz = (max[i + 2] - min[i + 2]) * shrink;
  return slab(ox, dx, min[i] + sx, max[i] - sx, T)
    && slab(oy, dy, min[i + 1] + sy, max[i + 1] - sy, T)
    && slab(oz, dz, min[i + 2] + sz, max[i + 2] - sz, T);
}

/** Gap between box p and box (bmin, bmax); 0 when they overlap. */
export function boxGap(min: Float32Array, max: Float32Array, p: number, bmin: Float32Array, bmax: Float32Array) {
  let s = 0;
  for (let k = 0; k < 3; k++) {
    const g = Math.max(bmin[k] - max[p * 3 + k], min[p * 3 + k] - bmax[k], 0);
    s += g * g;
  }
  return Math.sqrt(s);
}
