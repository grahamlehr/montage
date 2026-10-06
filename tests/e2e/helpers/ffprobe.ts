import { execFileSync } from 'node:child_process';
import { expect } from '@playwright/test';

export interface FfprobeStream {
  codec_name: string;
  width: number;
  height: number;
  nb_read_frames: number;
  avg_frame_rate: string;
}
export interface FfprobeResult {
  streamCount: number;
  stream: FfprobeStream;
  duration: number;
}

/** Probe the first video stream (frames counted by decoding) plus the container duration and total stream count. */
export function ffprobe(file: string): FfprobeResult {
  const run = (args: string[]): unknown =>
    JSON.parse(
      execFileSync('ffprobe', ['-v', 'error', ...args, '-of', 'json', file], {
        encoding: 'utf8',
        maxBuffer: 64 << 20,
      }),
    );
  const v = run([
    '-select_streams',
    'v:0',
    '-count_frames',
    '-show_entries',
    'stream=codec_name,width,height,nb_read_frames,avg_frame_rate:format=duration',
  ]) as { streams: Array<Record<string, string | number>>; format: { duration: string } };
  const all = run(['-show_entries', 'stream=index']) as { streams: unknown[] };
  const s = v.streams[0];
  if (!s) throw new Error('ffprobe: no video stream');
  return {
    streamCount: all.streams.length,
    duration: Number(v.format.duration),
    stream: {
      codec_name: String(s.codec_name),
      width: Number(s.width),
      height: Number(s.height),
      nb_read_frames: Number(s.nb_read_frames),
      avg_frame_rate: String(s.avg_frame_rate),
    },
  };
}

export interface Expected {
  width: number;
  height: number;
  fps: number;
  seconds: number;
}

/** Assert h264, exact dims, frame count = round(L*fps), duration within 1/fps, single (video-only) stream. */
export function assertMontage(file: string, e: Expected): FfprobeResult {
  const r = ffprobe(file);
  expect(r.stream.codec_name).toBe('h264');
  expect(r.stream.width).toBe(e.width);
  expect(r.stream.height).toBe(e.height);
  expect(r.stream.nb_read_frames).toBe(Math.round(e.seconds * e.fps));
  expect(Math.abs(r.duration - e.seconds)).toBeLessThanOrEqual(1 / e.fps + 1e-6);
  expect(r.streamCount).toBe(1);
  return r;
}
