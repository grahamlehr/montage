import type { FitMode, FrameDescriptor, Layer, Transform } from '../src/types';

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
export function single(l: Layer): FrameDescriptor {
  return { kind: 'single', layer: l };
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
