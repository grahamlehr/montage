import { createRenderer } from '../src/render';
import { BG_HEX, layer, sampleCanvas, single } from './render-common';

self.onmessage = async (ev: MessageEvent<{ bitmap: ImageBitmap }>) => {
  try {
    const canvas = new OffscreenCanvas(1234, 778);
    const r = createRenderer(canvas);
    r.setSize(1234, 778);
    r.setBackground(BG_HEX);
    r.setPhoto(0, ev.data.bitmap);
    const out: Record<string, unknown> = {};
    for (const fit of ['cover', 'contain', 'blur'] as const) {
      r.draw(single(layer(0, fit, { scale: 1.3, tx: 1, ty: 1 }, { x: 0, y: 0 })));
      out[fit] = sampleCanvas(canvas, 1234, 778);
    }
    r.draw(single(layer(0, 'blur', { scale: 1, tx: 0, ty: 0 }, { x: 0.5, y: 0.5 })));
    const image = await createImageBitmap(canvas);
    const stats = (r as unknown as { stats(): unknown }).stats();
    r.setPhoto(0, null);
    const after = (r as unknown as { stats(): unknown }).stats();
    r.dispose();
    (self as unknown as Worker).postMessage({ ok: true, out, stats, after, image }, [image]);
  } catch (e) {
    (self as unknown as Worker).postMessage({ ok: false, error: String(e) });
  }
};
