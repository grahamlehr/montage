import { describe, expect, it } from 'vitest';
import {
  POLAROID_BOTTOM,
  POLAROID_SIDE,
  REVEAL_TILT,
  backdropPlacement,
  blurKey,
  blurSize,
  cellGeometry,
  cellPixelRect,
  coversFrame,
  isFullFrameCell,
  localToFrame,
  parseHex,
  placePhoto,
} from './layout';

const sizes: [number, number][] = [
  [1080, 1920],
  [1920, 1080],
  [1234, 778],
];
const photos: [number, number][] = [
  [4000, 3000],
  [3000, 4000],
  [1000, 1000],
  [5000, 800],
];

describe('placePhoto cover', () => {
  it('always covers the frame, even with extreme focus/translation/zoom', () => {
    for (const [W, H] of sizes)
      for (const [pw, ph] of photos)
        for (const scale of [1, 1.3, 2])
          for (const f of [0, 0.5, 1])
            for (const tx of [-5, -0.3, 0, 0.3, 5])
              for (const ty of [-5, 0, 5]) {
                const p = placePhoto(pw, ph, W, H, 'cover', { x: f, y: 1 - f }, { scale, tx, ty });
                expect(coversFrame(p, W, H)).toBe(true);
              }
  });
  it('scale 1 fills exactly along one axis and crops around focus', () => {
    const p = placePhoto(4000, 3000, 1000, 1000, 'cover', { x: 0, y: 0.5 }, { scale: 1, tx: 0, ty: 0 });
    expect(p.h).toBeCloseTo(1000);
    expect(p.cx - p.w / 2).toBeCloseTo(0); // focus x=0 -> left edge aligned
    const q = placePhoto(4000, 3000, 1000, 1000, 'cover', { x: 1, y: 0.5 }, { scale: 1, tx: 0, ty: 0 });
    expect(q.cx + q.w / 2).toBeCloseTo(1000);
  });
  it('translation moves the photo when there is slack', () => {
    const a = placePhoto(4000, 3000, 1000, 1000, 'cover', { x: 0.5, y: 0.5 }, { scale: 1, tx: 0, ty: 0 });
    const b = placePhoto(4000, 3000, 1000, 1000, 'cover', { x: 0.5, y: 0.5 }, { scale: 1, tx: 0.05, ty: 0 });
    expect(b.cx - a.cx).toBeCloseTo(50);
  });
});

describe('placePhoto contain', () => {
  it('fits inside the frame at scale 1, centred', () => {
    const p = placePhoto(4000, 3000, 1080, 1920, 'contain', { x: 0.5, y: 0.5 }, { scale: 1, tx: 0, ty: 0 });
    expect(p.w).toBeCloseTo(1080);
    expect(p.h).toBeCloseTo(810);
    expect(p.cx).toBeCloseTo(540);
    expect(p.cy).toBeCloseTo(960);
  });
  it('scales about centre and translates by frame fractions', () => {
    const p = placePhoto(
      1000,
      1000,
      1000,
      500,
      'contain',
      { x: 0.5, y: 0.5 },
      { scale: 2, tx: 0.1, ty: -0.2 },
    );
    expect(p.w).toBeCloseTo(1000);
    expect(p.cx).toBeCloseTo(600);
    expect(p.cy).toBeCloseTo(150);
  });
});

describe('helpers', () => {
  it('parseHex', () => {
    expect(parseHex('#ff0000')).toEqual([1, 0, 0]);
    expect(parseHex('#0f0')).toEqual([0, 1, 0]);
    expect(parseHex('nope')).toEqual([0, 0, 0]);
  });
  it('blurSize is reduced', () => {
    expect(blurSize(1080, 1920)).toEqual({ w: 270, h: 480 });
    expect(blurSize(128, 128).w).toBeGreaterThanOrEqual(16);
  });
});

describe('backdropPlacement (blur fit)', () => {
  it('always covers the frame for scale 1..1.3, |tx|,|ty| <= 0.12, any focus', () => {
    for (const [W, H] of sizes)
      for (const scale of [1, 1.15, 1.3])
        for (const fx of [0, 0.3, 0.5, 1])
          for (const fy of [0, 0.7, 1])
            for (const tx of [-0.12, 0, 0.12])
              for (const ty of [-0.12, 0, 0.12]) {
                const p = backdropPlacement(W, H, { x: fx, y: fy }, { scale, tx, ty });
                expect(coversFrame(p, W, H)).toBe(true);
              }
  });
  it('is the identity at scale 1 / no translation and moves with tx when zoomed', () => {
    const id = backdropPlacement(1080, 1920, { x: 0.5, y: 0.5 }, { scale: 1, tx: 0, ty: 0 });
    expect(id).toEqual({ cx: 540, cy: 960, w: 1080, h: 1920 });
    const a = backdropPlacement(1080, 1920, { x: 0.5, y: 0.5 }, { scale: 1.3, tx: 0, ty: 0 });
    const b = backdropPlacement(1080, 1920, { x: 0.5, y: 0.5 }, { scale: 1.3, tx: 0.1, ty: 0 });
    expect(b.cx).toBeGreaterThan(a.cx);
    expect(b.w).toBeCloseTo(1080 * 1.3);
  });
});

const full = { x: 0, y: 0, w: 1, h: 1 };

describe('cellPixelRect', () => {
  it('snaps to whole pixels and neighbours tile without gaps or overlap', () => {
    const W = 1234;
    const H = 778;
    const a = cellPixelRect({ x: 0, y: 0, w: 1 / 3, h: 1 }, W, H);
    const b = cellPixelRect({ x: 1 / 3, y: 0, w: 1 / 3, h: 1 }, W, H);
    const c = cellPixelRect({ x: 2 / 3, y: 0, w: 1 / 3, h: 1 }, W, H);
    for (const r of [a, b, c]) for (const v of Object.values(r)) expect(Number.isInteger(v)).toBe(true);
    expect(a.x + a.w).toBe(b.x);
    expect(b.x + b.w).toBe(c.x);
    expect(c.x + c.w).toBe(W);
    expect(cellPixelRect(full, W, H)).toEqual({ x: 0, y: 0, w: W, h: H });
  });
  it('clamps to the frame and never returns an empty rect', () => {
    expect(cellPixelRect({ x: -0.5, y: 0.9, w: 0.6, h: 0.5 }, 100, 100)).toEqual({
      x: 0,
      y: 90,
      w: 10,
      h: 10,
    });
    expect(cellPixelRect({ x: 0.5, y: 0.5, w: 0, h: 0 }, 100, 100)).toEqual({ x: 50, y: 50, w: 1, h: 1 });
  });
});

describe('isFullFrameCell (invariant-1 fast path)', () => {
  const base = { rect: full, rotation: 0, border: 'none' as const, reveal: 1 };
  it('accepts exactly the v1-equivalent cell', () => {
    expect(isFullFrameCell(base)).toBe(true);
  });
  it('rejects anything else', () => {
    expect(isFullFrameCell({ ...base, rect: { x: 0, y: 0, w: 0.5, h: 1 } })).toBe(false);
    expect(isFullFrameCell({ ...base, rotation: 0.01 })).toBe(false);
    expect(isFullFrameCell({ ...base, border: 'polaroid' })).toBe(false);
    expect(isFullFrameCell({ ...base, reveal: 0.999 })).toBe(false);
  });
});

describe('cellGeometry', () => {
  const W = 1920;
  const H = 1080;
  it('plain cell at reveal 1: card = pixel rect, content = card, no shadow, opaque', () => {
    const rect = { x: 0.25, y: 0.1, w: 0.5, h: 0.4 };
    const g = cellGeometry({ rect, rotation: 0, border: 'none', reveal: 1 }, W, H);
    const px = cellPixelRect(rect, W, H);
    expect(g.cx).toBe(px.x + px.w / 2);
    expect(g.cy).toBe(px.y + px.h / 2);
    expect(g.cardHalfW * 2).toBe(px.w);
    expect(g.cardHalfH * 2).toBe(px.h);
    expect([g.contentW, g.contentH]).toEqual([px.w, px.h]);
    expect([g.photoOffX, g.photoOffY, g.photoHalfW, g.photoHalfH]).toEqual([0, 0, g.cardHalfW, g.cardHalfH]);
    expect(g.alpha).toBe(1);
    expect(g.shadowOpacity).toBe(0);
    expect(g.quadHalfW).toBe(g.cardHalfW + 1);
  });
  it('reveal animation: alpha r, y offset (1-r)*6% of cell height, scale 0.96+0.04r', () => {
    const rect = { x: 0.1, y: 0.2, w: 0.4, h: 0.5 };
    const px = cellPixelRect(rect, W, H);
    const at = (r: number) => cellGeometry({ rect, rotation: 0.1, border: 'none', reveal: r }, W, H);
    const g0 = at(0);
    const gh = at(0.5);
    expect(g0.alpha).toBe(0);
    expect(gh.alpha).toBe(0.5);
    expect(g0.cy - at(1).cy).toBeCloseTo(0.06 * px.h);
    expect(gh.cy - at(1).cy).toBeCloseTo(0.03 * px.h);
    expect(g0.cardHalfW).toBeCloseTo((px.w / 2) * 0.96);
    expect(gh.cardHalfW).toBeCloseTo((px.w / 2) * 0.98);
    // content is rendered unscaled so motion doesn't shift during the reveal
    expect(g0.contentW).toBe(at(1).contentW);
    // only polaroids rotate in
    expect(g0.rotation).toBe(0.1);
  });
  it('polaroid: white frame 4% / 14% of the short side, shadow, rotates in', () => {
    const rect = { x: 0.3, y: 0.2, w: 0.3, h: 0.6 };
    const px = cellPixelRect(rect, W, H);
    const short = Math.min(px.w, px.h);
    const g = cellGeometry({ rect, rotation: -0.1, border: 'polaroid', reveal: 1 }, W, H);
    // photo area edges inside the card
    const top = g.photoOffY - g.photoHalfH;
    const bottom = g.photoOffY + g.photoHalfH;
    expect(top + g.cardHalfH).toBeCloseTo(POLAROID_SIDE * short, 0);
    expect(g.cardHalfH - bottom).toBeCloseTo(POLAROID_BOTTOM * short, 0);
    expect(g.cardHalfW - g.photoHalfW).toBeCloseTo(POLAROID_SIDE * short, 0);
    expect(g.shadowOpacity).toBeGreaterThan(0);
    expect(g.quadHalfW).toBeGreaterThan(g.cardHalfW + g.shadowBlur);
    expect(g.rotation).toBe(-0.1);
    const g0 = cellGeometry({ rect, rotation: -0.1, border: 'polaroid', reveal: 0 }, W, H);
    expect(g0.rotation).toBeCloseTo(-0.1 + REVEAL_TILT);
  });
  it('rotation is about the card centre, clockwise on screen (y down)', () => {
    const g = cellGeometry(
      { rect: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, rotation: Math.PI / 2, border: 'none', reveal: 1 },
      W,
      H,
    );
    expect(localToFrame(g, 0, 0)).toEqual({ x: g.cx, y: g.cy });
    const p = localToFrame(g, 10, 0); // +x local -> +y (down) on screen
    expect(p.x).toBeCloseTo(g.cx);
    expect(p.y).toBeCloseTo(g.cy + 10);
  });
  it('quad corners of an unrotated full-reveal grid cell stay inside its pixel rect + 1px', () => {
    const rect = { x: 0.0125, y: 0.02, w: 0.48, h: 0.47 };
    const px = cellPixelRect(rect, W, H);
    const g = cellGeometry({ rect, rotation: 0, border: 'none', reveal: 1 }, W, H);
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ] as const) {
      const p = localToFrame(g, sx * g.quadHalfW, sy * g.quadHalfH);
      expect(p.x).toBeGreaterThanOrEqual(px.x - 1);
      expect(p.x).toBeLessThanOrEqual(px.x + px.w + 1);
      expect(p.y).toBeGreaterThanOrEqual(px.y - 1);
      expect(p.y).toBeLessThanOrEqual(px.y + px.h + 1);
    }
  });
  it('blurKey distinguishes cell sizes', () => {
    expect(blurKey(960, 1080)).not.toBe(blurKey(1920, 1080));
  });
});
