import { buildTimeline, frameAt } from '../src/engine';
import { DEFAULT_SETTINGS } from '../src/lib/constants';
import { createRenderer } from '../src/render';
import type { FrameDescriptor, Layer, MotionStyle, TransitionStyle } from '../src/types';

declare global {
  interface Window {
    harnessResult?: unknown;
  }
}

const STYLES: TransitionStyle[] = [
  'cut',
  'crossfade',
  'dipToBlack',
  'slideLeft',
  'slideRight',
  'slideUp',
  'slideDown',
  'push',
  'wipe',
  'zoom',
  'blur',
];
const MOTIONS: MotionStyle[] = [
  'none',
  'kenBurns',
  'zoomIn',
  'zoomOut',
  'panLeft',
  'panRight',
  'panUp',
  'panDown',
];
const PROGRESS = [0, 0.25, 0.5, 0.75, 1];
const SIZES: [number, number][] = [
  [1080, 1920],
  [1920, 1080],
];
const BG = '#ff00ff';

/** Labelled grid test image. `hue` = base colour. */
async function labelled(
  label: string,
  base: string,
  line: string,
  w: number,
  h: number,
): Promise<ImageBitmap> {
  const c = new OffscreenCanvas(w, h);
  const g = c.getContext('2d')!;
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = line;
  g.lineWidth = Math.max(2, w / 300);
  const step = Math.min(w, h) / 8;
  for (let x = 0; x <= w; x += step) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, h);
    g.stroke();
  }
  for (let y = 0; y <= h; y += step) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(w, y);
    g.stroke();
  }
  g.fillStyle = '#fff';
  g.font = `bold ${Math.min(w, h) * 0.7}px sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(label, w / 2, h / 2);
  return createImageBitmap(c);
}

/** Dark image with a single pure-white dot at the centre, for tracking motion. */
async function dotImage(w: number, h: number): Promise<ImageBitmap> {
  const c = new OffscreenCanvas(w, h);
  const g = c.getContext('2d')!;
  g.fillStyle = '#101820';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = '#506070';
  g.lineWidth = 3;
  for (let x = 0; x <= w; x += w / 10) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, h);
    g.stroke();
  }
  for (let y = 0; y <= h; y += h / 10) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(w, y);
    g.stroke();
  }
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(w / 2, h / 2, Math.min(w, h) * 0.05, 0, Math.PI * 2);
  g.fill();
  return createImageBitmap(c);
}

const layer = (i: number): Layer => ({
  photoIndex: i,
  fit: 'cover',
  focus: { x: 0.5, y: 0.5 },
  transform: { scale: 1, tx: 0, ty: 0 },
});
const trans = (style: TransitionStyle, progress: number): FrameDescriptor => ({
  kind: 'transition',
  style,
  progress,
  from: layer(0),
  to: layer(1),
});

function readPixels(canvas: HTMLCanvasElement): Uint8ClampedArray {
  const c = document.createElement('canvas');
  c.width = canvas.width;
  c.height = canvas.height;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(canvas, 0, 0);
  return g.getImageData(0, 0, c.width, c.height).data;
}
function maxDiff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs((a[i] as number) - (b[i] as number)));
  return m;
}
function count(d: Uint8ClampedArray, pred: (r: number, g: number, b: number) => boolean): number {
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (pred(d[i] as number, d[i + 1] as number, d[i + 2] as number)) n++;
  return n;
}
function dot(d: Uint8ClampedArray, w: number, h: number) {
  let n = 0,
    sx = 0,
    sy = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if ((d[i] as number) > 235 && (d[i + 1] as number) > 235 && (d[i + 2] as number) > 235) {
        n++;
        sx += x;
        sy += y;
      }
    }
  return { area: n, x: n ? sx / n / w : NaN, y: n ? sy / n / h : NaN };
}

const out = document.getElementById('out')!;
const status = document.getElementById('status')!;
function heading(t: string) {
  const h = document.createElement('h2');
  h.textContent = t;
  out.append(h);
}
function addRow(label: string, canvases: { c: HTMLCanvasElement; cap: string }[], dispH: number) {
  const row = document.createElement('div');
  row.className = 'row';
  const l = document.createElement('div');
  l.className = 'lbl';
  l.textContent = label;
  row.append(l);
  for (const { c, cap } of canvases) {
    const fig = document.createElement('figure');
    const d = document.createElement('canvas');
    d.height = dispH;
    d.width = Math.round((c.width / c.height) * dispH);
    d.getContext('2d')!.drawImage(c, 0, 0, d.width, d.height);
    const fc = document.createElement('figcaption');
    fc.textContent = cap;
    fig.append(d, fc);
    row.append(fig);
  }
  out.append(row);
}

async function main() {
  const errors: string[] = [];
  const tResults: unknown[] = [];
  const mResults: unknown[] = [];

  for (const [w, h] of SIZES) {
    heading(`Transitions ${w}x${h} (cover fit, background magenta)`);
    const canvas = document.createElement('canvas');
    const r = createRenderer(canvas);
    r.setSize(w, h);
    r.setBackground(BG);
    r.setPhoto(0, await labelled('A', '#7a1c1c', '#ff7070', 1600, 1600));
    r.setPhoto(1, await labelled('B', '#1c2c7a', '#7090ff', 1600, 1600));
    r.draw({ kind: 'single', layer: layer(0) });
    const pureFrom = readPixels(canvas);
    r.draw({ kind: 'single', layer: layer(1) });
    const pureTo = readPixels(canvas);
    const dispH = h > w ? 220 : 120;
    for (const style of STYLES) {
      const strip: { c: HTMLCanvasElement; cap: string }[] = [];
      let d0 = 0,
        d1 = 0,
        magenta = 0,
        black = 0;
      for (const p of PROGRESS) {
        r.draw(trans(style, p));
        const px = readPixels(canvas);
        if (p === 0) d0 = maxDiff(px, pureFrom);
        if (p === 1) d1 = maxDiff(px, pureTo);
        if (p > 0 && p < 1) {
          magenta += count(px, (R, G, B) => R > 200 && G < 60 && B > 200);
          black += count(px, (R, G, B) => R < 6 && G < 6 && B < 6);
        }
        const copy = document.createElement('canvas');
        copy.width = w;
        copy.height = h;
        copy.getContext('2d')!.drawImage(canvas, 0, 0);
        strip.push({ c: copy, cap: `p=${p}` });
      }
      // dense sweep for garbage check (magenta = bg leak, black = undefined sample), excluding dipToBlack
      let sweepBad = 0;
      for (let k = 1; k < 20; k++) {
        r.draw(trans(style, k / 20));
        const px = readPixels(canvas);
        sweepBad += count(px, (R, G, B) => R > 200 && G < 60 && B > 200);
        if (style !== 'dipToBlack') sweepBad += count(px, (R, G, B) => R < 6 && G < 6 && B < 6);
      }
      addRow(style, strip, dispH);
      tResults.push({ style, size: `${w}x${h}`, diffAt0: d0, diffAt1: d1, sweepBad, magenta, black });
      if (style !== 'cut' && (d0 !== 0 || d1 !== 0))
        errors.push(`${style} ${w}x${h}: endpoint diff ${d0}/${d1}`);
      if (sweepBad > 0) errors.push(`${style} ${w}x${h}: ${sweepBad} garbage pixels`);
    }
    r.dispose();
  }

  // Motion verification via real engine -> frameAt -> renderer.
  heading('Motion (intensity 1, 1080x1920, one photo 6 s, frames at start / mid / end)');
  {
    const w = 1080,
      h = 1920;
    const canvas = document.createElement('canvas');
    const r = createRenderer(canvas);
    r.setSize(w, h);
    r.setBackground(BG);
    r.setPhoto(0, await dotImage(540, 960));
    for (const m of MOTIONS) {
      const res = buildTimeline(
        [{ id: 'a' }],
        {},
        {
          ...DEFAULT_SETTINGS,
          width: w,
          height: h,
          totalDuration: 6,
          motionIntensity: 1,
          motionPool: [m],
          fit: 'cover',
          background: BG,
        },
      );
      if (!res.ok) {
        errors.push(`timeline ${m}: ${res.error}`);
        continue;
      }
      const tl = res.timeline;
      const L = tl.duration;
      const strip: { c: HTMLCanvasElement; cap: string }[] = [];
      const samples = [0, L / 2, L].map((t) => {
        const fd = frameAt(tl, t);
        r.draw(fd);
        const d = dot(readPixels(canvas), w, h);
        const copy = document.createElement('canvas');
        copy.width = w;
        copy.height = h;
        copy.getContext('2d')!.drawImage(canvas, 0, 0);
        strip.push({ c: copy, cap: `t=${t} dot=(${d.x.toFixed(3)},${d.y.toFixed(3)}) area=${d.area}` });
        return d;
      });
      addRow(m, strip, 220);
      const [a, b, c] = samples as [ReturnType<typeof dot>, ReturnType<typeof dot>, ReturnType<typeof dot>];
      const seg = tl.segments[0]!;
      const dx = c.x - a.x,
        dy = c.y - a.y,
        dA = c.area / a.area;
      const eps = 0.01;
      let ok = true;
      switch (m) {
        case 'none':
          ok = Math.abs(dx) < 1e-3 && Math.abs(dy) < 1e-3 && a.area === c.area;
          break;
        case 'panLeft':
          ok = dx < -eps && Math.abs(dy) < eps && b.x < a.x && b.x > c.x;
          break;
        case 'panRight':
          ok = dx > eps && Math.abs(dy) < eps && b.x > a.x && b.x < c.x;
          break;
        case 'panUp':
          ok = dy < -eps && Math.abs(dx) < eps && b.y < a.y && b.y > c.y;
          break;
        case 'panDown':
          ok = dy > eps && Math.abs(dx) < eps && b.y > a.y && b.y < c.y;
          break;
        case 'zoomIn':
          ok = dA > 1.3 && b.area > a.area && b.area < c.area;
          break;
        case 'zoomOut':
          ok = dA < 1 / 1.3 && b.area < a.area && b.area > c.area;
          break;
        case 'kenBurns': {
          // consistent with the engine's segment transforms
          const es = seg.motionTo.scale / seg.motionFrom.scale;
          const sxOk = Math.sign(dx) === Math.sign(seg.motionTo.tx - seg.motionFrom.tx) || Math.abs(dx) < eps;
          const syOk = Math.sign(dy) === Math.sign(seg.motionTo.ty - seg.motionFrom.ty) || Math.abs(dy) < eps;
          const zOk = Math.abs(Math.sqrt(dA) - es) < 0.05 * es;
          ok = sxOk && syOk && zOk && (Math.abs(dx) > eps || Math.abs(dy) > eps || Math.abs(dA - 1) > 0.05);
          break;
        }
      }
      mResults.push({ motion: m, dx, dy, areaRatio: dA, mid: { x: b.x, y: b.y, area: b.area }, ok });
      if (!ok) errors.push(`motion ${m} wrong: dx=${dx} dy=${dy} dA=${dA}`);
    }
    r.dispose();
  }

  // Perf: blur transition at 4096x2160 (GPU time incl. readback of one pixel).
  let perf: unknown;
  {
    const canvas = document.createElement('canvas');
    const r = createRenderer(canvas);
    r.setSize(4096, 2160);
    r.setPhoto(0, await labelled('A', '#7a1c1c', '#ff7070', 2000, 1200));
    r.setPhoto(1, await labelled('B', '#1c2c7a', '#7090ff', 2000, 1200));
    const gl = canvas.getContext('webgl2')!;
    const px = new Uint8Array(4);
    const timeStyle = (style: TransitionStyle) => {
      r.draw(trans(style, 0.5));
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const t0 = performance.now();
      for (let i = 0; i < 10; i++) {
        r.draw(trans(style, 0.5));
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      }
      return (performance.now() - t0) / 10;
    };
    perf = { size: '4096x2160', blurMs: timeStyle('blur'), crossfadeMs: timeStyle('crossfade') };
    r.dispose();
  }

  status.textContent = errors.length ? `FAILED: ${errors.join('; ')}` : 'all checks passed';
  window.harnessResult = { done: true, errors, transitions: tResults, motion: mResults, perf };
}

main().catch((e) => {
  status.textContent = `error: ${String(e)}`;
  window.harnessResult = { done: true, errors: [String(e)] };
});
