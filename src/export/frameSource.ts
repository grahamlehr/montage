import type { ExportRequest } from '../types';

/**
 * Pluggable frame producer for the export pipeline.
 *
 * Lifecycle: `init` once (decode photos, create renderer on `canvas`), then `draw(i, t)` for every frame
 * i = 0..frameCount-1 in order (t = i / fps), then `dispose` (always called, also on error/cancel).
 * `draw` must leave the finished frame on `canvas` when it returns/resolves (the pipeline snapshots the
 * canvas into a VideoFrame immediately after). The pipeline owns the canvas (sized to settings.width x height).
 */
export interface FrameSource {
  init(
    canvas: OffscreenCanvas,
    request: ExportRequest,
    onDecodeProgress: (done: number, total: number) => void,
  ): Promise<void>;
  draw(frameIndex: number, timeSeconds: number): void | Promise<void>;
  dispose(): void;
}

export type FrameSourceFactory = () => FrameSource;
