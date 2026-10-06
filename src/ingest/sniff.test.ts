import { describe, expect, it } from 'vitest';
import { sniffFormat } from './sniff';

const bytes = (...p: (number | string)[]) =>
  Uint8Array.from(p.flatMap((x) => (typeof x === 'string' ? [...x].map((c) => c.charCodeAt(0)) : [x])));
const ftyp = (major: string, ...compat: string[]) => {
  const size = 16 + compat.length * 4;
  return bytes(0, 0, 0, size, 'ftyp', major, 0, 0, 0, 0, ...compat);
};

describe('sniffFormat', () => {
  it('detects common formats', () => {
    expect(sniffFormat(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('jpeg');
    expect(sniffFormat(bytes(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a))).toBe('png');
    expect(sniffFormat(bytes('RIFF', 1, 2, 3, 4, 'WEBP'))).toBe('webp');
    expect(sniffFormat(bytes('GIF89a'))).toBe('gif');
  });
  it('detects HEIC brands', () => {
    for (const b of ['heic', 'heix', 'hevc', 'msf1']) expect(sniffFormat(ftyp(b, 'mif1'))).toBe('heic');
    expect(sniffFormat(ftyp('mif1', 'heic'))).toBe('heic');
    expect(sniffFormat(ftyp('mif1'))).toBe('heic');
  });
  it('distinguishes AVIF, including mif1-branded AVIF', () => {
    expect(sniffFormat(ftyp('avif', 'mif1', 'miaf'))).toBe('avif');
    expect(sniffFormat(ftyp('avis'))).toBe('avif');
    expect(sniffFormat(ftyp('mif1', 'miaf', 'avif'))).toBe('avif');
  });
  it('returns unknown for other data', () => {
    expect(sniffFormat(new Uint8Array())).toBe('unknown');
    expect(sniffFormat(bytes('hello world, text'))).toBe('unknown');
    expect(sniffFormat(ftyp('isom', 'mp41'))).toBe('unknown');
  });
});
