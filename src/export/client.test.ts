import { describe, expect, it, vi } from 'vitest';
import type { ExportMessage, ExportRequest } from '../types';
import { startExport } from './client';

function fakeWorker() {
  const w = {
    onmessage: null as ((e: MessageEvent<ExportMessage>) => void) | null,
    onerror: null as ((e: ErrorEvent) => void) | null,
    onmessageerror: null as ((e: MessageEvent) => void) | null,
    postMessage: vi.fn(),
    terminate: vi.fn(),
  };
  return w;
}

const request = {} as ExportRequest;

describe('startExport', () => {
  it('resolves done with the terminal message and terminates the worker', async () => {
    const w = fakeWorker();
    const seen: ExportMessage[] = [];
    const h = startExport(request, (m) => seen.push(m), () => w as unknown as Worker);
    const done: ExportMessage = { type: 'done', blob: new Blob(['x']) } as ExportMessage;
    w.onmessage?.({ data: done } as MessageEvent<ExportMessage>);
    await expect(h.done).resolves.toBe(done);
    expect(w.terminate).toHaveBeenCalled();
    expect(seen).toEqual([done]);
  });

  it('treats an unreadable worker message as an export error', async () => {
    const w = fakeWorker();
    const seen: ExportMessage[] = [];
    const h = startExport(request, (m) => seen.push(m), () => w as unknown as Worker);
    w.onmessageerror?.({} as MessageEvent);
    const m = await h.done;
    expect(m.type).toBe('error');
    expect(seen[0]?.type).toBe('error');
    expect(w.terminate).toHaveBeenCalled();
  });
});
