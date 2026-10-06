import { IngestError, decodeThumbnail, readPhotoSource } from '../ingest';
import type { PhotoItem } from '../ui';
import { useMontageStore } from '../ui';

const CONCURRENCY = 4;

function newId(): string {
  return crypto.randomUUID();
}

async function thumbnailUrl(file: File): Promise<string> {
  const bmp = await decodeThumbnail(file);
  try {
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    ctx.drawImage(bmp, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
    return URL.createObjectURL(blob);
  } finally {
    bmp.close();
  }
}

function messageOf(e: unknown): string {
  if (e instanceof IngestError) return e.message;
  return e instanceof Error ? e.message : 'Could not read this file.';
}

/**
 * Adds files to the store immediately (status 'loading', in selection order), then reads dimensions and
 * thumbnails with bounded concurrency. Unsupported / corrupt files end up with status 'error'.
 * The placeholder `source` object is completed in place (updatePhoto cannot replace `source`).
 */
export async function ingestFiles(files: File[]): Promise<void> {
  const store = useMontageStore;
  const items: PhotoItem[] = files.map((file) => ({
    source: { id: newId(), file, name: file.name, naturalWidth: 0, naturalHeight: 0 },
    thumbUrl: null,
    status: 'loading',
  }));
  store.getState().addPhotos(items);

  let next = 0;
  const worker = async () => {
    for (;;) {
      const item = items[next++];
      if (!item) return;
      const { id, file } = item.source;
      try {
        const info = await readPhotoSource(file, id);
        const url = await thumbnailUrl(file);
        if (!store.getState().photos.some((p) => p.source.id === id)) {
          URL.revokeObjectURL(url); // removed while loading
          continue;
        }
        store.getState().updatePhoto(id, { source: info, status: 'ready', thumbUrl: url });
      } catch (e) {
        store.getState().updatePhoto(id, { status: 'error', error: messageOf(e) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
}
