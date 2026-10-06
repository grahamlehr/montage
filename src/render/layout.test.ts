import { describe, expect, it } from 'vitest';
import { backdropPlacement, blurSize, coversFrame, parseHex, placePhoto } from './layout';

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
