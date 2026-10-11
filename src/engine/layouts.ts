import { GUTTER_MAX } from '../lib/constants';
import { deriveSeed, mulberry32 } from '../lib/rng';
import type { CellBorder, LayoutStyle, Rect } from '../types';
import { clamp } from './easing';

export interface CellPlacement {
  rect: Rect;
  rotation: number;
  border: CellBorder;
}

export interface LayoutPlan {
  cells: CellPlacement[];
  /** Index into `cells` whose photo fills the backdrop, or null for the background colour. */
  backdropCell: number | null;
}

/** Trio hero share of the long axis (§4.7.2). */
export const TRIO_HERO = 0.58;
/** pip inset: short side as a fraction of the frame's short side, and corner margin. */
export const PIP_SIZE = 0.34;
export const PIP_MARGIN = 0.04;
/** polaroid card side as a fraction of the frame's short side, fan spacing, and max tilt. */
export const POLAROID_SIZE = 0.58;
export const POLAROID_SPREAD = 0.22;
export const POLAROID_MAX_TILT = (8 * Math.PI) / 180;

const FULL: Rect = { x: 0, y: 0, w: 1, h: 1 };
const flat = (rect: Rect, border: CellBorder = 'none'): CellPlacement => ({ rect, rotation: 0, border });

/**
 * Cell rects for a layout of `count` photos in a `width`×`height` frame (§4.7.2). Pure.
 * `gutter` is a fraction of the shorter side (clamped to 0..GUTTER_MAX), applied between cells and around the
 * outer edge for duo/trio/quad. `key` (the shot's first photo index) salts the pip/polaroid streams.
 */
export function layoutCells(
  layout: LayoutStyle,
  count: number,
  width: number,
  height: number,
  gutter: number,
  seed: number,
  key: number,
): LayoutPlan {
  const W = width > 0 ? width : 1;
  const H = height > 0 ? height : 1;
  const m = Math.min(W, H);
  const landscape = W >= H;
  const g = clamp(Number.isFinite(gutter) ? gutter : 0, 0, GUTTER_MAX) * m;
  const gx = g / W;
  const gy = g / H;

  switch (layout) {
    case 'single':
      return { cells: [flat({ ...FULL })], backdropCell: null };

    case 'duo': {
      if (landscape) {
        const w = (1 - 3 * gx) / 2;
        const h = 1 - 2 * gy;
        return {
          cells: [flat({ x: gx, y: gy, w, h }), flat({ x: 2 * gx + w, y: gy, w, h })],
          backdropCell: null,
        };
      }
      const w = 1 - 2 * gx;
      const h = (1 - 3 * gy) / 2;
      return {
        cells: [flat({ x: gx, y: gy, w, h }), flat({ x: gx, y: 2 * gy + h, w, h })],
        backdropCell: null,
      };
    }

    case 'trio': {
      if (landscape) {
        const inner = 1 - 3 * gx;
        const hw = inner * TRIO_HERO;
        const sw = inner - hw;
        const fh = 1 - 2 * gy;
        const sh = (1 - 3 * gy) / 2;
        const sx = 2 * gx + hw;
        return {
          cells: [
            flat({ x: gx, y: gy, w: hw, h: fh }),
            flat({ x: sx, y: gy, w: sw, h: sh }),
            flat({ x: sx, y: 2 * gy + sh, w: sw, h: sh }),
          ],
          backdropCell: null,
        };
      }
      const inner = 1 - 3 * gy;
      const hh = inner * TRIO_HERO;
      const sh = inner - hh;
      const fw = 1 - 2 * gx;
      const sw = (1 - 3 * gx) / 2;
      const sy = 2 * gy + hh;
      return {
        cells: [
          flat({ x: gx, y: gy, w: fw, h: hh }),
          flat({ x: gx, y: sy, w: sw, h: sh }),
          flat({ x: 2 * gx + sw, y: sy, w: sw, h: sh }),
        ],
        backdropCell: null,
      };
    }

    case 'quad': {
      const w = (1 - 3 * gx) / 2;
      const h = (1 - 3 * gy) / 2;
      const cells: CellPlacement[] = [];
      for (let r = 0; r < 2; r++) {
        for (let c = 0; c < 2; c++) cells.push(flat({ x: gx + c * (w + gx), y: gy + r * (h + gy), w, h }));
      }
      return { cells: cells.slice(0, Math.max(1, Math.min(4, count))), backdropCell: null };
    }

    case 'pip': {
      // Inset keeps the output aspect; its short side is PIP_SIZE of the frame's short side.
      const s = PIP_SIZE * m;
      const iw = (landscape ? (s * W) / H : s) / W;
      const ih = (landscape ? s : (s * H) / W) / H;
      const mx = (PIP_MARGIN * m) / W;
      const my = (PIP_MARGIN * m) / H;
      const corner = Math.floor(mulberry32(deriveSeed(seed, 'pip', key))() * 4);
      const right = corner === 1 || corner === 3;
      const bottom = corner >= 2;
      const inset: Rect = { x: right ? 1 - mx - iw : mx, y: bottom ? 1 - my - ih : my, w: iw, h: ih };
      return { cells: [flat({ ...FULL }), flat(inset, 'polaroid')], backdropCell: null };
    }

    case 'polaroid': {
      const k = Math.max(1, Math.min(3, count));
      const rng = mulberry32(deriveSeed(seed, 'polaroid', key));
      const side = POLAROID_SIZE * m;
      const long = landscape ? W : H;
      const shortPx = landscape ? H : W;
      const spread = k > 1 ? Math.min(POLAROID_SPREAD * m, (long - side) / (k - 1)) : 0;
      const cells: CellPlacement[] = [];
      for (let j = 0; j < k; j++) {
        const rotation = (rng() * 2 - 1) * POLAROID_MAX_TILT;
        const jitter = (rng() * 2 - 1) * 0.03 * m;
        const along = clamp(long / 2 + (j - (k - 1) / 2) * spread - side / 2, 0, long - side);
        const across = clamp(shortPx / 2 + jitter - side / 2, 0, shortPx - side);
        const px = landscape ? along : across;
        const py = landscape ? across : along;
        cells.push({
          rect: { x: px / W, y: py / H, w: side / W, h: side / H },
          rotation,
          border: 'polaroid',
        });
      }
      return { cells, backdropCell: 0 };
    }
  }
}
