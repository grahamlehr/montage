import { create } from 'zustand';
import { DEFAULT_SETTINGS } from '../lib/constants';
import { newSeed } from '../lib/rng';
import type { MontageSettings, PhotoOverrides } from '../types';
import {
  applySettingsPatch, arrayMove, dimsForRatio, mergeOverride, parseRatio, shuffleItems, togglePool,
} from './logic';
import type { DimensionPreset, PhotoItem } from './types';

export interface MontageState {
  photos: PhotoItem[];
  overrides: Record<string, PhotoOverrides>;
  settings: MontageSettings;
  selectedId: string | null;
  aspectLocked: boolean;

  addPhotos(items: PhotoItem[]): void;
  /** Patch a photo (e.g. loading -> ready with thumbUrl). */
  updatePhoto(id: string, patch: Partial<Omit<PhotoItem, 'source'>>): void;
  removePhoto(id: string): void;
  reorder(fromIndex: number, toIndex: number): void;
  moveById(activeId: string, overId: string): void;
  shufflePhotos(seed?: number): void;
  setSettings(partial: Partial<MontageSettings>): void;
  setAspectLocked(locked: boolean): void;
  /** Returns false (and changes nothing) if the text isn't a valid ratio. */
  setRatio(text: string): boolean;
  applyPreset(preset: Pick<DimensionPreset, 'width' | 'height'>): void;
  toggleMotion(style: MontageSettings['motionPool'][number]): void;
  toggleTransition(style: MontageSettings['transitionPool'][number]): void;
  /** Merge a patch; `undefined` value removes that key; passing `undefined` clears all overrides. */
  setOverride(id: string, partial: Partial<Record<keyof PhotoOverrides, PhotoOverrides[keyof PhotoOverrides] | undefined>> | undefined): void;
  clearOverride(id: string): void;
  select(id: string | null): void;
  randomiseSeed(): void;
}

export const useMontageStore = create<MontageState>()((set, get) => ({
  photos: [],
  overrides: {},
  settings: { ...DEFAULT_SETTINGS, width: 1080, height: 1920 },
  selectedId: null,
  aspectLocked: false,

  addPhotos: (items) => set((s) => ({ photos: [...s.photos, ...items.filter((i) => !s.photos.some((p) => p.source.id === i.source.id))] })),
  updatePhoto: (id, patch) =>
    set((s) => ({ photos: s.photos.map((p) => (p.source.id === id ? { ...p, ...patch } : p)) })),
  removePhoto: (id) =>
    set((s) => {
      const gone = s.photos.find((p) => p.source.id === id);
      if (gone?.thumbUrl?.startsWith('blob:')) URL.revokeObjectURL(gone.thumbUrl);
      const overrides = { ...s.overrides };
      delete overrides[id];
      return {
        photos: s.photos.filter((p) => p.source.id !== id),
        overrides,
        selectedId: s.selectedId === id ? null : s.selectedId,
      };
    }),
  reorder: (from, to) => set((s) => ({ photos: arrayMove(s.photos, from, to) })),
  moveById: (activeId, overId) => {
    const { photos } = get();
    const from = photos.findIndex((p) => p.source.id === activeId);
    const to = photos.findIndex((p) => p.source.id === overId);
    if (from >= 0 && to >= 0 && from !== to) set({ photos: arrayMove(photos, from, to) });
  },
  shufflePhotos: (seed) => set((s) => ({ photos: shuffleItems(s.photos, seed ?? newSeed()) })),
  setSettings: (partial) =>
    set((s) => ({ settings: applySettingsPatch(s.settings, partial, s.aspectLocked) })),
  setAspectLocked: (aspectLocked) => set({ aspectLocked }),
  setRatio: (text) => {
    const r = parseRatio(text);
    if (!r) return false;
    set((s) => ({ settings: { ...s.settings, ...dimsForRatio(s.settings.width, r.w, r.h) } }));
    return true;
  },
  applyPreset: (p) => set((s) => ({ settings: applySettingsPatch(s.settings, { width: p.width, height: p.height }, false) })),
  toggleMotion: (style) =>
    set((s) => ({ settings: applySettingsPatch(s.settings, { motionPool: togglePool(s.settings.motionPool, style) }, false) })),
  toggleTransition: (style) =>
    set((s) => ({ settings: applySettingsPatch(s.settings, { transitionPool: togglePool(s.settings.transitionPool, style) }, false) })),
  setOverride: (id, partial) =>
    set((s) => {
      const overrides = { ...s.overrides };
      const merged = partial ? mergeOverride(s.overrides[id], partial) : undefined;
      if (merged) overrides[id] = merged;
      else delete overrides[id];
      return { overrides };
    }),
  clearOverride: (id) => get().setOverride(id, undefined),
  select: (selectedId) => set({ selectedId }),
  randomiseSeed: () => set((s) => ({ settings: { ...s.settings, seed: newSeed() } })),
}));
