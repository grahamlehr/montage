import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../lib/constants';
import type { ExportMessage, ExportRequest } from '../types';
import type { FrameSource } from './frameSource';
import { CancelledError, runExport } from './pipeline';
import type { EncoderInit, PipelineDeps, VideoEncoderLike } from './pipeline';

const FPS = 10;
const TOTAL = 20;
const request = {
  files: [],
  photos: [],
  overrides: {},
  settings: { ...DEFAULT_SETTINGS, width: 320, height: 240, fps: FPS, totalDuration: TOTAL / FPS },
} as unknown as ExportRequest;

interface FakeFrame {
  timestamp: number;
  closed: boolean;
  close(): void;
}

function setup(
  failPlan: Array<number | null>,
  supported = ['prefer-hardware', 'no-preference', 'prefer-software'],
) {
  const frames: FakeFrame[] = [];
  const configs: string[] = [];
  const muxed: Array<{ ts: number; muxer: number }> = [];
  let muxers = 0;
  let cancelledMuxers = 0;
  let finalizedMuxers = 0;
  let encoders = 0;
  const closedEncoders: number[] = [];
  const draws: number[] = [];
  let sourceDisposed = 0;

  const source: FrameSource = {
    init: async () => undefined,
    draw: (i) => void draws.push(i),
    dispose: () => void sourceDisposed++,
  };

  const deps: Partial<PipelineDeps> = {
    createCanvas: () => ({ width: 320, height: 240 }) as unknown as OffscreenCanvas,
    createFrame: (_c, timestamp) => {
      const f: FakeFrame = { timestamp, closed: false, close: () => void (f.closed = true) };
      frames.push(f);
      return f as unknown as VideoFrame;
    },
    isConfigSupported: async (c) => ({
      supported: supported.includes(c.hardwareAcceleration ?? ''),
      config: c,
    }),
    createMuxer: () => {
      const id = muxers++;
      return {
        start: async () => undefined,
        add: async (chunk) =>
          void muxed.push({ ts: (chunk as unknown as { timestamp: number }).timestamp, muxer: id }),
        finalize: async () => {
          finalizedMuxers++;
          return new ArrayBuffer(4);
        },
        cancel: async () => void cancelledMuxers++,
      };
    },
    createEncoder: (init: EncoderInit): VideoEncoderLike => {
      const id = encoders++;
      const failAfter = failPlan[id] ?? null;
      let state = 'unconfigured';
      let n = 0;
      let dead = false;
      return {
        get state() {
          return state;
        },
        encodeQueueSize: 0,
        configure: (c) => void configs.push(c.hardwareAcceleration ?? ''),
        encode: (frame) => {
          if (dead) throw new Error('InvalidStateError');
          if (failAfter !== null && n >= failAfter) {
            dead = true;
            queueMicrotask(() => init.error(new Error(`hw encode failed (#${id})`)));
            return;
          }
          n++;
          const ts = (frame as unknown as FakeFrame).timestamp;
          init.output({ timestamp: ts } as unknown as EncodedVideoChunk);
        },
        flush: () => (dead ? Promise.reject(new Error('flush failed')) : Promise.resolve()),
        close: () => {
          state = 'closed';
          closedEncoders.push(id);
        },
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      };
    },
  };
  return {
    source,
    deps,
    frames,
    configs,
    muxed,
    draws,
    stats: () => ({ muxers, cancelledMuxers, finalizedMuxers, encoders, closedEncoders, sourceDisposed }),
  };
}

describe('runExport encoder fallback', () => {
  it('normal export uses the first preference', async () => {
    const t = setup([null]);
    const msgs: ExportMessage[] = [];
    const { result } = runExport(request, t.source, (m) => msgs.push(m), t.deps);
    const done = await result;
    expect(done.encoderPath).toBe('hardware');
    expect(t.configs).toEqual(['prefer-hardware']);
    expect(t.muxed).toHaveLength(TOTAL);
    expect(t.frames.every((f) => f.closed)).toBe(true);
    expect(t.stats().sourceDisposed).toBe(1);
  });

  it('restarts from frame 0 with the next preference when the encoder errors mid-stream', async () => {
    const t = setup([7, null]);
    const msgs: ExportMessage[] = [];
    const { result } = runExport(request, t.source, (m) => msgs.push(m), t.deps);
    const done = await result;
    expect(t.configs).toEqual(['prefer-hardware', 'no-preference']);
    // no-preference is labelled hardware because prefer-hardware was supported for the config
    expect(done.encoderPath).toBe('hardware');
    const second = t.muxed.filter((m) => m.muxer === 1).map((m) => m.ts);
    expect(second).toHaveLength(TOTAL);
    expect(second).toEqual(Array.from({ length: TOTAL }, (_, i) => Math.round((i * 1e6) / FPS)));
    const st = t.stats();
    expect(st.cancelledMuxers).toBe(1);
    expect(st.finalizedMuxers).toBe(1);
    expect(st.closedEncoders.sort()).toEqual([0, 1]);
    expect(t.draws.filter((i) => i === 0)).toHaveLength(2); // frame 0 redrawn
    expect(t.frames.every((f) => f.closed)).toBe(true);
    expect(st.sourceDisposed).toBe(1);
    // progress restarts at zero
    const encoding = msgs.filter((m) => m.type === 'progress' && m.phase === 'encoding');
    expect(encoding.filter((m) => m.type === 'progress' && m.done === 0).length).toBe(2);
  });

  it('falls through all three preferences, then succeeds with prefer-software', async () => {
    const t = setup([3, 5, null]);
    const done = await runExport(request, t.source, () => undefined, t.deps).result;
    expect(t.configs).toEqual(['prefer-hardware', 'no-preference', 'prefer-software']);
    expect(done.encoderPath).toBe('software');
    expect(t.muxed.filter((m) => m.muxer === 2)).toHaveLength(TOTAL);
    expect(t.frames.every((f) => f.closed)).toBe(true);
  });

  it('fails with the encoder message once all preferences are exhausted', async () => {
    const t = setup([2, 2, 2]);
    await expect(runExport(request, t.source, () => undefined, t.deps).result).rejects.toThrow(
      /Video encoder failed: hw encode failed \(#2\)/,
    );
    const st = t.stats();
    expect(st.encoders).toBe(3);
    expect(st.cancelledMuxers).toBe(3);
    expect(st.finalizedMuxers).toBe(0);
    expect(t.frames.every((f) => f.closed)).toBe(true);
    expect(st.sourceDisposed).toBe(1);
  });

  it('skips unsupported preferences when retrying', async () => {
    const t = setup([4, null], ['prefer-hardware', 'prefer-software']);
    await runExport(request, t.source, () => undefined, t.deps).result;
    expect(t.configs).toEqual(['prefer-hardware', 'prefer-software']);
  });

  it('cancel during a retry rejects with CancelledError and cleans up', async () => {
    const t = setup([5, null]);
    let handle: { cancel(): void } | null = null;
    let attempts = 0;
    const run = runExport(
      request,
      t.source,
      (m) => {
        if (m.type === 'progress' && m.phase === 'encoding' && m.done === 0 && ++attempts === 2)
          handle?.cancel();
      },
      t.deps,
    );
    handle = run.handle;
    await expect(run.result).rejects.toBeInstanceOf(CancelledError);
    const st = t.stats();
    expect(st.finalizedMuxers).toBe(0);
    expect(st.cancelledMuxers).toBe(2);
    expect(st.closedEncoders.sort()).toEqual([0, 1]);
    expect(t.frames.every((f) => f.closed)).toBe(true);
    expect(st.sourceDisposed).toBe(1);
  });
});
