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

/** How a shot arranges its photos. `single` = one full-frame cell (v1 behaviour). PLAN.md §4.9. */
export type LayoutStyle = 'single' | 'duo' | 'trio' | 'quad' | 'pip' | 'polaroid';
export type MultiLayout = Exclude<LayoutStyle, 'single'>;

/**
 * off   = one photo per shot (default; output identical to v1).
 * auto  = pair consecutive photos whose orientation fights the output (portraits in landscape, landscapes in portrait).
 * mixed = auto, plus seeded multi-photo shots drawn from `layoutPool`.
 */
export type Grouping = 'off' | 'auto' | 'mixed';

/** together = all cells visible from the shot's start; stagger = cells 1..n pop in one after another. */
export type CellReveal = 'together' | 'stagger';

export type CellBorder = 'none' | 'polaroid';

/** Rectangle in output-frame fractions (0..1), origin TOP-LEFT, +y down. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PhotoSource {
  id: string;
  file: File;
  name: string;
  naturalWidth: number; // after EXIF orientation applied
  naturalHeight: number;
}

export interface PhotoOverrides {
  motion?: MotionStyle;
  transitionIn?: TransitionStyle; // transition INTO this photo's shot; honoured only on a shot's FIRST photo (ignored for photo 0)
  fit?: FitMode;
  focus?: { x: number; y: number }; // 0..1 focal point for cover crop / motion target
  group?: 'solo' | 'joinNext'; // never group this photo / force it into a shot with the next photo
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
  grouping: Grouping; // default 'off'
  layoutPool: MultiLayout[]; // ≥1 enabled layouts, used when grouping = 'mixed'
  gutter: number; // 0..0.04 of the shorter output side, filled with `background`
  reveal: CellReveal;
}

/** One photo placed inside a shot. Per-photo motion/fit/focus live here (v1 had them on Segment). */
export interface Cell {
  photoIndex: number;
  rect: Rect; // gutter applied; {0,0,1,1} for a single-photo shot
  rotation: number; // radians about the rect centre (polaroid tilt); 0 otherwise
  border: CellBorder;
  motion: MotionStyle;
  motionFrom: Transform; // transform at segment `start`; tx/ty in CELL fractions (= frame fractions when rect is full)
  motionTo: Transform; // transform at segment `end`
  fit: FitMode;
  focus: { x: number; y: number };
  revealStart: number; // seconds (absolute); == segment.start unless staggered
  revealDuration: number; // seconds; 0 = present from revealStart
}

/** Fully resolved, deterministic plan for the whole video. A segment is one SHOT of 1..4 cells. */
export interface Segment {
  layout: LayoutStyle;
  cells: Cell[]; // ≥1, consecutive photoIndex ascending, draw order back→front
  backdrop: number | null; // photoIndex whose blurred cover fills behind the cells; null = background colour
  start: number; // seconds, shot first visible (start of its transition-in)
  end: number; // seconds, shot last visible (end of transition-out)
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

/** Result of engine `buildTimeline()`; `error` is a user-facing validation message (§4.1 step 4). */
export type BuildResult = { ok: true; timeline: Timeline } | { ok: false; error: string };

export interface Layer {
  photoIndex: number;
  fit: FitMode;
  focus: { x: number; y: number };
  transform: Transform; // eased, at time t
}

/** A cell at time t. */
export interface CellLayer extends Layer {
  rect: Rect;
  rotation: number;
  border: CellBorder;
  reveal: number; // 0..1 eased; 0 = not drawn, 1 = fully placed
}

/** Everything drawn for one shot at time t; the renderer composites it into one full-frame texture. */
export interface Shot {
  backdrop: Layer | null; // drawn full-frame (cover, blurred + darkened) before the cells
  cells: CellLayer[];
}

export type FrameDescriptor =
  | { kind: 'single'; shot: Shot }
  | { kind: 'transition'; style: TransitionStyle; progress: number /*0..1 eased*/; from: Shot; to: Shot };

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
