export interface Probe {
  w: number;
  h: number;
  /** RGB at top-centre and bottom-centre (orientation check). */
  top: [number, number, number];
  bottom: [number, number, number];
}
export interface CaseResult {
  name: string;
  context: 'main' | 'worker';
  natural?: { w: number; h: number };
  decoded?: Probe;
  thumb?: Probe;
  error?: { code: string; message: string };
}

export function probeBitmap(bmp: ImageBitmap, _thumb = false): Probe {
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  const px = (y: number): [number, number, number] => {
    const d = ctx.getImageData(Math.floor(bmp.width * 0.1), Math.min(bmp.height - 1, Math.max(0, y)), 1, 1).data;
    return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0];
  };
  return { w: bmp.width, h: bmp.height, top: px(Math.floor(bmp.height * 0.03)), bottom: px(Math.floor(bmp.height * 0.97)) };
}
