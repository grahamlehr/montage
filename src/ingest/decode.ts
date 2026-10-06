import type { PhotoSource } from '../types';
import { IngestError } from './errors';
import { fitWithin, THUMB_BOX } from './size';
import { sniffFormat, SNIFF_BYTES, type ImageFormat } from './sniff';

export interface DecodeOptions {
  maxW: number;
  maxH: number;
  /** Testing hook: 'wasm' skips native HEIC decoding. Default 'auto' (native first, WASM fallback). */
  heic?: 'auto' | 'wasm';
}

async function sniffBlob(blob: Blob): Promise<ImageFormat> {
  const head = new Uint8Array(await blob.slice(0, SNIFF_BYTES).arrayBuffer());
  return sniffFormat(head);
}

async function decodeHeicWasm(blob: Blob): Promise<ImageBitmap> {
  // Lazy: the libheif WASM (inlined in the module) is only fetched when a HEIC needs it.
  // `heic-to/next` uses OffscreenCanvas, so it works in Workers and on the main thread.
  const { heicTo } = await import('heic-to/next');
  // libheif applies HEIC rotation/mirroring itself, so the bitmap is already upright.
  return heicTo({ blob, type: 'bitmap' });
}

/** Full-size, upright bitmap. */
async function decodeUpright(blob: Blob, heic: 'auto' | 'wasm'): Promise<ImageBitmap> {
  const format = await sniffBlob(blob);
  if (format === 'unknown') {
    throw new IngestError('unsupported', 'This file is not a supported image (JPEG, PNG, WebP, AVIF, GIF or HEIC).');
  }
  if (format === 'heic') {
    if (heic === 'auto') {
      try {
        return await createImageBitmap(blob, { imageOrientation: 'from-image' });
      } catch {
        /* no native HEIC support: fall through to WASM */
      }
    }
    try {
      return await decodeHeicWasm(blob);
    } catch (cause) {
      throw new IngestError('decode-failed', 'Could not decode this HEIC image.', { cause });
    }
  }
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch (cause) {
    throw new IngestError('decode-failed', 'Could not decode this image (it may be corrupt).', { cause });
  }
}

async function decodeFit(blob: Blob, maxW: number, maxH: number, heic: 'auto' | 'wasm'): Promise<ImageBitmap> {
  if (!(maxW >= 1) || !(maxH >= 1)) throw new IngestError('invalid-size', 'maxW and maxH must be >= 1');
  const full = await decodeUpright(blob, heic);
  const target = fitWithin({ width: full.width, height: full.height }, maxW, maxH);
  if (target.width === full.width && target.height === full.height) return full;
  try {
    // Resizing from the already-upright bitmap avoids any ambiguity about whether resizeWidth/Height
    // apply before or after EXIF rotation.
    return await createImageBitmap(full, {
      resizeWidth: target.width,
      resizeHeight: target.height,
      resizeQuality: 'high',
    });
  } catch (cause) {
    throw new IngestError('decode-failed', 'Could not resize this image.', { cause });
  } finally {
    full.close();
  }
}

/**
 * Decode `file` upright (EXIF applied) and scaled to fit within maxW×maxH, preserving aspect, never
 * upscaling. Caller owns the returned ImageBitmap and must close() it. Worker-safe.
 */
export function decodePhoto(file: Blob, opts: DecodeOptions): Promise<ImageBitmap> {
  return decodeFit(file, opts.maxW, opts.maxH, opts.heic ?? 'auto');
}

/** 256 px long-edge thumbnail (upright). Caller must close() it. */
export function decodeThumbnail(file: Blob): Promise<ImageBitmap> {
  return decodeFit(file, THUMB_BOX.maxW, THUMB_BOX.maxH, 'auto');
}

let idCounter = 0;
function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `photo-${++idCounter}`;
}

/** Read name and upright dimensions (after EXIF orientation). Throws IngestError for non-images. */
export async function readPhotoSource(file: File, id?: string): Promise<PhotoSource> {
  const bmp = await decodeUpright(file, 'auto');
  const naturalWidth = bmp.width;
  const naturalHeight = bmp.height;
  bmp.close();
  return { id: id ?? newId(), file, name: file.name, naturalWidth, naturalHeight };
}
