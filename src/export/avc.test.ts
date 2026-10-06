import { describe, expect, it } from 'vitest';
import { AvcLevelError, bitrateFor, pickAvcCodec } from './avc';

describe('pickAvcCodec', () => {
  it('1080x1920@30 -> level 4.0', () => expect(pickAvcCodec(1080, 1920, 30)).toBe('avc1.640028'));
  it('3840x2160@60 -> level 5.2', () => expect(pickAvcCodec(3840, 2160, 60)).toBe('avc1.640034'));
  it('4096x4096@30 -> level 6.0', () => expect(pickAvcCodec(4096, 4096, 30)).toBe('avc1.64003c'));
  it('1234x778@25 -> level 3.2 (non-multiple-of-16 dims)', () =>
    expect(pickAvcCodec(1234, 778, 25)).toBe('avc1.640020'));
  it('tiny frame -> level 1.1 (64 MB x 24 > 1485 MBPS)', () =>
    expect(pickAvcCodec(128, 128, 24)).toBe('avc1.64000b'));
  it('throws a typed error when nothing fits', () => {
    expect(() => pickAvcCodec(4096, 4096, 120)).not.toThrow();
    expect(() => pickAvcCodec(4096, 4096, 600)).toThrow(AvcLevelError);
  });
});

describe('bitrateFor', () => {
  it('w*h*fps*bpp', () =>
    expect(bitrateFor({ width: 1080, height: 1920, fps: 30, quality: 'high' })).toBe(
      Math.round(1080 * 1920 * 30 * 0.12),
    ));
});
