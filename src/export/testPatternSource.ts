import type { ExportRequest } from '../types';
import type { FrameSource } from './frameSource';

/** Deterministic test pattern: moving bars, sweeping marker and a frame counter. */
export function createTestPatternSource(): FrameSource {
  let ctx: OffscreenCanvasRenderingContext2D | null = null;
  let w = 0;
  let h = 0;
  let total = 0;
  return {
    async init(canvas, request: ExportRequest, onDecodeProgress) {
      w = canvas.width;
      h = canvas.height;
      total = Math.round(request.settings.totalDuration * request.settings.fps);
      ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('2D canvas unavailable');
      onDecodeProgress(1, 1);
    },
    draw(i, t) {
      if (!ctx) throw new Error('not initialised');
      const bars = 8;
      const bw = w / bars;
      const shift = (t * w * 0.25) % w;
      for (let b = -1; b < bars; b++) {
        ctx.fillStyle = `hsl(${(b + bars) * (360 / bars)} 70% 50%)`;
        ctx.fillRect(b * bw + shift, 0, bw + 1, h);
      }
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      const boxH = Math.min(h * 0.3, w * 0.4);
      ctx.fillRect(0, h / 2 - boxH / 2, w, boxH);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `bold ${Math.round(Math.min(w / 5, boxH / 2))}px monospace`;
      ctx.fillText(String(i).padStart(4, '0'), w / 2, h / 2 - boxH * 0.12);
      ctx.font = `${Math.round(Math.min(w / 12, boxH / 5))}px monospace`;
      ctx.fillText(`${t.toFixed(2)}s / ${total}f ${w}x${h}`, w / 2, h / 2 + boxH * 0.3);
      ctx.fillStyle = '#fff';
      ctx.fillRect(((t * 0.4) % 1) * (w - 20), h - 30, 20, 20);
    },
    dispose() {
      ctx = null;
    },
  };
}
