import type { PhotoSource } from '../types';

/** UI-local view of a photo in the tray. `thumbUrl` is an object/data URL produced by ingest. */
export interface PhotoItem {
  source: PhotoSource;
  thumbUrl: string | null;
  status: 'loading' | 'ready' | 'error';
  error?: string;
}

export interface DimensionPreset {
  label: string;
  width: number;
  height: number;
}
