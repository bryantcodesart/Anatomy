// Boot: fetch db + model, allocate the arena, restore progress, start the loop.
import { type Arena, createArena } from './arena';
import { createGfx } from './gfx/scene';
import { start } from './loop';
import { attachInput } from './systems/input';
import { flush, load } from './systems/persist';
import type { Db } from './types';
import { uiSyncSystem } from './ui/bridge';
import { installAudit } from './audit';

async function fetchWithProgress(url: string, onBytes: (n: number) => void) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    n += value.length;
    onBytes(n);
  }
  return new Blob(chunks as BlobPart[]);
}

export async function boot(canvas: HTMLCanvasElement, progress: (f: number) => void): Promise<Arena> {
  const base = import.meta.env.BASE_URL;
  const db: Db = await (await fetch(`${base}db.json`)).json();
  const expected = 2_800_000; // approx gz size, only used for the progress bar
  const gz = await fetchWithProgress(`${base}${db.model.url}`, (n) => progress(Math.min(0.98, n / expected)));
  // some hosts transparently decompress .gz; detect the gzip magic number
  const head = new Uint8Array(await gz.slice(0, 2).arrayBuffer());
  const bin = head[0] === 0x1f && head[1] === 0x8b
    ? await new Response(gz.stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
    : await gz.arrayBuffer();
  progress(1);

  const gfx = createGfx(canvas, db, bin);
  const arena = createArena(db, gfx);
  load(arena);
  attachInput(arena, canvas);
  const save = () => flush(arena);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && save());
  window.addEventListener('pagehide', save);
  if (new URLSearchParams(location.search).has('audit')) installAudit(arena);
  start(arena, uiSyncSystem);
  return arena;
}
