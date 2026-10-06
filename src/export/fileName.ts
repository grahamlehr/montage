import type { MontageSettings } from '../types';

export function exportFileName(s: Pick<MontageSettings, 'width' | 'height' | 'totalDuration'>): string {
  return `montage-${s.width}x${s.height}-${s.totalDuration}s.mp4`;
}
