import { createRenderer } from '../src/render';
import type { MontageRenderer } from '../src/render';
import type { FrameDescriptor, MultiLayout } from '../src/types';
import { createRendererV1, type FrameDescriptorV1 } from './render.v1';
import {
  BG_HEX,
  FITS,
  SIZES,
  TRANSFORMS,
  identityCases,
  layer,
  layoutShot,
  makePatternBitmap,
  makeTestBitmap,
  sampleCanvas,
  shotOf,
  single,
  type IdentityCase,
  type Samples,
} from './render-common';

interface Result {
  name: string;
  fit: string;
  size: string;
  samples: Samples;
}
declare global {
  interface Window {
    harnessResult?: unknown;
    /** Render one frame and return raw RGBA (base64) + dimensions; used by pixel-compare scripts. */
    renderCase?: (c: RenderCase) => Promise<{ w: number; h: number; b64: string }>;
    /** SHA-256 of the raw RGBA readback for each invariant-1 case (single-cell shots through the shot renderer). */
    identityHashes?: (mode?: 'v1' | 'v2') => Promise<{ name: string; hash: string }[]>;
  }
}

async function sha256(data: Uint8Array<ArrayBuffer>): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}

function identityFrame(c: IdentityCase): FrameDescriptor {
  if (!c.style || !c.to) return single(c.from);
  return {
    kind: 'transition',
    style: c.style,
    progress: c.progress ?? 0,
    from: shotOf(c.from),
    to: shotOf(c.to),
  };
}

function identityFrameV1(c: IdentityCase): FrameDescriptorV1 {
  if (!c.style || !c.to) return { kind: 'single', layer: c.from };
  return {
    kind: 'transition',
    style: c.style,
    progress: c.progress ?? 0,
    from: c.from,
    to: c.to,
  };
}

/** Render every identity case with the shot renderer ('v2') or the frozen v1 copy ('v1'); hash raw RGBA. */
async function hashCases(mode: 'v1' | 'v2'): Promise<{ name: string; hash: string }[]> {
  const bmp = await makePatternBitmap();
  const out: { name: string; hash: string }[] = [];
  const canvas = document.createElement('canvas');
  const r = mode === 'v2' ? createRenderer(canvas) : createRendererV1(canvas);
  r.setBackground(BG_HEX);
  let size = '';
  for (const c of identityCases()) {
    if (size !== `${c.w}x${c.h}`) {
      size = `${c.w}x${c.h}`;
      r.setSize(c.w, c.h);
      r.setPhoto(0, bmp);
      r.setPhoto(1, bmp);
    }
    if (mode === 'v2') (r as MontageRenderer).draw(identityFrame(c));
    else (r as ReturnType<typeof createRendererV1>).draw(identityFrameV1(c));
    const gl = canvas.getContext('webgl2')!;
    const px = new Uint8Array(c.w * c.h * 4);
    gl.readPixels(0, 0, c.w, c.h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    out.push({ name: c.name, hash: await sha256(px) });
  }
  r.dispose();
  bmp.close();
  return out;
}
window.identityHashes = (mode = 'v2') => hashCases(mode);

interface RenderCase {
  w: number;
  h: number;
  fit: 'cover' | 'contain' | 'blur';
  t: { scale: number; tx: number; ty: number };
  focus: { x: number; y: number };
  bg?: string;
  photo?: [number, number];
}
let caseBitmap: Promise<ImageBitmap> | null = null;
window.renderCase = async (c) => {
  caseBitmap ??= makeTestBitmap();
  const bmp = await caseBitmap;
  const canvas = document.createElement('canvas');
  const r = createRenderer(canvas);
  r.setSize(c.w, c.h);
  r.setBackground(c.bg ?? BG_HEX);
  r.setPhoto(0, bmp);
  r.draw(single(layer(0, c.fit, c.t, c.focus)));
  const o = new OffscreenCanvas(c.w, c.h);
  const g = o.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(canvas, 0, 0);
  const data = g.getImageData(0, 0, c.w, c.h).data;
  r.dispose();
  let bin = '';
  for (let i = 0; i < data.length; i += 0x8000) bin += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return { w: c.w, h: c.h, b64: btoa(bin) };
};

const grid = document.getElementById('grid')!;
const status = document.getElementById('status')!;

function addFig(canvasOrBitmap: HTMLCanvasElement | ImageBitmap, caption: string) {
  const fig = document.createElement('figure');
  const c = document.createElement('canvas');
  c.width = canvasOrBitmap.width;
  c.height = canvasOrBitmap.height;
  c.getContext('2d')!.drawImage(canvasOrBitmap, 0, 0);
  const cap = document.createElement('figcaption');
  cap.textContent = caption;
  fig.append(c, cap);
  grid.append(fig);
}

async function main() {
  const bitmap = await makeTestBitmap();
  const results: Result[] = [];
  const stats: Record<string, unknown> = {};
  const screenshotFilter = (n: string) => n.startsWith('s1 ') || n === 's1' || n === 's1.3 tx+big focus0';

  for (const [w, h] of SIZES) {
    const canvas = document.createElement('canvas');
    const r = createRenderer(canvas);
    r.setSize(w, h);
    r.setBackground(BG_HEX);
    r.setPhoto(0, bitmap);
    for (const fit of FITS)
      for (const tf of TRANSFORMS) {
        r.draw(single(layer(0, fit, tf.t, tf.focus)));
        const samples = sampleCanvas(canvas, w, h);
        results.push({ name: tf.name, fit, size: `${w}x${h}`, samples });
        if (screenshotFilter(tf.name) && tf.name !== 's1 tx0.5 focus .2/.8')
          addFig(canvas, `${w}x${h} ${fit} ${tf.name}`);
      }
    // transition frame (crossfade) between two layers of the same photo, different fits
    r.setPhoto(1, bitmap);
    r.draw({
      kind: 'transition',
      style: 'crossfade',
      progress: 0.5,
      from: shotOf(layer(0, 'cover', { scale: 1, tx: 0, ty: 0 }, { x: 0.5, y: 0.5 })),
      to: shotOf(layer(1, 'blur', { scale: 1, tx: 0, ty: 0 }, { x: 0.5, y: 0.5 })),
    });
    addFig(canvas, `${w}x${h} transition crossfade p=.5 cover->blur`);
    // progress endpoints: 0 == from, 1 == to
    const endpoint = (p: number) => {
      r.draw({
        kind: 'transition',
        style: 'slideLeft',
        progress: p,
        from: shotOf(layer(0, 'cover', { scale: 1, tx: 0, ty: 0 }, { x: 0.5, y: 0.5 })),
        to: shotOf(layer(1, 'contain', { scale: 1, tx: 0, ty: 0 }, { x: 0.5, y: 0.5 })),
      });
      return sampleCanvas(canvas, w, h).px;
    };
    r.draw(single(layer(0, 'cover', { scale: 1, tx: 0, ty: 0 }, { x: 0.5, y: 0.5 })));
    const fromPx = sampleCanvas(canvas, w, h).px;
    r.draw(single(layer(1, 'contain', { scale: 1, tx: 0, ty: 0 }, { x: 0.5, y: 0.5 })));
    const toPx = sampleCanvas(canvas, w, h).px;
    stats[`endpoints ${w}x${h}`] = {
      p0EqualsFrom: JSON.stringify(endpoint(0)) === JSON.stringify(fromPx),
      p1EqualsTo: JSON.stringify(endpoint(1)) === JSON.stringify(toPx),
    };
    // texture lifecycle
    r.draw(single(layer(0, 'blur', { scale: 1, tx: 0, ty: 0 }, { x: 0.5, y: 0.5 })));
    const before = (r as unknown as { stats(): unknown }).stats();
    r.setPhoto(0, null);
    r.setPhoto(1, null);
    const after = (r as unknown as { stats(): unknown }).stats();
    stats[`textures ${w}x${h}`] = { before, after };
    r.dispose();
  }

  stats.layouts = await layoutStrips();
  stats.identity = await identityCheck();

  // Worker / OffscreenCanvas path
  const worker = new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' });
  const wb = await createImageBitmap(bitmap);
  const workerResult = await new Promise<Record<string, unknown>>((resolve) => {
    worker.onmessage = (e) => resolve(e.data as Record<string, unknown>);
    worker.postMessage({ bitmap: wb }, [wb]);
  });
  if (workerResult.image) {
    addFig(workerResult.image as ImageBitmap, 'worker OffscreenCanvas blur 1234x778');
    (workerResult.image as ImageBitmap).close();
    delete workerResult.image;
  }
  worker.terminate();
  bitmap.close();

  const coverReveal = results.filter((r) => r.fit === 'cover' && r.samples.hasBackground).length;
  const containHasBg = results.filter(
    (r) => r.fit === 'contain' && r.name === 's1' && r.samples.hasBackground,
  ).length;
  window.harnessResult = { results, stats, workerResult, coverReveal, containHasBg, done: true };
  status.textContent = `done: cover edge reveals = ${coverReveal} (want 0); contain s1 letterboxed cases = ${containHasBg}`;
}

main().catch((e) => {
  window.harnessResult = { error: String(e), done: true };
  status.textContent = `error: ${String(e)}`;
});

function heading(text: string) {
  const h = document.createElement('h3');
  h.textContent = text;
  h.style.flexBasis = '100%';
  h.style.margin = '12px 0 0';
  grid.append(h);
}

const LAYOUTS: MultiLayout[] = ['duo', 'trio', 'quad', 'pip', 'polaroid'];
const REVEALS = [0, 0.5, 1];

/** duo/trio/quad/pip/polaroid x reveal 0/.5/1 at 1920x1080 and 1080x1920, plus a crossfade between two shots. */
async function layoutStrips(): Promise<Record<string, unknown>> {
  const bitmaps = await Promise.all([
    makeTestBitmap(3000, 4000),
    makeTestBitmap(4000, 3000),
    makeTestBitmap(2400, 2400),
    makeTestBitmap(3600, 2000),
  ]);
  const info: Record<string, unknown> = {};
  for (const [w, h] of [
    [1920, 1080],
    [1080, 1920],
  ] as [number, number][]) {
    const canvas = document.createElement('canvas');
    canvas.dataset.size = `${w}x${h}`;
    const r = createRenderer(canvas) as MontageRenderer;
    r.setSize(w, h);
    r.setBackground('#202020');
    bitmaps.forEach((b, i) => r.setPhoto(i, b));
    for (const lay of LAYOUTS) {
      heading(`${lay} ${w}x${h} — reveal 0 / 0.5 / 1`);
      for (const rv of REVEALS) {
        r.draw({ kind: 'single', shot: layoutShot(lay, w, h, rv) });
        addFig(canvas, `${lay} ${w}x${h} r=${rv}`);
      }
    }
    heading(`transition crossfade p=.5 duo -> polaroid ${w}x${h}`);
    r.draw({
      kind: 'transition',
      style: 'crossfade',
      progress: 0.5,
      from: layoutShot('duo', w, h, 1),
      to: layoutShot('polaroid', w, h, 1),
    });
    addFig(canvas, `crossfade duo->polaroid ${w}x${h}`);
    const before = r.stats();
    for (let i = 0; i < bitmaps.length; i++) r.setPhoto(i, null);
    r.setSize(w, h);
    info[`${w}x${h}`] = { before, after: r.stats() };
    r.dispose();
  }
  bitmaps.forEach((b) => b.close());
  return info;
}

/** Invariant 1: single-cell shots through the shot renderer vs the frozen v1 renderer, same GPU, raw RGBA. */
async function identityCheck(): Promise<Record<string, unknown>> {
  const ref = await hashCases('v1');
  const got = await hashCases('v2');
  const refMap = new Map(ref.map((r) => [r.name, r.hash]));
  const mismatched = got.filter((g) => refMap.get(g.name) !== g.hash).map((g) => g.name);
  const el = document.createElement('div');
  el.id = 'identity';
  el.textContent = `pixel identity vs v1 renderer: ${got.length - mismatched.length}/${got.length} identical${
    mismatched.length ? ` — MISMATCH: ${mismatched.join(', ')}` : ''
  }`;
  status.after(el);
  return { cases: got.length, identical: got.length - mismatched.length, mismatched };
}
