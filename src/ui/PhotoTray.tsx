import { useRef, useState } from 'react';
import type { DragEvent } from 'react';
import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useMontageStore } from './store';
import type { PhotoItem } from './types';
import { skippedFilesMessage } from './logic';
import './ui.css';

export interface PhotoTrayProps {
  onFilesSelected(files: File[]): void;
}

const IMAGE_EXT = /\.(jpe?g|png|webp|avif|gif|heic|heif)$/i;
const isImageFile = (f: File) => f.type.startsWith('image/') || IMAGE_EXT.test(f.name);

function Tile({ item, index, selected }: { item: PhotoItem; index: number; selected: boolean }) {
  const select = useMontageStore((s) => s.select);
  const removePhoto = useMontageStore((s) => s.removePhoto);
  const hasOverride = useMontageStore((s) => item.source.id in s.overrides);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: item.source.id,
  });
  const reorder = useMontageStore((s) => s.reorder);
  const name = item.source.name;
  /** Reliable one-step keyboard move when not mid-drag (dnd-kit's grid navigation can skip). */
  const onHandleKey = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (isDragging) return;
    const step = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : 0;
    if (!step) return;
    e.preventDefault();
    reorder(index, index + step);
  };
  return (
    <li
      ref={setNodeRef}
      className="mt-tile"
      data-selected={selected}
      data-dragging={isDragging}
      data-photo-id={item.source.id}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <button
        type="button"
        className="mt-tile-select"
        aria-pressed={selected}
        aria-label={`Select photo ${index + 1}: ${name}`}
        title={name}
        onClick={() => select(selected ? null : item.source.id)}
        onPointerDown={listeners?.onPointerDown as React.PointerEventHandler | undefined}
      >
        {item.thumbUrl && <img src={item.thumbUrl} alt="" draggable={false} />}
      </button>
      <span className="mt-tile-index">{index + 1}</span>
      {hasOverride && <span className="mt-tile-badge" title="Has per-photo overrides">custom</span>}
      {item.status !== 'ready' && (
        <span className="mt-tile-status" role={item.status === 'error' ? 'alert' : undefined}>
          {item.status === 'loading' ? 'Loading…' : (item.error ?? 'Failed')}
        </span>
      )}
      <span className="mt-tile-tools">
        <button
          type="button"
          ref={setActivatorNodeRef}
          className="mt-handle"
          aria-label={`Reorder photo ${index + 1} (arrow keys move it, or Space to lift)`}
          title="Drag, or focus and press arrow keys"
          {...attributes}
          {...listeners}
          onKeyDown={(e) => {
            onHandleKey(e);
            listeners?.onKeyDown?.(e);
          }}
        >
          ⠿
        </button>
        <button type="button" aria-label={`Remove photo ${index + 1}: ${name}`} title="Remove" onClick={() => removePhoto(item.source.id)}>
          ×
        </button>
      </span>
    </li>
  );
}

export function PhotoTray({ onFilesSelected }: PhotoTrayProps) {
  const photos = useMontageStore((s) => s.photos);
  const selectedId = useMontageStore((s) => s.selectedId);
  const moveById = useMontageStore((s) => s.moveById);
  const shufflePhotos = useMontageStore((s) => s.shufflePhotos);
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [announce, setAnnounce] = useState('');
  const [skipped, setSkipped] = useState<string[]>([]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const emit = (list: FileList | File[] | null) => {
    const all = Array.from(list ?? []);
    const files = all.filter(isImageFile);
    const rejected = all.filter((f) => !isImageFile(f)).map((f) => f.name);
    setSkipped(rejected);
    if (files.length) onFilesSelected(files);
  };
  const isFileDrag = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files');

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over) return;
    moveById(String(e.active.id), String(e.over.id));
    const pos = useMontageStore.getState().photos.findIndex((p) => p.source.id === String(e.active.id));
    setAnnounce(`Photo moved to position ${pos + 1} of ${photos.length}`);
  };

  return (
    <section className="mt-tray" aria-label="Photos">
      <div className="mt-tray-head">
        <h2>Photos ({photos.length})</h2>
        <button type="button" className="mt-btn" onClick={() => inputRef.current?.click()}>
          Add photos
        </button>
        <button type="button" className="mt-btn" disabled={photos.length < 2} onClick={() => shufflePhotos()}>
          Shuffle
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*,.heic,.heif"
          hidden
          data-testid="file-input"
          onChange={(e) => {
            emit(e.currentTarget.files);
            e.currentTarget.value = '';
          }}
        />
      </div>
      {skipped.length > 0 && (
        <div className="mt-skipped" role="status" data-testid="skipped-files">
          <span>{skippedFilesMessage(skipped)}</span>
          <button type="button" aria-label="Dismiss notice" title="Dismiss" data-testid="skipped-files-dismiss" onClick={() => setSkipped([])}>
            ×
          </button>
        </div>
      )}
      <div
        className="mt-drop"
        data-over={over}
        data-testid="drop-zone"
        onDragEnter={(e) => { if (isFileDrag(e)) { e.preventDefault(); setOver(true); } }}
        onDragOver={(e) => { if (isFileDrag(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setOver(true); } }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); }}
        onDrop={(e) => {
          if (!isFileDrag(e)) return;
          e.preventDefault();
          setOver(false);
          emit(e.dataTransfer.files);
        }}
      >
        {photos.length === 0 ? (
          <div className="mt-empty">Drop photos here (JPEG, PNG, WebP, AVIF, GIF, HEIC) or use Add photos.</div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={photos.map((p) => p.source.id)} strategy={rectSortingStrategy}>
              <ul className="mt-grid" aria-label="Photo order">
                {photos.map((p, i) => (
                  <Tile key={p.source.id} item={p} index={i} selected={p.source.id === selectedId} />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </div>
      <div className="mt-sr" role="status" aria-live="polite">{announce}</div>
    </section>
  );
}
