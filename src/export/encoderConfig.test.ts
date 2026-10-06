import { describe, expect, it } from 'vitest';
import {
  baseEncoderConfig,
  chooseEncoderConfig,
  EncoderUnsupportedError,
  frameCountFor,
  keyframeInterval,
} from './encoderConfig';
import type { IsConfigSupported } from './encoderConfig';
import { exportFileName } from './fileName';

const base = baseEncoderConfig({ width: 1080, height: 1920, fps: 30, quality: 'high' });
const supportOnly =
  (...allowed: string[]): IsConfigSupported =>
  async (c) => ({ supported: allowed.includes(c.hardwareAcceleration ?? ''), config: c });

describe('chooseEncoderConfig', () => {
  it('prefers hardware', async () => {
    const r = await chooseEncoderConfig(base, supportOnly('prefer-hardware', 'prefer-software'));
    expect(r.encoderPath).toBe('hardware');
    expect(r.config.hardwareAcceleration).toBe('prefer-hardware');
  });
  it('falls back to no-preference then prefer-software (both reported as software)', async () => {
    const a = await chooseEncoderConfig(base, supportOnly('no-preference', 'prefer-software'));
    expect(a.config.hardwareAcceleration).toBe('no-preference');
    expect(a.encoderPath).toBe('software');
    const b = await chooseEncoderConfig(base, supportOnly('prefer-software'));
    expect(b.config.hardwareAcceleration).toBe('prefer-software');
  });
  it('treats a throwing isConfigSupported as unsupported, and throws when none work', async () => {
    const calls: string[] = [];
    await expect(
      chooseEncoderConfig(base, async (c) => {
        calls.push(c.hardwareAcceleration ?? '');
        throw new Error('x');
      }),
    ).rejects.toBeInstanceOf(EncoderUnsupportedError);
    expect(calls).toEqual(['prefer-hardware', 'no-preference', 'prefer-software']);
  });
  it('can skip already-tried preferences', async () => {
    const r = await chooseEncoderConfig(base, supportOnly('prefer-hardware', 'no-preference'), [
      'prefer-hardware',
    ]);
    expect(r.config.hardwareAcceleration).toBe('no-preference');
  });
});

describe('helpers', () => {
  it('base config', () => {
    expect(base.codec).toBe('avc1.640028');
    expect(base.bitrate).toBe(Math.round(1080 * 1920 * 30 * 0.12));
  });
  it('frame count and keyframes', () => {
    expect(frameCountFor(5, 25)).toBe(125);
    expect(frameCountFor(2.5, 30)).toBe(75);
    expect(keyframeInterval(30)).toBe(60);
  });
  it('file name', () =>
    expect(exportFileName({ width: 1080, height: 1920, totalDuration: 60 })).toBe(
      'montage-1080x1920-60s.mp4',
    ));
});
