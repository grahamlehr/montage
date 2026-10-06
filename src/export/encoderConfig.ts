import { KEYFRAME_INTERVAL_S } from '../lib/constants';
import type { MontageSettings } from '../types';
import { bitrateFor, pickAvcCodec } from './avc';

export type EncoderPath = 'hardware' | 'software';
export type IsConfigSupported = (
  config: VideoEncoderConfig,
) => Promise<{ supported?: boolean; config?: VideoEncoderConfig }>;

export const HARDWARE_PREFERENCES = ['prefer-hardware', 'no-preference', 'prefer-software'] as const;

export class EncoderUnsupportedError extends Error {
  readonly codec: string;
  constructor(codec: string) {
    super(`This browser cannot encode H.264 (${codec}) at the requested size.`);
    this.name = 'EncoderUnsupportedError';
    this.codec = codec;
  }
}

export function baseEncoderConfig(
  s: Pick<MontageSettings, 'width' | 'height' | 'fps' | 'quality'>,
): VideoEncoderConfig {
  return {
    codec: pickAvcCodec(s.width, s.height, s.fps),
    width: s.width,
    height: s.height,
    bitrate: bitrateFor(s),
    framerate: s.fps,
    bitrateMode: 'variable',
    latencyMode: 'quality',
    avc: { format: 'avc' },
  };
}

/**
 * Walks prefer-hardware -> no-preference -> prefer-software and returns the first config the browser
 * reports as supported. Only an accepted 'prefer-hardware' is reported as 'hardware'; the other two
 * preferences give no guarantee, so they are reported as 'software'.
 */
export async function chooseEncoderConfig(
  base: VideoEncoderConfig,
  isConfigSupported: IsConfigSupported,
  skip: ReadonlyArray<VideoEncoderConfig['hardwareAcceleration']> = [],
): Promise<{ config: VideoEncoderConfig; encoderPath: EncoderPath }> {
  for (const hw of HARDWARE_PREFERENCES) {
    if (skip.includes(hw)) continue;
    const candidate: VideoEncoderConfig = { ...base, hardwareAcceleration: hw };
    let res: Awaited<ReturnType<IsConfigSupported>>;
    try {
      res = await isConfigSupported(candidate);
    } catch {
      continue;
    }
    if (res.supported) {
      return {
        config: { ...candidate, ...(res.config ?? {}), hardwareAcceleration: hw },
        encoderPath: hw === 'prefer-hardware' ? 'hardware' : 'software',
      };
    }
  }
  throw new EncoderUnsupportedError(base.codec ?? 'avc1');
}

export function keyframeInterval(fps: number): number {
  return Math.round(KEYFRAME_INTERVAL_S * fps);
}

export function frameCountFor(totalDuration: number, fps: number): number {
  return Math.round(totalDuration * fps);
}
