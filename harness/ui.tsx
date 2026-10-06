import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PerPhotoInspector, PhotoTray, SettingsPanel, useMontageStore } from '../src/ui';
import type { PhotoItem } from '../src/ui';

function tile(w: number, h: number, hue: number, label: string): string {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (g) {
    const grad = g.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, `hsl(${hue} 70% 55%)`);
    grad.addColorStop(1, `hsl(${(hue + 60) % 360} 70% 30%)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff';
    g.font = `bold ${Math.round(Math.min(w, h) / 3)}px sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, w / 2, h / 2);
  }
  return c.toDataURL('image/png');
}

function mockItems(startAt: number, count: number): PhotoItem[] {
  return Array.from({ length: count }, (_, k) => {
    const n = startAt + k;
    const portrait = n % 3 !== 0;
    const w = portrait ? 192 : 256;
    const h = portrait ? 256 : 160;
    const file = new File([''], `mock-${n}.jpg`, { type: 'image/jpeg' });
    return {
      source: { id: `p${n}`, file, name: file.name, naturalWidth: w * 10, naturalHeight: h * 10 },
      thumbUrl: tile(w, h, (n * 47) % 360, String(n + 1)),
      status: n === 6 ? 'loading' : 'ready',
    } satisfies PhotoItem;
  });
}

function Harness() {
  const [added, setAdded] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const addPhotos = useMontageStore((s) => s.addPhotos);
  const state = useMontageStore((s) => s);
  const json = JSON.stringify(
    {
      photos: state.photos.map((p) => `${p.source.id}:${p.status}`),
      overrides: state.overrides,
      settings: state.settings,
      selectedId: state.selectedId,
      aspectLocked: state.aspectLocked,
      filesSelectedLog: log,
    },
    null,
    2,
  );
  return (
    <>
      <div className="col">
        <PhotoTray
          onFilesSelected={(files) => setLog((l) => [...l, ...files.map((f) => f.name)])}
        />
        <button type="button" data-testid="add-mock" onClick={() => { addPhotos(mockItems(added, 8)); setAdded(added + 8); }}>
          Add 8 mock photos
        </button>
        <PerPhotoInspector />
      </div>
      <SettingsPanel />
      <pre data-testid="store-json">{json}</pre>
    </>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
