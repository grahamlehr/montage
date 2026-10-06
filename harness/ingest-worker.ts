import { decodePhoto, decodeSizeFor, decodeThumbnail, IngestError, readPhotoSource } from '../src/ingest';
import { probeBitmap, type CaseResult } from './ingest-probe';

export interface WorkerRequest {
  name: string;
  blob: Blob;
  output: { width: number; height: number };
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { name, blob, output } = e.data;
  const res: CaseResult = { name, context: 'worker' };
  try {
    const src = await readPhotoSource(new File([blob], name));
    res.natural = { w: src.naturalWidth, h: src.naturalHeight };
    const box = decodeSizeFor(output, { width: src.naturalWidth, height: src.naturalHeight });
    const bmp = await decodePhoto(blob, box);
    res.decoded = probeBitmap(bmp);
    bmp.close();
    if (name.endsWith('.heic')) {
      const w = await decodePhoto(blob, { ...box, heic: 'wasm' });
      const pr = probeBitmap(w);
      w.close();
      if (pr.w !== res.decoded.w || pr.h !== res.decoded.h) throw new Error(`wasm size mismatch ${pr.w}x${pr.h}`);
      if (name.startsWith('exif') && !(pr.top[0] > pr.bottom[0] + 60)) throw new Error('wasm not upright in worker');
    }
    const th = await decodeThumbnail(blob);
    res.thumb = probeBitmap(th, true);
    const thumbBitmap = th; // transferred to main for display
    (self as unknown as Worker).postMessage({ res, thumbBitmap }, [thumbBitmap]);
    return;
  } catch (err) {
    res.error = { code: err instanceof IngestError ? err.code : 'other', message: String(err) };
  }
  (self as unknown as Worker).postMessage({ res });
};
