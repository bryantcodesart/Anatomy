// Builds all three.js objects once at boot. The entire body is ONE merged
// BufferGeometry drawn by two meshes (opaque pass + translucent "x-ray" pass).
// Per-part visual state (highlight, opacity) lives in a 1-row DataTexture that
// the vertex shader samples by a per-vertex part id. Changing what is
// highlighted/ghosted is therefore just writing bytes into a typed array.
import * as THREE from 'three';
import { type Arena, STATE_TEX_W } from '../arena';
import type { Db } from '../types';

const vert = /* glsl */ `
uniform sampler2D uState;
uniform float uPass; // 0 opaque, 1 ghost
attribute float partId;
varying vec3 vNormal;
varying vec3 vViewPos;
varying float vHi;
varying float vAlpha;
varying float vKind;
void main() {
  int id = int(partId + 0.5);
  vec4 st = texelFetch(uState, ivec2(id % ${STATE_TEX_W}, id / ${STATE_TEX_W}), 0);
  vHi = st.r;
  vAlpha = st.g;
  vKind = st.a;
  bool opaque = vAlpha > 0.995;
  if ((uPass < 0.5 && !opaque) || (uPass > 0.5 && (opaque || vAlpha < 0.004))) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // outside clip volume: culled
    return;
  }
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewPos = mv.xyz;
  // normals were baked in world space; the mesh scale only dequantizes positions
  vNormal = normalize(mat3(viewMatrix) * normal);
  gl_Position = projectionMatrix * mv;
}`;

const frag = /* glsl */ `
uniform float uPass;
uniform float uTime;
varying vec3 vNormal;
varying vec3 vViewPos;
varying float vHi;
varying float vAlpha;
varying float vKind;
const vec3 BONE = vec3(0.86, 0.82, 0.72);
const vec3 MUSCLE = vec3(0.66, 0.22, 0.2);
const vec3 HI = vec3(0.15, 0.95, 0.85);
void main() {
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  vec3 v = normalize(-vViewPos);
  vec3 base = mix(BONE, MUSCLE, step(0.5, vKind));
  vec3 L1 = normalize(vec3(-0.45, 0.65, 0.6));
  vec3 L2 = normalize(vec3(0.6, -0.1, 0.4));
  float d1 = max(dot(n, L1), 0.0);
  float d2 = max(dot(n, L2), 0.0);
  float ndv = clamp(dot(n, v), 0.0, 1.0);
  float rim = pow(1.0 - ndv, 3.0);
  vec3 h = normalize(L1 + v);
  float spec = pow(max(dot(n, h), 0.0), 40.0) * mix(0.25, 0.12, vKind);
  vec3 col = base * (0.28 + 0.72 * d1 + 0.22 * d2) + spec + rim * 0.12;
  // highlight tint + gentle pulse
  float pulse = 0.5 + 0.5 * sin(uTime * 3.2);
  vec3 hiCol = HI * (0.18 + 0.85 * d1 + 0.18 * d2) + spec * 1.5 + HI * rim * (0.35 + 0.45 * pulse);
  col = mix(col, hiCol, vHi * 0.8);
  if (uPass > 0.5) {
    // x-ray: silhouettes stay visible, faces facing the camera fade out
    float a = vAlpha * (0.25 + 0.75 * rim);
    gl_FragColor = vec4(mix(col, vec3(0.75, 0.85, 0.95), 0.35), a);
  } else {
    gl_FragColor = vec4(col, 1.0);
  }
  #include <colorspace_fragment>
}`;

export function createGfx(canvas: HTMLCanvasElement, db: Db, bin: ArrayBuffer): Arena['gfx'] {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: window.devicePixelRatio < 2,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x0d1117, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 20);

  const m = db.model;
  const pos = new Uint16Array(bin, 0, m.vertexCount * 3);
  const nor = new Int8Array(bin, m.bytes.pos, m.vertexCount * 3);
  const idx16 = new Uint16Array(bin, m.bytes.pos + m.bytes.nor, m.indexCount);

  // per-part local uint16 indices -> global uint32 indices; per-vertex part id
  const index = new Uint32Array(m.indexCount);
  const partId = new Uint16Array(m.vertexCount);
  for (let p = 0; p < db.parts.length; p++) {
    const [v0, vc] = db.parts[p].v;
    const [i0, ic] = db.parts[p].i;
    for (let k = 0; k < ic; k++) index[i0 + k] = idx16[i0 + k] + v0;
    partId.fill(p, v0, v0 + vc);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3, true));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3, true));
  geo.setAttribute('partId', new THREE.BufferAttribute(partId, 1, false));
  geo.setIndex(new THREE.BufferAttribute(index, 1));

  const texH = Math.ceil(db.parts.length / STATE_TEX_W);
  const stateData = new Uint8Array(STATE_TEX_W * texH * 4);
  for (let p = 0; p < db.parts.length; p++) {
    stateData[p * 4 + 1] = 255; // alpha
    stateData[p * 4 + 3] = db.parts[p].k ? 255 : 0; // kind
  }
  const stateTex = new THREE.DataTexture(stateData, STATE_TEX_W, texH, THREE.RGBAFormat, THREE.UnsignedByteType);
  stateTex.needsUpdate = true;

  const uTime = { value: 0 };
  const mat = (pass: number) =>
    new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: { uState: { value: stateTex }, uPass: { value: pass }, uTime },
      transparent: pass === 1,
      depthWrite: pass === 0,
      side: pass === 0 ? THREE.FrontSide : THREE.DoubleSide,
    });

  // Dequantize uint16 positions with the mesh transform.
  const place = (mesh: THREE.Mesh) => {
    mesh.position.set(m.min[0], m.min[1], m.min[2]);
    mesh.scale.set(m.scale[0] * 65535, m.scale[1] * 65535, m.scale[2] * 65535);
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
  };
  const opaque = new THREE.Mesh(geo, mat(0));
  const ghost = new THREE.Mesh(geo, mat(1));
  ghost.renderOrder = 1;
  place(opaque);
  place(ghost);
  scene.add(opaque, ghost);

  return {
    renderer, scene, camera, stateTex, stateData,
    uniforms: { uTime }, dirty: true, width: 0, height: 0,
    insetBottom: 0, insetRight: 0, appliedInset: -1,
  };
}
