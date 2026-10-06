export type ImageFormat = 'jpeg' | 'png' | 'webp' | 'avif' | 'gif' | 'heic' | 'unknown';

/** Number of leading bytes sniffFormat needs to see (ftyp compatible-brand list can be long). */
export const SNIFF_BYTES = 64;

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1']);
const AVIF_BRANDS = new Set(['avif', 'avis']);

function ascii(b: Uint8Array, start: number, len: number): string {
  let s = '';
  for (let i = start; i < start + len && i < b.length; i++) s += String.fromCharCode(b[i] ?? 0);
  return s;
}

function sniffIsoBmff(b: Uint8Array): 'heic' | 'avif' | 'unknown' {
  if (b.length < 12 || ascii(b, 4, 4) !== 'ftyp') return 'unknown';
  const boxSize = ((b[0] ?? 0) << 24) | ((b[1] ?? 0) << 16) | ((b[2] ?? 0) << 8) | (b[3] ?? 0);
  const end = Math.min(b.length, boxSize >>> 0 >= 16 ? boxSize >>> 0 : b.length);
  const major = ascii(b, 8, 4);
  const brands = [major];
  for (let o = 16; o + 4 <= end; o += 4) brands.push(ascii(b, o, 4)); // skip minor_version at 12..16
  // AVIF wins whenever it is advertised: mif1-branded AVIF files list `avif` as a compatible brand.
  if (AVIF_BRANDS.has(major) || brands.some((x) => AVIF_BRANDS.has(x))) return 'avif';
  if (brands.some((x) => HEIC_BRANDS.has(x))) return 'heic';
  return 'unknown';
}

/** Detect the image format from magic bytes (never from the file extension). */
export function sniffFormat(bytes: Uint8Array): ImageFormat {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 3) === 'PNG' && b[4] === 0x0d && b[5] === 0x0a) return 'png';
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'webp';
  if (b.length >= 6 && (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a')) return 'gif';
  return sniffIsoBmff(b);
}
