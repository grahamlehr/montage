import type {
  CellBorder,
  CellLayer,
  FitMode,
  FrameDescriptor,
  Layer,
  MultiLayout,
  Rect,
  Shot,
  Transform,
  TransitionStyle,
} from '../src/types';

export const BG_HEX = '#ff00ff';

/** Test photo: grid, border, labelled corners, gradient, circle. Drawn with a 2D canvas (no fixtures needed). */
export async function makeTestBitmap(w = 4000, h = 3000): Promise<ImageBitmap> {
  const c = new OffscreenCanvas(w, h);
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, '#1b3a5c');
  grad.addColorStop(1, '#d9a441');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(255,255,255,0.5)';
  g.lineWidth = Math.max(2, w / 1000);
  const step = w / 20;
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
  g.beginPath();
  g.arc(w / 2, h / 2, h / 4, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#000';
  g.lineWidth = w / 200;
  g.stroke();
  const border = w / 100;
  g.strokeStyle = '#00ff00';
  g.lineWidth = border * 2;
  g.strokeRect(0, 0, w, h);
  const cs = Math.min(w, h) / 6;
  const corners: [string, number, number, string][] = [
    ['TL', 0, 0, '#ff0000'],
    ['TR', w - cs, 0, '#0000ff'],
    ['BL', 0, h - cs, '#ffff00'],
    ['BR', w - cs, h - cs, '#00ffff'],
  ];
  g.font = `bold ${cs / 2}px sans-serif`;
  g.textBaseline = 'middle';
  g.textAlign = 'center';
  for (const [label, x, y, col] of corners) {
    g.fillStyle = col;
    g.fillRect(x, y, cs, cs);
    g.fillStyle = '#000';
    g.fillText(label, x + cs / 2, y + cs / 2);
  }
  g.fillStyle = '#000';
  g.font = `bold ${h / 12}px sans-serif`;
  g.fillText(`${w}x${h} photo`, w / 2, h / 2);
  return createImageBitmap(c);
}

/**
 * Byte-exact test photo built from ImageData (no gradients/text, whose 2D-canvas rasterisation is not
 * reproducible between page loads). Used for pixel-identity hashing.
 */
export function makePatternBitmap(w = 4000, h = 3000): Promise<ImageBitmap> {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const check = ((x >> 6) ^ (y >> 6)) & 1;
      d[i] = (x * 255) / w;
      d[i + 1] = (y * 255) / h;
      d[i + 2] = check ? 220 : (x * y) & 63;
      d[i + 3] = 255;
    }
  return createImageBitmap(new ImageData(d, w, h));
}

export const SIZES: [number, number][] = [
  [1080, 1920],
  [1920, 1080],
  [1234, 778],
];
export const FITS: FitMode[] = ['cover', 'contain', 'blur'];
export const TRANSFORMS: { name: string; t: Transform; focus: { x: number; y: number } }[] = [
  { name: 's1', t: { scale: 1, tx: 0, ty: 0 }, focus: { x: 0.5, y: 0.5 } },
  { name: 's1.3', t: { scale: 1.3, tx: 0, ty: 0 }, focus: { x: 0.5, y: 0.5 } },
  { name: 's1.3 tx+big focus0', t: { scale: 1.3, tx: 1, ty: 1 }, focus: { x: 0, y: 0 } },
  { name: 's1.3 tx-big focus1', t: { scale: 1.3, tx: -1, ty: -1 }, focus: { x: 1, y: 1 } },
  { name: 's1 tx0.5 focus .2/.8', t: { scale: 1, tx: 0.5, ty: -0.5 }, focus: { x: 0.2, y: 0.8 } },
];

export function layer(
  photoIndex: number,
  fit: FitMode,
  t: Transform,
  focus: { x: number; y: number },
): Layer {
  return { photoIndex, fit, focus, transform: t };
}
/** A v1-equivalent shot: one full-frame, unrotated, unbordered, fully revealed cell (the renderer's fast path). */
export function shotOf(l: Layer): Shot {
  return { backdrop: null, cells: [cell(l, { x: 0, y: 0, w: 1, h: 1 })] };
}
export function single(l: Layer): FrameDescriptor {
  return { kind: 'single', shot: shotOf(l) };
}
export function cell(l: Layer, rect: Rect, rotation = 0, border: CellBorder = 'none', reveal = 1): CellLayer {
  return { ...l, rect, rotation, border, reveal };
}

const S1: Transform = { scale: 1, tx: 0, ty: 0 };
const C: { x: number; y: number } = { x: 0.5, y: 0.5 };
const cov = (i: number, t: Transform = S1): Layer => layer(i, 'cover', t, C);

/**
 * Hand-built shots following proposal §4.7.2 (independent of the engine): gutter 0.012 of the short side,
 * outer gutter for duo/trio/quad. Cells k >= 1 get `reveal` (cell 0 is always present, as with stagger).
 */
export function layoutShot(layout: MultiLayout, W: number, H: number, reveal: number): Shot {
  const g = 0.012 * Math.min(W, H);
  const land = W >= H;
  // fractional rect from pixel coords
  const R = (x: number, y: number, w: number, h: number): Rect => ({
    x: x / W,
    y: y / H,
    w: w / W,
    h: h / H,
  });
  const rv = (k: number) => (k === 0 ? 1 : reveal);
  const grid = (rects: Rect[], t: Transform[] = []): Shot => ({
    backdrop: null,
    cells: rects.map((r, k) => cell(cov(k, t[k] ?? S1), r, 0, 'none', rv(k))),
  });
  switch (layout) {
    case 'duo':
      return land
        ? grid([
            R(g, g, (W - 3 * g) / 2, H - 2 * g),
            R(g + (W - 3 * g) / 2 + g, g, (W - 3 * g) / 2, H - 2 * g),
          ])
        : grid([
            R(g, g, W - 2 * g, (H - 3 * g) / 2),
            R(g, g + (H - 3 * g) / 2 + g, W - 2 * g, (H - 3 * g) / 2),
          ]);
    case 'trio': {
      if (land) {
        const hw = (W - 3 * g) * 0.58;
        const rw = W - 3 * g - hw;
        const rh = (H - 3 * g) / 2;
        return grid([R(g, g, hw, H - 2 * g), R(2 * g + hw, g, rw, rh), R(2 * g + hw, 2 * g + rh, rw, rh)]);
      }
      const hh = (H - 3 * g) * 0.58;
      const bh = H - 3 * g - hh;
      const bw = (W - 3 * g) / 2;
      return grid([R(g, g, W - 2 * g, hh), R(g, 2 * g + hh, bw, bh), R(2 * g + bw, 2 * g + hh, bw, bh)]);
    }
    case 'quad': {
      const cw = (W - 3 * g) / 2;
      const ch = (H - 3 * g) / 2;
      return grid(
        [
          R(g, g, cw, ch),
          R(2 * g + cw, g, cw, ch),
          R(g, 2 * g + ch, cw, ch),
          R(2 * g + cw, 2 * g + ch, cw, ch),
        ],
        [S1, { scale: 1.2, tx: 0.05, ty: 0 }, S1, { scale: 1.1, tx: 0, ty: -0.05 }],
      );
    }
    case 'pip': {
      const short = Math.min(W, H);
      const side = 0.34 * short;
      const m = 0.04 * short;
      return {
        backdrop: null,
        cells: [
          cell(cov(0), { x: 0, y: 0, w: 1, h: 1 }),
          cell(cov(1), R(W - m - side, H - m - side * 1.1, side, side * 1.1), 0, 'polaroid', rv(1)),
        ],
      };
    }
    case 'polaroid': {
      const short = Math.min(W, H);
      const cw = 0.58 * short * 0.9;
      const ch = 0.58 * short;
      const spread = 0.2 * short;
      const offs = [-spread, 0, spread];
      const rots = [-0.12, 0.05, 0.13];
      return {
        backdrop: { ...cov(0), fit: 'cover' },
        cells: offs.map((o, k) =>
          cell(
            cov(k),
            R(W / 2 + (land ? o : 0) - cw / 2, H / 2 + (land ? 0 : o) - ch / 2, cw, ch),
            rots[k] ?? 0,
            'polaroid',
            rv(k),
          ),
        ),
      };
    }
  }
}

/** Cases for the invariant-1 pixel-identity check (rendered by the v1 renderer and the shot renderer). */
export interface IdentityCase {
  name: string;
  w: number;
  h: number;
  /** single: `from` only; transition: from -> to at `progress`. */
  style?: TransitionStyle;
  progress?: number;
  from: Layer;
  to?: Layer;
}
export function identityCases(): IdentityCase[] {
  const out: IdentityCase[] = [];
  for (const [w, h] of SIZES) {
    for (const fit of FITS)
      for (const tf of TRANSFORMS)
        out.push({ name: `${w}x${h} ${fit} ${tf.name}`, w, h, from: layer(0, fit, tf.t, tf.focus) });
    const t = (x: Transform, f = C) => ({ t: x, f });
    const a = t({ scale: 1.15, tx: 0.04, ty: -0.02 }, { x: 0.3, y: 0.6 });
    const b = t({ scale: 1.05, tx: -0.03, ty: 0.01 });
    for (const [style, p, fa, fb] of [
      ['crossfade', 0.5, 'cover', 'blur'],
      ['slideLeft', 0.3, 'contain', 'cover'],
      ['blur', 0.6, 'blur', 'blur'],
      ['zoom', 0.45, 'blur', 'contain'],
    ] as [TransitionStyle, number, FitMode, FitMode][])
      out.push({
        name: `${w}x${h} ${style}@${p} ${fa}->${fb}`,
        w,
        h,
        style,
        progress: p,
        from: layer(0, fa, a.t, a.f),
        to: layer(1, fb, b.t, b.f),
      });
  }
  return out;
}

export interface Samples {
  /** RGB at 4 corners + 4 edge midpoints (inset 1px). */
  px: number[][];
  /** True if any sample equals the background magenta (edge reveal / letterbox). */
  hasBackground: boolean;
}
const isMagenta = (p: number[]) => p[0]! > 240 && p[1]! < 15 && p[2]! > 240;

export function sampleCanvas(src: CanvasImageSource, w: number, h: number): Samples {
  const c = new OffscreenCanvas(w, h);
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(src, 0, 0);
  const pts: [number, number][] = [
    [1, 1],
    [w - 2, 1],
    [1, h - 2],
    [w - 2, h - 2],
    [(w / 2) | 0, 1],
    [(w / 2) | 0, h - 2],
    [1, (h / 2) | 0],
    [w - 2, (h / 2) | 0],
  ];
  const px = pts.map(([x, y]) => Array.from(g.getImageData(x, y, 1, 1).data.slice(0, 3)));
  return { px, hasBackground: px.some(isMagenta) };
}
