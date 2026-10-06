import { BufferTarget, EncodedPacket, EncodedVideoPacketSource, Mp4OutputFormat, Output } from 'mediabunny';
import type { ExportMessage, ExportRequest } from '../types';
import { baseEncoderConfig, chooseEncoderConfig, frameCountFor, keyframeInterval } from './encoderConfig';
import { EncoderUnsupportedError } from './encoderConfig';
import type { IsConfigSupported } from './encoderConfig';
import type { FrameSource } from './frameSource';

export const MAX_ENCODE_QUEUE = 8;
export const PROGRESS_INTERVAL_MS = 100;

export class CancelledError extends Error {
  constructor() {
    super('cancelled');
    this.name = 'CancelledError';
  }
}

export interface PipelineHandle {
  /** Request cancellation; the pipeline rejects with CancelledError after cleanup. */
  cancel(): void;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      ch.port1.close();
      resolve();
    };
    ch.port2.postMessage(0);
  });
}

type DoneMessage = Extract<ExportMessage, { type: 'done' }>;
type ProgressMessage = Extract<ExportMessage, { type: 'progress' }>;
type HwPref = VideoEncoderConfig['hardwareAcceleration'];

export interface EncoderInit {
  output: (chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata) => void;
  error: (e: Error) => void;
}

/** The slice of VideoEncoder the pipeline uses (also implemented by test fakes). */
export interface VideoEncoderLike {
  readonly state: string;
  readonly encodeQueueSize: number;
  configure(config: VideoEncoderConfig): void;
  encode(frame: VideoFrame, options?: VideoEncoderEncodeOptions): void;
  flush(): Promise<void>;
  close(): void;
  addEventListener(type: 'dequeue', listener: () => void): void;
  removeEventListener(type: 'dequeue', listener: () => void): void;
}

/** Muxer seam. `add` must read the chunk synchronously (it may be called from the encoder output callback). */
export interface MuxerLike {
  start(): Promise<void>;
  add(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): Promise<void>;
  /** Finalize and return the MP4 bytes. */
  finalize(): Promise<ArrayBuffer | null>;
  cancel(): Promise<void>;
}

/** Environment seams; every field defaults to the real browser implementation. Used by unit tests. */
export interface PipelineDeps {
  createEncoder: (init: EncoderInit) => VideoEncoderLike;
  createMuxer: (fps: number) => MuxerLike;
  createCanvas: (width: number, height: number) => OffscreenCanvas;
  createFrame: (canvas: OffscreenCanvas, timestamp: number, duration: number) => VideoFrame;
  isConfigSupported: IsConfigSupported;
  now: () => number;
}

function defaultMuxer(fps: number): MuxerLike {
  const target = new BufferTarget();
  const videoSource = new EncodedVideoPacketSource('avc');
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
  output.addVideoTrack(videoSource, { frameRate: fps });
  return {
    start: () => output.start(),
    add: (chunk, meta) => videoSource.add(EncodedPacket.fromEncodedChunk(chunk), meta),
    finalize: async () => {
      await output.finalize();
      return target.buffer;
    },
    cancel: () => output.cancel(),
  };
}

const defaultDeps: PipelineDeps = {
  createEncoder: (init) => new VideoEncoder(init),
  createMuxer: defaultMuxer,
  createCanvas: (w, h) => new OffscreenCanvas(w, h),
  createFrame: (canvas, timestamp, duration) => new VideoFrame(canvas, { timestamp, duration }),
  isConfigSupported: (c) => VideoEncoder.isConfigSupported(c),
  now: () => performance.now(),
};

/** An encoder (not muxer/cancel) failure: the caller may retry with the next hardware preference. */
class EncoderRuntimeError extends Error {
  override readonly cause: Error;
  constructor(cause: Error) {
    super(cause.message);
    this.name = 'EncoderRuntimeError';
    this.cause = cause;
  }
}

/**
 * Runs one export: frame source -> OffscreenCanvas -> VideoFrame -> VideoEncoder -> Mediabunny MP4.
 * If the encoder fails at runtime, the encode restarts from frame 0 with the next untried hardware
 * preference (prefer-hardware -> no-preference -> prefer-software); it fails only when all are exhausted.
 * Resolves with the 'done' message; rejects with CancelledError on cancel, or any other Error on failure.
 */
export function runExport(
  request: ExportRequest,
  source: FrameSource,
  post: (m: ExportMessage) => void,
  deps: Partial<PipelineDeps> = {},
): { handle: PipelineHandle; result: Promise<DoneMessage> } {
  let cancelled = false;
  let wake: (() => void) | null = null;
  const handle: PipelineHandle = {
    cancel() {
      cancelled = true;
      wake?.();
    },
  };
  const result = run(
    request,
    source,
    post,
    () => cancelled,
    (w) => (wake = w),
    { ...defaultDeps, ...deps },
  );
  return { handle, result };
}

async function run(
  request: ExportRequest,
  source: FrameSource,
  post: (m: ExportMessage) => void,
  isCancelled: () => boolean,
  setWake: (w: (() => void) | null) => void,
  d: PipelineDeps,
): Promise<DoneMessage> {
  const { settings } = request;
  const { width, height, fps } = settings;
  const total = frameCountFor(settings.totalDuration, fps);
  const check = () => {
    if (isCancelled()) throw new CancelledError();
  };

  let sourceInitialised = false;
  let lastPost = -Infinity;
  const post100 = (m: ProgressMessage, force = false) => {
    const now = d.now();
    if (!force && now - lastPost < PROGRESS_INTERVAL_MS) return;
    lastPost = now;
    post(m);
  };

  // Waiters (queue backpressure / cancel / encoder error) are all woken through one function.
  const waiters = new Set<() => void>();
  const wake = () => {
    for (const w of [...waiters]) w();
  };

  try {
    const canvas = d.createCanvas(width, height);
    sourceInitialised = true;
    await source.init(canvas, request, (done, tot) =>
      post100({ type: 'progress', phase: 'decoding', done, total: tot }, done >= tot),
    );
    check();
    setWake(wake);

    const base = baseEncoderConfig(settings);
    const tried: HwPref[] = [];
    let lastEncoderError: Error | null = null;

    for (;;) {
      check();
      let chosen: Awaited<ReturnType<typeof chooseEncoderConfig>>;
      try {
        chosen = await chooseEncoderConfig(base, d.isConfigSupported, tried);
      } catch (e) {
        // Every preference was either rejected up front or already failed at runtime.
        if (e instanceof EncoderUnsupportedError && lastEncoderError) {
          throw new Error(`Video encoder failed: ${lastEncoderError.message}`, { cause: e });
        }
        throw e;
      }
      check();
      tried.push(chosen.config.hardwareAcceleration);
      try {
        return await attempt(chosen);
      } catch (e) {
        if (!(e instanceof EncoderRuntimeError)) throw e;
        lastEncoderError = e.cause;
        check();
        // loop: restart from frame 0 with the next untried preference
      }
    }

    async function attempt(chosen: Awaited<ReturnType<typeof chooseEncoderConfig>>): Promise<DoneMessage> {
      let encoder: VideoEncoderLike | null = null;
      let encodeError: Error | null = null;
      let fatalError: Error | null = null;
      let framesOut = 0;
      let packetChain: Promise<void> = Promise.resolve();
      const muxer = d.createMuxer(fps);
      const failEncoder = (e: unknown) => {
        encodeError ??= e instanceof Error ? e : new Error(String(e));
        wake();
      };
      const throwIfFailed = () => {
        if (fatalError) throw fatalError;
        if (encodeError) throw new EncoderRuntimeError(encodeError);
      };
      const waitFor = (cond: () => boolean): Promise<void> =>
        new Promise((resolve) => {
          const tryResolve = () => {
            if (cond() || isCancelled() || encodeError || fatalError) {
              waiters.delete(tryResolve);
              encoder?.removeEventListener('dequeue', tryResolve);
              resolve();
            }
          };
          waiters.add(tryResolve);
          encoder?.addEventListener('dequeue', tryResolve);
          tryResolve();
        });

      try {
        await muxer.start();
        const enc = d.createEncoder({
          output: (chunk, meta) => {
            framesOut++;
            const added = packetChain.then(() => muxer.add(chunk, meta));
            packetChain = added;
            added.catch((e: unknown) => {
              fatalError ??= e instanceof Error ? e : new Error(String(e));
              wake();
            });
          },
          error: failEncoder,
        });
        encoder = enc;
        enc.configure(chosen.config);

        // Restart progress from zero (also announces a retry to the UI).
        post100({ type: 'progress', phase: 'encoding', done: 0, total }, true);
        const startedAt = d.now();
        const interval = keyframeInterval(fps);
        const frameDurationUs = Math.round(1e6 / fps);
        let lastYield = d.now();

        for (let i = 0; i < total; i++) {
          check();
          throwIfFailed();
          if (enc.encodeQueueSize > MAX_ENCODE_QUEUE) {
            await waitFor(() => enc.encodeQueueSize <= MAX_ENCODE_QUEUE);
            check();
            throwIfFailed();
          }
          await source.draw(i, i / fps);
          check();
          throwIfFailed();
          const frame = d.createFrame(canvas, Math.round((i * 1e6) / fps), frameDurationUs);
          try {
            enc.encode(frame, { keyFrame: i % interval === 0 });
          } catch (e) {
            failEncoder(e);
          } finally {
            frame.close();
          }
          throwIfFailed();
          const now = d.now();
          if (now - lastYield > 25) {
            await yieldToEventLoop();
            lastYield = d.now();
          }
          const done = i + 1;
          const elapsed = (now - startedAt) / 1000;
          post100({
            type: 'progress',
            phase: 'encoding',
            done,
            total,
            etaSeconds: done > 0 ? (elapsed / done) * (total - done) : undefined,
          });
        }

        check();
        post100({ type: 'progress', phase: 'finalizing', done: total, total }, true);
        const flushed = enc.flush();
        flushed.catch((e: unknown) => failEncoder(e));
        await Promise.race([flushed, waitFor(() => false)]);
        check();
        throwIfFailed();
        await packetChain;
        check();
        throwIfFailed();
        if (framesOut !== total) {
          throw new EncoderRuntimeError(new Error(`Encoder produced ${framesOut} frames, expected ${total}`));
        }
        const buffer = await muxer.finalize();
        if (!buffer) throw new Error('Muxer produced no data');
        const blob = new Blob([buffer], { type: 'video/mp4' });
        return {
          type: 'done',
          blob,
          bytes: blob.size,
          codec: chosen.config.codec ?? base.codec,
          encoderPath: chosen.encoderPath,
        };
      } catch (e) {
        await muxer.cancel().catch(() => undefined);
        throw e;
      } finally {
        const enc = encoder as VideoEncoderLike | null;
        if (enc && enc.state !== 'closed') enc.close();
      }
    }
  } finally {
    setWake(null);
    if (sourceInitialised) source.dispose();
  }
}
