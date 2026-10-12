import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../lib/constants';
import type { MontageSettings } from '../types';
import { trayShots } from './shots';
import type { PhotoItem } from './types';

const landscape: MontageSettings = { ...DEFAULT_SETTINGS, width: 1920, height: 1080, grouping: 'auto' };

function item(id: string, status: PhotoItem['status'], w = 800, h = 1200): PhotoItem {
  return {
    source: { id, file: new File([''], `${id}.jpg`), name: `${id}.jpg`, naturalWidth: w, naturalHeight: h },
    thumbUrl: null,
    status,
  };
}

describe('trayShots', () => {
  it('groups like the timeline: a failed photo between two portraits does not split their duo', () => {
    const shots = trayShots([item('a', 'ready'), item('x', 'error', 0, 0), item('b', 'ready')], {}, landscape);
    expect(shots[1]).toBeUndefined();
    expect(shots[0]).toMatchObject({ layout: 'duo', position: 0, size: 2, firstIndex: 0, lastIndex: 2 });
    expect(shots[2]).toMatchObject({ layout: 'duo', position: 1, size: 2, firstIndex: 0, lastIndex: 2 });
  });

  it('skips loading photos, so the first ready photo owns shot 0', () => {
    const shots = trayShots([item('x', 'loading', 0, 0), item('a', 'ready', 1200, 800)], {}, landscape);
    expect(shots[0]).toBeUndefined();
    expect(shots[1]).toMatchObject({ shotIndex: 0, position: 0, size: 1, firstIndex: 1, lastIndex: 1 });
  });
});
