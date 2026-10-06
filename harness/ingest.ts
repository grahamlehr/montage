import { decodePhoto, decodeSizeFor, decodeThumbnail, IngestError, readPhotoSource, sniffFormat } from '../src/ingest';
import { probeBitmap, type CaseResult } from './ingest-probe';
import type { WorkerRequest } from './ingest-worker';

const OUTPUT = { width: 1080, height: 1920 };
const files = [
  'landscape.jpg', 'portrait.jpg', 'exif-rotated.jpg', 'exif-rotated.heic', 'image.heic', 'portrait.heic',
  'panorama.jpg', 'tiny.png', 'image.png', 'image.webp', 'image.avif', 'image.gif', 'not-an-image.txt', 'fake.jpg',
];
// Expected upright (width, height) after orientation; null = must throw `unsupported`.
const expected: Record<string, [number, number] | null> = {
  'landscape.jpg': [2400, 1600], 'portrait.jpg': [1600, 2400], 'exif-rotated.jpg': [1600, 2400],
  'exif-rotated.heic': [1600, 2400], 'image.heic': [2400, 1600], 'portrait.heic': [1600, 2400],
  'panorama.jpg': [6000, 1200], 'tiny.png': [64, 48], 'image.png': [1200, 800], 'image.webp': [2400, 1600],
  'image.avif': [1600, 1200], 'image.gif': [480, 360], 'not-an-image.txt': null, 'fake.jpg': null,
};

const out = document.getElementById('out') as HTMLTableElement;
const summary = document.getElementById('summary')!;
const results: CaseResult[] = [];
const failures: string[] = [];

function check(r: CaseResult) {
  const exp = expected[r.name];
  const tag = `${r.context}:${r.name}`;
  if (exp === null) {
    if (r.error?.code !== 'unsupported') failures.push(`${tag}: expected unsupported, got ${JSON.stringify(r.error ?? r.decoded)}`);
    return;
  }
  if (exp === undefined) return;
  if (r.error) return void failures.push(`${tag}: ${r.error.message}`);
  if (r.natural?.w !== exp[0] || r.natural.h !== exp[1]) failures.push(`${tag}: natural ${JSON.stringify(r.natural)} != ${exp}`);
  const d = r.decoded!;
  const aspect = (exp[0] / exp[1]) / (d.w / d.h);
  if (Math.abs(aspect - 1) > 0.01) failures.push(`${tag}: decoded aspect off (${d.w}x${d.h})`);
  if (d.w > exp[0] || d.h > exp[1]) failures.push(`${tag}: upscaled`);
  const t = r.thumb!;
  if (Math.max(t.w, t.h) !== Math.min(256, Math.max(exp[0], exp[1]))) failures.push(`${tag}: thumb ${t.w}x${t.h}`);
  if (r.name.startsWith('exif-rotated')) {
    // Upright arrow image: top is purple (#9b5de5 -> red ~155), bottom teal (red ~0).
    if (!(d.top[0] > d.bottom[0] + 60)) failures.push(`${tag}: not upright (top ${d.top}, bottom ${d.bottom})`);
  }
}

function addRow(r: CaseResult, thumb?: ImageBitmap) {
  results.push(r);
  check(r);
  const tr = out.insertRow();
  tr.insertCell().textContent = r.context;
  tr.insertCell().textContent = r.name;
  tr.insertCell().textContent = r.natural ? `${r.natural.w}x${r.natural.h}` : '-';
  tr.insertCell().textContent = r.decoded ? `${r.decoded.w}x${r.decoded.h}` : '-';
  tr.insertCell().textContent = r.thumb ? `${r.thumb.w}x${r.thumb.h}` : '-';
  tr.insertCell().textContent = r.error ? `${r.error.code}` : 'ok';
  const cell = tr.insertCell();
  if (thumb) {
    const c = document.createElement('canvas');
    c.width = thumb.width; c.height = thumb.height;
    c.getContext('2d')!.drawImage(thumb, 0, 0);
    cell.appendChild(c);
    thumb.close();
  }
}

async function mainCase(name: string, blob: Blob) {
  const r: CaseResult = { name, context: 'main' };
  let thumb: ImageBitmap | undefined;
  try {
    const src = await readPhotoSource(new File([blob], name));
    r.natural = { w: src.naturalWidth, h: src.naturalHeight };
    const bmp = await decodePhoto(blob, decodeSizeFor(OUTPUT, { width: src.naturalWidth, height: src.naturalHeight }));
    r.decoded = probeBitmap(bmp);
    bmp.close();
    thumb = await decodeThumbnail(blob);
    r.thumb = probeBitmap(thumb);
  } catch (e) {
    r.error = { code: e instanceof IngestError ? e.code : 'other', message: String(e) };
  }
  addRow(r, thumb);
}

function workerCase(worker: Worker, name: string, blob: Blob) {
  return new Promise<void>((resolve) => {
    worker.onmessage = (e: MessageEvent<{ res: CaseResult; thumbBitmap?: ImageBitmap }>) => {
      addRow(e.data.res, e.data.thumbBitmap);
      resolve();
    };
    const req: WorkerRequest = { name, blob, output: OUTPUT };
    worker.postMessage(req);
  });
}

async function extra() {
  // Forced WASM HEIC path (main thread) must also give an upright result.
  for (const name of ['exif-rotated.heic', 'image.heic']) {
    const blob = await (await fetch(`/fixtures/${name}`)).blob();
    const bmp = await decodePhoto(blob, { maxW: 4000, maxH: 4000, heic: 'wasm' });
    const p = probeBitmap(bmp);
    bmp.close();
    const exp = expected[name]!;
    if (p.w !== exp[0] || p.h !== exp[1]) failures.push(`wasm:${name}: ${p.w}x${p.h}`);
    if (name.startsWith('exif') && !(p.top[0] > p.bottom[0] + 60)) failures.push(`wasm:${name}: not upright`);
  }
  // Truncated JPEG -> decode-failed.
  const jpg = await (await fetch('/fixtures/landscape.jpg')).blob();
  try {
    await decodePhoto(jpg.slice(0, 2000), { maxW: 100, maxH: 100 });
    failures.push('truncated jpeg: no error');
  } catch (e) {
    if (!(e instanceof IngestError) || e.code !== 'decode-failed') failures.push(`truncated jpeg: ${String(e)}`);
  }
  // sniff on real bytes
  const heic = new Uint8Array(await (await fetch('/fixtures/image.heic')).arrayBuffer());
  const avif = new Uint8Array(await (await fetch('/fixtures/image.avif')).arrayBuffer());
  if (sniffFormat(heic) !== 'heic') failures.push('sniff heic fixture');
  if (sniffFormat(avif) !== 'avif') failures.push('sniff avif fixture');
}

async function set50() {
  const worker = new Worker(new URL('./ingest-worker.ts', import.meta.url), { type: 'module' });
  let n = 0;
  for (let i = 1; i <= 50; i++) {
    const nn = String(i).padStart(2, '0');
    for (const ext of ['jpg', 'heic']) {
      const res = await fetch(`/fixtures/set50/photo-${nn}.${ext}`);
      if (!res.ok || res.headers.get('content-type')?.startsWith('text/html')) continue;
      const blob = await res.blob();
      const src = await readPhotoSource(new File([blob], `photo-${nn}.${ext}`));
      const portrait = i % 3 === 0;
      if (src.naturalHeight > src.naturalWidth !== portrait) failures.push(`set50 ${nn}: orientation`);
      const bmp = await decodeThumbnail(blob);
      bmp.close();
      n++;
    }
  }
  worker.terminate();
  return n;
}

async function run() {
  const worker = new Worker(new URL('./ingest-worker.ts', import.meta.url), { type: 'module' });
  for (const name of files) {
    const blob = await (await fetch(`/fixtures/${name}`)).blob();
    await mainCase(name, blob);
    await workerCase(worker, name, blob);
  }
  worker.terminate();
  await extra();
  const n = await set50();
  const done = { failures, results, set50Count: n };
  (window as unknown as { __ingest: unknown }).__ingest = done;
  summary.innerHTML = failures.length
    ? `<span class="bad">FAIL (${failures.length})</span><pre>${failures.join('\n')}</pre>`
    : `<span class="ok">PASS</span> (${results.length} cases, ${n} set50 photos)`;
  (window as unknown as { __ingestDone: boolean }).__ingestDone = true;
}
run().catch((e) => {
  failures.push(`fatal: ${String(e)}`);
  (window as unknown as { __ingest: unknown }).__ingest = { failures, results };
  (window as unknown as { __ingestDone: boolean }).__ingestDone = true;
  summary.textContent = `FATAL ${String(e)}`;
});
