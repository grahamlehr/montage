import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { markTourSeen } from './visitorPrefs';

interface Step {
  /** `data-tour` value of the element to spotlight; absent = a centred card. */
  target?: string;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    title: 'Welcome to Montage',
    body: 'Turn a set of photos into an MP4 video, right here in your browser. Nothing is uploaded: your photos never leave this computer. Here’s a 30-second tour.',
  },
  {
    target: 'photos',
    title: '1. Add your photos',
    body: 'Drop photos here or click to choose them. Drag tiles to change the order, and select a tile to adjust that photo on its own.',
  },
  {
    target: 'preview',
    title: '2. Watch the preview',
    body: 'Your montage plays here. Press Play, or drag the scrubber to jump to any moment.',
  },
  {
    target: 'settings',
    title: '3. Choose your settings',
    body: 'Pick the video size, length, pacing, motion and transition styles, and layouts.',
  },
  {
    target: 'rebuild',
    title: '4. Rebuild to apply',
    body: 'Setting changes wait until you press Rebuild (or ⌘/Ctrl + Enter), so you can change several things and then see them all at once.',
  },
  {
    target: 'export',
    title: '5. Export your video',
    body: 'When it looks right, Export renders a full-quality MP4 and downloads it.',
  },
];

const CARD_W = 340;
const GAP = 14;
const PAD = 6;

type Rect = { top: number; left: number; width: number; height: number };

function measure(target: string | undefined): Rect | null {
  if (!target) return null;
  const el = document.querySelector(`[data-tour="${target}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 };
}

/** Place the card beside the spotlight where it fits (right, left, below, above), clamped to the viewport. */
function cardPosition(rect: Rect | null, cardH: number): CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(CARD_W, vw - 32);
  if (!rect) return { width: w, left: (vw - w) / 2, top: Math.max(16, (vh - cardH) / 2) };
  const clampTop = (t: number) => Math.min(Math.max(16, t), Math.max(16, vh - cardH - 16));
  const clampLeft = (l: number) => Math.min(Math.max(16, l), Math.max(16, vw - w - 16));
  const right = rect.left + rect.width + GAP;
  if (right + w <= vw - 16) return { width: w, left: right, top: clampTop(rect.top) };
  if (rect.left - GAP - w >= 16) return { width: w, left: rect.left - GAP - w, top: clampTop(rect.top) };
  const below = rect.top + rect.height + GAP;
  if (below + cardH <= vh - 16) return { width: w, left: clampLeft(rect.left), top: below };
  if (rect.top - GAP - cardH >= 16)
    return { width: w, left: clampLeft(rect.left), top: rect.top - GAP - cardH };
  return {
    width: w,
    left: clampLeft(rect.left + rect.width / 2 - w / 2),
    top: clampTop(rect.top + rect.height / 2 - cardH / 2),
  };
}

export interface TourProps {
  onFinish(outcome: 'completed' | 'skipped', step: number): void;
}

/**
 * First-visit guided tour: a dimmed overlay with a spotlight on each part of the app and a card explaining it.
 * Arrow keys / Enter step through it; Esc skips. Finishing or skipping marks it seen for good; the header's
 * "Tour" button replays it.
 */
export function Tour({ onFinish }: TourProps) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [cardH, setCardH] = useState(200);
  const cardRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const step = STEPS[index]!;
  const last = index === STEPS.length - 1;

  const finish = useCallback(
    (outcome: 'completed' | 'skipped') => {
      markTourSeen();
      onFinish(outcome, index);
    },
    [onFinish, index],
  );

  useLayoutEffect(() => {
    const el = step.target ? document.querySelector(`[data-tour="${step.target}"]`) : null;
    el?.scrollIntoView({ block: 'nearest' });
    const update = () => setRect(measure(step.target));
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    const ro = el ? new ResizeObserver(update) : null;
    if (el) ro?.observe(el);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      ro?.disconnect();
    };
  }, [step.target]);

  useLayoutEffect(() => {
    if (cardRef.current) setCardH(cardRef.current.offsetHeight);
  }, [index, rect]);

  useEffect(() => {
    nextRef.current?.focus();
  }, [index]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      finish('skipped');
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (last) finish('completed');
      else setIndex(index + 1);
    } else if (e.key === 'ArrowLeft' && index > 0) {
      e.preventDefault();
      setIndex(index - 1);
    } else if (e.key === 'Tab') {
      // Keep focus inside the card while the rest of the app is behind the overlay.
      const focusables = cardRef.current?.querySelectorAll<HTMLElement>('button');
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0]!;
      const lastEl = focusables[focusables.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  return (
    <div className="app-tour" data-testid="tour" onKeyDown={onKeyDown}>
      {/* Clicks on the dimmed area are swallowed so the app can't be changed mid-tour. */}
      <div className="app-tour-shield" />
      <div
        className="app-tour-spot"
        style={
          rect
            ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
            : { top: '50%', left: '50%', width: 0, height: 0 }
        }
        aria-hidden="true"
      />
      <div
        ref={cardRef}
        className="app-tour-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        style={cardPosition(rect, cardH)}
      >
        <div className="app-tour-progress" aria-label={`Step ${index + 1} of ${STEPS.length}`}>
          {STEPS.map((s, i) => (
            <span key={s.title} data-active={i === index || undefined} data-done={i < index || undefined} />
          ))}
        </div>
        <h2 id="tour-title">{step.title}</h2>
        <p id="tour-body">{step.body}</p>
        <div className="app-tour-actions">
          <button
            type="button"
            className="app-tour-skip"
            data-testid="tour-skip"
            onClick={() => finish('skipped')}
          >
            {last ? 'Close' : 'Skip tour'}
          </button>
          <span className="app-tour-spacer" />
          {index > 0 && (
            <button
              type="button"
              className="app-btn"
              data-testid="tour-back"
              onClick={() => setIndex(index - 1)}
            >
              Back
            </button>
          )}
          <button
            ref={nextRef}
            type="button"
            className="app-btn app-ink"
            data-testid="tour-next"
            onClick={() => (last ? finish('completed') : setIndex(index + 1))}
          >
            {index === 0 ? 'Show me' : last ? 'Get started' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
