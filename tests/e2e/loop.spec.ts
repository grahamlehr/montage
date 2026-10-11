import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { assertMontage } from './helpers/ffprobe.js';
import { exportAndDownload, openApp, set50, setSettings, upload } from './helpers/app.js';

const loopSetting = (page: Page): Promise<boolean> =>
  page.evaluate(
    () =>
      (window as unknown as { __montage: { store: { getState(): { settings: { loop: boolean } } } } }).__montage.store.getState()
        .settings.loop,
  );

const W = 640;
const H = 360;
const FPS = 25;
const SECONDS = 4;
const FRAMES = FPS * SECONDS;
const FRAME_BYTES = W * H * 3;

/** Decode `file` (optionally looped `loops` extra times via -stream_loop) to raw rgb24 frames. */
function decode(file: string, extraLoops = 0): Buffer {
  return execFileSync(
    'ffmpeg',
    ['-v', 'error', '-stream_loop', String(extraLoops), '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    { maxBuffer: 1 << 30 },
  );
}

/** Mean absolute per-byte difference (0..255) between frames a and b of a raw buffer. */
function diff(buf: Buffer, a: number, b: number): number {
  let sum = 0;
  const oa = a * FRAME_BYTES;
  const ob = b * FRAME_BYTES;
  for (let i = 0; i < FRAME_BYTES; i++) sum += Math.abs((buf[oa + i] as number) - (buf[ob + i] as number));
  return sum / FRAME_BYTES;
}

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number;

test('seamless loop: the MP4 flows from its last frame back into its first; loop off hard-jumps', async ({ page }) => {
  test.setTimeout(8 * 60_000);
  await openApp(page);
  await upload(page, set50(4));
  await setSettings(page, {
    width: W,
    height: H,
    fps: FPS,
    totalDuration: SECONDS,
    transitionPool: ['crossfade'],
    selection: 'sequence',
  });

  // The Loop checkbox is bound to settings.loop (default on).
  const toggle = page.getByTestId('loop-toggle');
  await expect(toggle).toBeChecked();
  expect(await loopSetting(page)).toBe(true);
  await expect(page.getByTestId('export-button')).toBeEnabled();

  const on = await exportAndDownload(page, 4 * 60_000);
  assertMontage(on.file, { width: W, height: H, fps: FPS, seconds: SECONDS });

  await toggle.uncheck();
  expect(await loopSetting(page)).toBe(false);
  await expect(page.getByTestId('export-button')).toBeEnabled();
  const off = await exportAndDownload(page, 4 * 60_000);
  assertMontage(off.file, { width: W, height: H, fps: FPS, seconds: SECONDS });

  // One pass each: consecutive-frame differences.
  const onFrames = decode(on.file);
  const offFrames = decode(off.file);
  expect(onFrames.length).toBe(FRAMES * FRAME_BYTES);
  expect(offFrames.length).toBe(FRAMES * FRAME_BYTES);
  const steps = (buf: Buffer) => Array.from({ length: FRAMES - 1 }, (_, i) => diff(buf, i, i + 1));
  const onTypical = median(steps(onFrames));
  const offTypical = median(steps(offFrames));

  // First vs last frame. With loop on, the last frame is one frame before the seam: very close to frame 0
  // but not identical; with loop off the video ends on a different photo entirely.
  const onFirstLast = diff(onFrames, 0, FRAMES - 1);
  const offFirstLast = diff(offFrames, 0, FRAMES - 1);
  // Loop-on frame 0 is identical in content to loop-off frame 0 (photo 0 at t = 0), compare last-on to that too.
  const onLastVsOffFirst = diff(Buffer.concat([onFrames.subarray((FRAMES - 1) * FRAME_BYTES), offFrames.subarray(0, FRAME_BYTES)]), 0, 1);

  // Play the file twice back to back (what a looping player does) and measure the jump at the seam.
  const onLooped = decode(on.file, 1);
  const offLooped = decode(off.file, 1);
  expect(onLooped.length).toBe(2 * FRAMES * FRAME_BYTES);
  const onSeam = diff(onLooped, FRAMES - 1, FRAMES);
  const offSeam = diff(offLooped, FRAMES - 1, FRAMES);

  console.log(
    'loop seam numbers',
    JSON.stringify({ onTypical, offTypical, onFirstLast, offFirstLast, onLastVsOffFirst, onSeam, offSeam }),
  );

  expect(onFirstLast).toBeGreaterThan(0); // one frame before the seam, not a duplicate
  expect(onFirstLast).toBeLessThan(offFirstLast / 3);
  expect(onLastVsOffFirst).toBeLessThan(offFirstLast / 3);
  // The seam is no bigger than an ordinary frame-to-frame step ...
  expect(onSeam).toBeLessThanOrEqual(Math.max(onTypical * 1.5, onTypical + 1));
  // ... while without the wrap transition the same jump is far larger than anything else.
  expect(offSeam).toBeGreaterThan(Math.max(offTypical * 4, 8));
  expect(offSeam).toBeGreaterThan(onSeam * 4);
});
