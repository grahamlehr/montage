import { BufferTarget, EncodedPacket, EncodedVideoPacketSource, Mp4OutputFormat, Output } from 'mediabunny';
import type { ExportMessage, ExportRequest } from '../types';
import { baseEncoderConfig, chooseEncoderConfig, frameCountFor, keyframeInterval } from './encoderConfig';
import type { EncoderPath } from './encoderConfig';
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

/**
 * Runs one export: frame source -> OffscreenCanvas -> VideoFrame -> VideoEncoder -> Mediabunny MP4.
 * Resolves with the 'done' message; rejects with CancelledError on cancel, or any other Error on failure.
 */
export function runExport(
  request: ExportRequest,
  source: FrameSource,
  post: (m: ExportMessage) => void,
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
  );
  return { handle, result };
}

async function run(
  request: ExportRequest,
  source: FrameSource,
  post: (m: ExportMessage) => void,
  isCancelled: () => boolean,
  setWake: (w: (() => void) | null) => void,
): Promise<DoneMessage> {
  const { settings } = request;
  const { width, height, fps } = settings;
  const total = frameCountFor(settings.totalDuration, fps);
  const check = () => {
    if (isCancelled()) throw new CancelledError();
  };

  let encoder: VideoEncoder | null = null;
  let output: Output | null = null;
  let sourceInitialised = false;
  let lastPost = -Infinity;
  const post100 = (m: Extract<ExportMessage, { type: 'progress' }>, force = false) => {
    const now = performance.now();
    if (!force && now - lastPost < PROGRESS_INTERVAL_MS) return;
    lastPost = now;
    post(m);
  };

  try {
    const canvas = new OffscreenCanvas(width, height);
    sourceInitialised = true;
    await source.init(canvas, request, (done, tot) =>
      post100({ type: 'progress', phase: 'decoding', done, total: tot }, done >= tot),
    );
    check();

    // Pick encoder config (prefer-hardware -> no-preference -> prefer-software, gated by isConfigSupported).
    const base = baseEncoderConfig(settings);
    const tried: VideoEncoderConfig['hardwareAcceleration'][] = [];
    let codec = base.codec;
    let encoderPath: EncoderPath = 'software';
    let encodeError: Error | null = null;
    let packetChain: Promise<void> = Promise.resolve();
    let target = new BufferTarget();
    let videoSource = new EncodedVideoPacketSource('avc');
    let framesOut = 0;

    const setup = async (): Promise<void> => {
      const chosen = await chooseEncoderConfig(base, (c) => VideoEncoder.isConfigSupported(c), tried);
      tried.push(chosen.config.hardwareAcceleration);
      encoderPath = chosen.encoderPath;
      codec = chosen.config.codec ?? base.codec;
      encodeError = null;
      packetChain = Promise.resolve();
      framesOut = 0;
      target = new BufferTarget();
      videoSource = new EncodedVideoPacketSource('avc');
      output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
      output.addVideoTrack(videoSource, { frameRate: fps });
      await output.start();
      const vs = videoSource;
      const enc = new VideoEncoder({
        output: (chunk, meta) => {
          const packet = EncodedPacket.fromEncodedChunk(chunk);
          framesOut++;
          packetChain = packetChain.then(() => vs.add(packet, meta));
          packetChain.catch((e: unknown) => {
            encodeError ??= e instanceof Error ? e : new Error(String(e));
            wake();
          });
        },
        error: (e) => {
          encodeError ??= e;
          wake();
        },
      });
      enc.configure(chosen.config);
      encoder = enc;
    };

    // Waiters (queue backpressure / cancel) are all woken through one function.
    const waiters = new Set<() => void>();
    const wake = () => {
      for (const w of [...waiters]) w();
    };
    setWake(wake);
    const waitFor = (cond: () => boolean): Promise<void> =>
      new Promise((resolve) => {
        const tryResolve = () => {
          if (cond() || isCancelled() || encodeError) {
            waiters.delete(tryResolve);
            encoder?.removeEventListener('dequeue', tryResolve);
            resolve();
          }
        };
        waiters.add(tryResolve);
        encoder?.addEventListener('dequeue', tryResolve);
        tryResolve();
      });

    await setup();
    const startedAt = performance.now();
    const interval = keyframeInterval(fps);
    const frameDurationUs = Math.round(1e6 / fps);
    let lastYield = performance.now();

    for (let i = 0; i < total; i++) {
      check();
      if (encodeError) throw encodeError;
      const enc = encoder as VideoEncoder | null;
      if (!enc) throw new Error('encoder missing');
      if (enc.encodeQueueSize > MAX_ENCODE_QUEUE) {
        await waitFor(() => (encoder as VideoEncoder).encodeQueueSize <= MAX_ENCODE_QUEUE);
        check();
        if (encodeError) throw encodeError;
      }
      await source.draw(i, i / fps);
      check();
      const frame = new VideoFrame(canvas, {
        timestamp: Math.round((i * 1e6) / fps),
        duration: frameDurationUs,
      });
      try {
        enc.encode(frame, { keyFrame: i % interval === 0 });
      } finally {
        frame.close();
      }
      const now = performance.now();
      if (now - lastYield > 25) {
        await yieldToEventLoop();
        lastYield = performance.now();
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
    const finalEnc = encoder as VideoEncoder | null;
    if (!finalEnc) throw new Error('encoder missing');
    const flushed = finalEnc.flush();
    flushed.catch(() => undefined);
    await Promise.race([flushed, waitFor(() => false)]);
    check();
    if (encodeError) throw encodeError;
    await packetChain;
    check();
    if (framesOut !== total) throw new Error(`Encoder produced ${framesOut} frames, expected ${total}`);
    const out = output as Output | null;
    if (!out) throw new Error('output missing');
    await out.finalize();
    const buffer = target.buffer;
    if (!buffer) throw new Error('Muxer produced no data');
    const blob = new Blob([buffer], { type: 'video/mp4' });
    return { type: 'done', blob, bytes: blob.size, codec, encoderPath };
  } catch (e) {
    if (output) await (output as Output).cancel().catch(() => undefined);
    throw e;
  } finally {
    setWake(null);
    const enc = encoder as VideoEncoder | null;
    if (enc && enc.state !== 'closed') enc.close();
    if (sourceInitialised) source.dispose();
  }
}
