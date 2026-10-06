import { estimateBitrate } from '../lib/constants';
import type { MontageSettings } from '../types';

/** H.264 Table A-1 (level_idc, MaxMBPS, MaxFS). Level 1b omitted (not used with High profile). */
export const AVC_LEVELS: ReadonlyArray<{ idc: number; maxMbps: number; maxFs: number }> = [
  { idc: 10, maxMbps: 1485, maxFs: 99 },
  { idc: 11, maxMbps: 3000, maxFs: 396 },
  { idc: 12, maxMbps: 6000, maxFs: 396 },
  { idc: 13, maxMbps: 11880, maxFs: 396 },
  { idc: 20, maxMbps: 11880, maxFs: 396 },
  { idc: 21, maxMbps: 19800, maxFs: 792 },
  { idc: 22, maxMbps: 20250, maxFs: 1620 },
  { idc: 30, maxMbps: 40500, maxFs: 1620 },
  { idc: 31, maxMbps: 108000, maxFs: 3600 },
  { idc: 32, maxMbps: 216000, maxFs: 5120 },
  { idc: 40, maxMbps: 245760, maxFs: 8192 },
  { idc: 41, maxMbps: 245760, maxFs: 8192 },
  { idc: 42, maxMbps: 522240, maxFs: 8704 },
  { idc: 50, maxMbps: 589824, maxFs: 22080 },
  { idc: 51, maxMbps: 983040, maxFs: 36864 },
  { idc: 52, maxMbps: 2073600, maxFs: 36864 },
  { idc: 60, maxMbps: 4177920, maxFs: 139264 },
  { idc: 61, maxMbps: 8355840, maxFs: 139264 },
  { idc: 62, maxMbps: 16711680, maxFs: 139264 },
];

export class AvcLevelError extends Error {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  constructor(width: number, height: number, fps: number) {
    super(`H.264 cannot represent ${width}×${height} at ${fps} fps. Try a smaller size or a lower frame rate.`);
    this.name = 'AvcLevelError';
    this.width = width;
    this.height = height;
    this.fps = fps;
  }
}

/** Lowest High-profile level string (`avc1.6400xx`) that fits the frame size and rate (PLAN §4.5). */
export function pickAvcCodec(width: number, height: number, fps: number): string {
  const wMb = Math.ceil(width / 16);
  const hMb = Math.ceil(height / 16);
  const frameMbs = wMb * hMb;
  const mbps = frameMbs * fps;
  for (const l of AVC_LEVELS) {
    if (frameMbs <= l.maxFs && mbps <= l.maxMbps && Math.max(wMb, hMb) <= Math.sqrt(8 * l.maxFs)) {
      return `avc1.6400${l.idc.toString(16).padStart(2, '0')}`;
    }
  }
  throw new AvcLevelError(width, height, fps);
}

export function bitrateFor(s: Pick<MontageSettings, 'width' | 'height' | 'fps' | 'quality'>): number {
  return estimateBitrate(s);
}
