import { createRenderer } from '../src/render';
import {
  BG_HEX,
  FITS,
  SIZES,
  TRANSFORMS,
  layer,
  makeTestBitmap,
  sampleCanvas,
  single,
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
  }
}

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
      from: layer(0, 'cover', { scale: 1, tx: 0, ty: 0 }, { x: 0.5, y: 0.5 }),
      to: layer(1, 'blur', { scale: 1, tx: 0, ty: 0 }, { x: 0.5, y: 0.5 }),
    });
    addFig(canvas, `${w}x${h} transition crossfade p=.5 cover->blur`);
    // progress endpoints: 0 == from, 1 == to
    const endpoint = (p: number) => {
      r.draw({
        kind: 'transition',
        style: 'slideLeft',
        progress: p,
        from: layer(0, 'cover', { scale: 1, tx: 0, ty: 0 }, { x: 0.5, y: 0.5 }),
        to: layer(1, 'contain', { scale: 1, tx: 0, ty: 0 }, { x: 0.5, y: 0.5 }),
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
