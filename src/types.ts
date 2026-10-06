/**
 * SHARED CONTRACT (PLAN.md §3). Orchestrator-owned: agents must not edit this file;
 * propose changes under CONTRACT REQUESTS in their report.
 */
export type FitMode = 'cover' | 'contain' | 'blur'; // blur = contain over blurred cover

export type MotionStyle =
  'none' | 'kenBurns' | 'zoomIn' | 'zoomOut' | 'panLeft' | 'panRight' | 'panUp' | 'panDown';

export type TransitionStyle =
  | 'cut'
  | 'crossfade'
  | 'dipToBlack'
  | 'slideLeft'
  | 'slideRight'
  | 'slideUp'
  | 'slideDown'
  | 'push'
  | 'wipe'
  | 'zoom'
  | 'blur';

export type StyleSelection = 'sequence' | 'random';

export interface PhotoSource {
  id: string;
  file: File;
  name: string;
  naturalWidth: number; // after EXIF orientation applied
  naturalHeight: number;
}

export interface PhotoOverrides {
  motion?: MotionStyle;
  transitionIn?: TransitionStyle; // transition INTO this photo (ignored for photo 0)
  fit?: FitMode;
  focus?: { x: number; y: number }; // 0..1 focal point for cover crop / motion target
}

export interface MontageSettings {
  width: number; // even, 128..4096
  height: number; // even, 128..4096
  fps: 24 | 25 | 30 | 60;
  totalDuration: number; // seconds, 2..600
  transitionSpeed: number; // 0..1   0 = slow (long transitions), 1 = fast
  motionIntensity: number; // 0..1   0 = static, 1 = strong zoom/pan
  pacing: number; // 0..1   0 = even durations, 1 = dynamic rhythm
  motionPool: MotionStyle[]; // ≥1 enabled styles
  transitionPool: TransitionStyle[]; // ≥1 enabled styles
  selection: StyleSelection;
  seed: number; // drives all randomness
  fit: FitMode;
  background: string; // CSS hex, used for contain letterbox
  quality: 'standard' | 'high' | 'max';
}

/** Fully resolved, deterministic plan for the whole video. */
export interface Segment {
  photoIndex: number;
  start: number; // seconds, photo first visible (start of its transition-in)
  end: number; // seconds, photo last visible (end of transition-out)
  motion: MotionStyle;
  motionFrom: Transform; // transform at `start`
  motionTo: Transform; // transform at `end`
  fit: FitMode;
  focus: { x: number; y: number };
  transitionIn: { style: TransitionStyle; start: number; duration: number } | null;
}

export interface Transform {
  scale: number;
  tx: number;
  ty: number;
} // tx/ty in output-frame fractions

export interface Timeline {
  duration: number;
  fps: number;
  frameCount: number; // round(duration * fps)
  segments: Segment[];
}

export interface Layer {
  photoIndex: number;
  fit: FitMode;
  focus: { x: number; y: number };
  transform: Transform; // eased, at time t
}

export type FrameDescriptor =
  | { kind: 'single'; layer: Layer }
  | { kind: 'transition'; style: TransitionStyle; progress: number /*0..1 eased*/; from: Layer; to: Layer };

export interface Renderer {
  setSize(width: number, height: number): void;
  setPhoto(index: number, bitmap: ImageBitmap | null): void; // null = release texture
  setBackground(hex: string): void;
  draw(frame: FrameDescriptor): void;
  dispose(): void;
}

export interface ExportRequest {
  files: File[]; // in montage order
  photos: PhotoSource[];
  overrides: Record<string, PhotoOverrides>; // keyed by PhotoSource.id
  settings: MontageSettings;
}

export type ExportMessage =
  | {
      type: 'progress';
      phase: 'decoding' | 'encoding' | 'finalizing';
      done: number;
      total: number;
      etaSeconds?: number;
    }
  | { type: 'done'; blob: Blob; bytes: number; codec: string; encoderPath: 'hardware' | 'software' }
  | { type: 'error'; message: string }
  | { type: 'cancelled' };

/** Messages posted TO the export worker. `cancel` aborts an in-flight export (worker replies `cancelled`). */
export type ExportCommand = { type: 'start'; request: ExportRequest } | { type: 'cancel' };
