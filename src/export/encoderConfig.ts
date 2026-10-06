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
 * Honest encoderPath label. Chrome does not tell us which encoder it actually picked, so:
 *  - 'prefer-hardware'  -> 'hardware' (the config was accepted with a hardware preference)
 *  - 'prefer-software'  -> 'software'
 *  - 'no-preference'    -> 'hardware' only if `prefer-hardware` isConfigSupported() was true for the same
 *    config (Chrome then normally picks the hardware encoder), otherwise 'software'.
 */
export function encoderPathFor(
  hw: VideoEncoderConfig['hardwareAcceleration'],
  preferHardwareSupported: boolean,
): EncoderPath {
  if (hw === 'prefer-hardware') return 'hardware';
  if (hw === 'no-preference') return preferHardwareSupported ? 'hardware' : 'software';
  return 'software';
}

/**
 * Walks prefer-hardware -> no-preference -> prefer-software and returns the first config the browser
 * reports as supported (skipping preferences in `skip`, e.g. ones that already failed at runtime).
 * See encoderPathFor for how the label is derived.
 */
export async function chooseEncoderConfig(
  base: VideoEncoderConfig,
  isConfigSupported: IsConfigSupported,
  skip: ReadonlyArray<VideoEncoderConfig['hardwareAcceleration']> = [],
): Promise<{ config: VideoEncoderConfig; encoderPath: EncoderPath }> {
  let hwSupported: boolean | undefined;
  const probeHardware = async (): Promise<boolean> => {
    if (hwSupported !== undefined) return hwSupported;
    try {
      hwSupported = !!(await isConfigSupported({ ...base, hardwareAcceleration: 'prefer-hardware' }))
        .supported;
    } catch {
      hwSupported = false;
    }
    return hwSupported;
  };
  for (const hw of HARDWARE_PREFERENCES) {
    if (skip.includes(hw)) continue;
    const candidate: VideoEncoderConfig = { ...base, hardwareAcceleration: hw };
    let res: Awaited<ReturnType<IsConfigSupported>>;
    try {
      res = await isConfigSupported(candidate);
    } catch {
      if (hw === 'prefer-hardware') hwSupported = false;
      continue;
    }
    if (hw === 'prefer-hardware') hwSupported = !!res.supported;
    if (res.supported) {
      return {
        config: { ...candidate, ...(res.config ?? {}), hardwareAcceleration: hw },
        encoderPath: encoderPathFor(hw, hw === 'no-preference' ? await probeHardware() : false),
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
