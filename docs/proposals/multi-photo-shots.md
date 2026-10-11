# Proposal: multi-photo shots (contract v2)

Status: **accepted** — contract applied in `src/types.ts` / `src/lib/constants.ts` (T11). Owner: T0 (orchestrator). Touches `src/types.ts`, `src/lib/constants.ts`, PLAN.md §3–§5.

## 1. Goal

Let one segment of the video show 1–4 photos at once (split screen, grids, picture-in-picture,
polaroid stack), with optional staggered "photo-dump" reveals, while:

- **every existing transition works unchanged.** A transition still blends two full-frame textures; each
  texture now holds a whole *shot* instead of one photo;
- **`grouping: 'off'` (the default) yields output identical to today**, byte-for-byte per frame;
- `buildTimeline()` / `frameAt()` stay pure and deterministic (seeded via `src/lib/rng.ts`).

The main use case is `grouping: 'auto'`, which pairs consecutive portrait photos side by side in landscape
output (and landscapes stacked in portrait output) instead of letterboxing them over a blurred fill.

Non-goals: free-form user layout editing, more than 4 photos per shot, transitions that animate individual
cells (possible later on top of this contract), and beat sync.

## 2. Contract diff (`src/types.ts`)

Compile-checked under `strict` + `noUncheckedIndexedAccess`.

```ts
// ---- NEW ----
/** How a shot arranges its photos. `single` = today's behaviour (one full-frame cell). */
export type LayoutStyle = 'single' | 'duo' | 'trio' | 'quad' | 'pip' | 'polaroid';
export type MultiLayout = Exclude<LayoutStyle, 'single'>;

/**
 * off   = one photo per shot (default; output identical to v1).
 * auto  = pair consecutive photos whose orientation fights the output.
 * mixed = auto, plus seeded multi-photo shots drawn from `layoutPool`.
 */
export type Grouping = 'off' | 'auto' | 'mixed';
/** together = all cells visible from the shot's start; stagger = cells 1..n pop in one after another. */
export type CellReveal = 'together' | 'stagger';
export type CellBorder = 'none' | 'polaroid';
/** Rectangle in output-frame fractions (0..1), origin TOP-LEFT, +y down. */
export interface Rect { x: number; y: number; w: number; h: number }

// ---- CHANGED ----
export interface PhotoOverrides {
  motion?: MotionStyle;
  transitionIn?: TransitionStyle; // transition INTO this photo's shot; honoured only on a shot's FIRST photo
  fit?: FitMode;
  focus?: { x: number; y: number };
  group?: 'solo' | 'joinNext';    // NEW: never group this photo / force it into a shot with the next photo
}

export interface MontageSettings {
  // ...all existing fields unchanged...
  grouping: Grouping;             // NEW, default 'off'
  layoutPool: MultiLayout[];      // NEW, ≥1, used by 'mixed'; default ['duo', 'trio', 'quad']
  gutter: number;                 // NEW, 0..0.04 of the shorter output side, filled with `background`; default 0.012
  reveal: CellReveal;             // NEW, default 'together'
}

export interface Cell {
  photoIndex: number;
  rect: Rect;                     // gutter applied; {0,0,1,1} for a single-photo shot
  rotation: number;               // radians about the rect centre (polaroid tilt); 0 otherwise
  border: CellBorder;
  motion: MotionStyle;
  motionFrom: Transform;          // tx/ty now in CELL fractions (= frame fractions when rect is full)
  motionTo: Transform;
  fit: FitMode;
  focus: { x: number; y: number };
  revealStart: number;            // seconds (absolute); == segment.start unless staggered
  revealDuration: number;         // seconds; 0 = present from revealStart
}

/** A segment is now a SHOT of 1..4 cells. Per-photo fields moved into Cell. */
export interface Segment {
  layout: LayoutStyle;
  cells: Cell[];                  // ≥1, consecutive photoIndex ascending, draw order back→front
  backdrop: number | null;        // photoIndex whose blurred cover fills behind the cells; null = background colour
  start: number;
  end: number;
  transitionIn: { style: TransitionStyle; start: number; duration: number } | null;
}

export interface Layer { /* unchanged */ }

export interface CellLayer extends Layer {
  rect: Rect;
  rotation: number;
  border: CellBorder;
  reveal: number;                 // 0..1 eased; 0 = not drawn, 1 = fully placed
}

export interface Shot {
  backdrop: Layer | null;         // drawn full-frame (cover, blurred + darkened) before the cells
  cells: CellLayer[];
}

export type FrameDescriptor =
  | { kind: 'single'; shot: Shot }
  | { kind: 'transition'; style: TransitionStyle; progress: number; from: Shot; to: Shot };
```

`Renderer`, `ExportRequest`, `ExportMessage`, `ExportCommand` and `PhotoSource` are unchanged.
`Layer` → `Shot` in `FrameDescriptor` is a deliberate rename (`layer` → `shot`, `from`/`to` retyped), so that
the compiler finds every consumer.

**Engine API changes** (exported from `src/engine`, owned by T2):

- `buildTimeline(photos, overrides, settings)`: `photos` widens to
  `Pick<PhotoSource, 'id' | 'naturalWidth' | 'naturalHeight'>`, because grouping needs each photo's orientation.
- `timingSummary(photos, settings)` replaces `timingSummary(photoCount, settings)`. It returns `{ transition,
  avgShot, minShot, shots, ok }`.
- New `groupPhotos(photos, overrides, settings): { layout: LayoutStyle; photoIndices: number[] }[]` is
  pure and cheap. The UI uses it to show which photos are grouped together.
- New `photosOf(segment): number[]` and `cellPixelSize(segment, photoIndex, out): { width; height }` for
  photo residency and decode sizing.

## 3. Invariants (unit-tested)

1. `grouping: 'off'`: every segment has exactly one cell with `rect = {0,0,1,1}`, `rotation 0`,
   `border 'none'`, `revealDuration 0`, and `backdrop null`. Every start, end, transition and transform
   equals the v1 timeline for the same inputs (golden test against a v1 snapshot), and the renderer
   produces identical pixels (harness pixel diff at 3 timestamps × 3 fit modes).
2. Every photo appears in exactly one cell. Reading cells across segments gives photo indices
   0..N−1 in order; grouping never reorders.
3. Rects lie within [0,1]². In `duo`/`trio`/`quad`, rects don't overlap, and with `gutter = 0` they tile the
   frame exactly.
4. 1 ≤ `cells.length` ≤ 4. A `solo` photo is always alone. A `joinNext` chain is honoured up to capacity.
5. Same inputs and seed always give the same timeline. Grouping draws from `deriveSeed(seed, 'grouping', i)`.
6. v1 timing invariants hold per shot: segments are contiguous, the last one ends at `L`, and
   `frameCount = round(L·fps)`.

## 4. Behaviour spec (PLAN.md §4.9)

### 4.7.1 Grouping (pure, in photo order)

- **Mismatch:** `outA = W/H`, `photoA = naturalWidth/naturalHeight`. A photo is mismatched when
  `outA ≥ 1.2 && photoA ≤ 0.85` (portrait in landscape) or `outA ≤ 0.83 && photoA ≥ 1.18` (landscape in
  portrait). Square-ish output never counts as mismatched.
- **Capacity:** duo 2, pip 2, trio 3, polaroid 3 (or 2 if only 2 photos are available), quad 4.
- **Walk** i = 0..N−1:
  1. If the photo is `solo`, it gets a `single` shot.
  2. A `joinNext` chain collects photos until a `solo` photo or 4 photos. The layout follows the count:
     2 → duo, 3 → trio, 4 → quad.
  3. `auto` / `mixed`: if photos i and i+1 are both mismatched and i+1 isn't solo, they form a `duo`.
  4. `mixed` only: at each remaining eligible position, with p = 0.35 (seeded), pick a layout from
     `layoutPool` using the existing `selection` rules (no repeat when the pool has more than 1 entry).
     If capacity can't be met before a solo photo or the end, fall back to the largest layout that fits.
     The first and last photo stay solo (opening and closing hero) unless overridden.
  5. Otherwise the photo gets a `single` shot.

### 4.7.2 Layout rects

`g` is the gutter in pixels: `gutter · min(W,H)`. It is applied between cells and around the outer edge
(no outer gutter for `single`, `pip`, or `polaroid`). Orientation follows the output.

| Layout | Landscape output (W ≥ H) | Portrait output |
|---|---|---|
| duo | two columns | two rows |
| trio | hero (first photo) in the left 58%, two stacked on the right | hero in the top 58%, two side by side underneath |
| quad | 2×2 | 2×2 |
| pip | cell 0 full frame; cell 1 inset 34% of the short side in a seeded corner, 4% margin, `border 'polaroid'` | same |
| polaroid | 2–3 cards about 58% of the short side, fanned around centre, rotation seeded in ±8°, `border 'polaroid'`, `backdrop` = first photo | same |

### 4.7.3 Timing

- With `S` shots, the weights are `pacingWeights(S, pacing, seed)` multiplied by
  `shotWeight(k) = 1 + 0.5·(k − 1)` for k photos, then renormalised to sum to `S`. The rest of §4.1 applies
  per shot. `MIN_PHOTO_DURATION` becomes the minimum *shot* duration, and the error copy still says
  "photos".
- The transition into shot s comes from the first cell's `transitionIn` override, otherwise from the pool
  at shot index s−1. `resolveStyles` runs per shot for transitions and per photo for motion.
- **Stagger:** cell 0 is present from `start`, so the incoming transition has content. Let
  `hold = (end − outgoing transition) − (transition-in end)`. Cell k ≥ 1 then gets
  `revealStart = tInEnd + (k−1)·step` with `step = min(0.3, 0.12·hold)` and
  `revealDuration = min(0.35, 1.2·step)`. Every reveal must finish by `tInEnd + 0.5·hold`; if it can't, the
  shot falls back to `together`. `frameAt` computes `reveal = easeOut((t − revealStart)/revealDuration)`,
  clamped to [0,1].

### 4.7.4 Motion and fit in cells

- Motion keeps the per-photo stream `deriveSeed(seed, 'kenBurns', photoIndex)`, so `single` shots don't
  change. Multi-cell shots scale `motionIntensity` by 0.6, because four independently drifting cells
  look busy. `tx/ty` are fractions of the cell.
- Fit in multi-cell shots defaults to `cover` (cropped around `focus`), whatever `settings.fit` is. A
  per-photo `fit` override still wins. Cover never reveals edges inside the cell; that's the same clamp
  as today, measured in cell pixels.

### 4.7.5 Rendering (T3)

- `renderShot(shot, target)`: clear to the background, then draw the `backdrop` if there is one (cover,
  blurred and darkened, following its layer transform), then draw each cell with `reveal > 0` back to
  front.
- **Fast path:** a cell with `rect` full, `rotation 0`, `border 'none'` and `reveal 1` uses today's
  `renderLayer` verbatim. This is what guarantees invariant 1.
- **General path:** draw the cell's content into a reusable cell-size scratch target, placing it
  against the cell's pixel size (frame = cell). The blur-fit cache key becomes
  `(photoIndex, cellW, cellH)`. Then composite it as one textured quad with the rect, rotation, alpha and
  border.
  - The composite shader does a signed-distance edge, so rotated edges are anti-aliased without MSAA.
  - The polaroid border is white: 4% of the card's short side, 14% at the bottom, with a soft shadow
    (an analytic SDF falloff, not a blur pass).
- **Reveal animation** (renderer-defined, from `reveal = r`): alpha r, y offset `(1−r)·6%` of the cell
  height, scale `0.96 + 0.04r`. Polaroid cards also rotate in from `rotation + 0.12·(1−r)`.
- Transitions are unchanged: `layerA`/`layerB` now hold `renderShot` output.

### 4.7.6 Photo residency (T4 export, T7 preview)

Both residency windows currently assume segment index == photo index. That is no longer true.

- The window stays prev / current / next *segment*. Resident photos are the union of `photosOf(seg)`
  over that window: at most 12 in theory, typically 6 or fewer.
- Each photo is decoded at `decodeSizeFor(cellPixelSize(...), natural)` instead of the full output size.
  A photo belongs to exactly one cell, so its decode size is fixed. Total pixel memory stays about the
  same as v1 even with 4 photos per shot.
- In the preview, the previous/next controls and the scrubber tick marks move per shot.

### 4.7.7 UI (T6)

- New **Layouts** group:
  - Grouping as a segmented control (Off · Auto · Mixed)
  - Layout chips (shown only for Mixed)
  - Gutter slider
  - Reveal toggle (Together · Stagger)
- Inspector:
  - "Grouping: Default · Keep solo · Join with next"
  - The transition select is disabled for a photo that isn't first in its shot, with the hint
    "Joined with the previous photo"
- Photo strip: brackets around grouped photos, using `groupPhotos()`.
- Summary label: "12 shots · avg 2.4 s".

## 5. Blast radius

| Area | Files | Change |
|---|---|---|
| Contract | `src/types.ts`, `src/lib/constants.ts` (defaults + `LAYOUT_CAPACITY`), PLAN.md §3/§4.7/§5 | T0 |
| Engine | `timeline.ts`, `styles.ts`, `frame.ts`, `motion.ts` (cell fractions), new `grouping.ts` and `layouts.ts`, tests | T2 |
| Renderer | `renderer.ts` (`renderShot`, composite program, cell scratch, blur cache key), `layout.ts` (cell-relative placement), `harness/render*` | T3 |
| Transitions | none (`texFrom`/`texTo` receive whole shots) | — |
| Export | `montageSource.ts` residency + decode size | T4 |
| App | `previewEngine.ts` residency, segment navigation | T7 |
| UI | settings panel, `PerPhotoInspector.tsx`, photo strip, summary | T6 |
| Harnesses | `harness/transitions.ts`, `harness/export-montage.ts`, `harness/render-common.ts`: `.layer` → `.shot`, `seg.photoIndex` → `seg.cells[0].photoIndex` | owner of each |
| E2E | add a mixed-orientation 16:9 auto-grouping export; pixel-identity check for `grouping: 'off'` | T8 |

## 6. Task plan (one wave on a feature branch; it won't compile until T12–T14 land)

| Task | Depends on | Acceptance |
|---|---|---|
| T11 contract (T0) | — | types + defaults + PLAN.md merged into the feature branch; `harness/*` compile shims |
| T12 engine | T11 | invariants 1–6 unit-tested; golden v1 snapshot equal under `'off'`; grouping table tests for 16:9, 9:16, 1:1 |
| T13 renderer | T11 | `'off'` frames pixel-identical to main; screenshot strips for each layout × reveal 0/.5/1 at 1920×1080 and 1080×1920; rotated edges anti-aliased |
| T14 residency (T4 + T7) | T12 | export of 40 photos in `quad` at 4K finishes without an OOM or context loss; resident bitmap count ≤ window union (logged) |
| T15 UI | T12 | controls + inspector + strip brackets; keyboard accessible |
| T16 e2e + verify (T8/T9) | all | ffprobe-verified MP4s: `'off'` identical to main, `auto` on mixed orientation, `mixed` + stagger across every layout |

Suggested split: duo / trio / quad plus `auto` first (the bulk of the value), then pip / polaroid and
stagger as a second pass inside the same wave or the next one.

## 7. Decisions (resolved)

All four open questions below went with the recommendation: (1) default `'off'`, flip to `'auto'` after T16;
(2) multi-cell shots force `cover`, a per-photo `fit` override still wins; (3) `transitionIn` on a non-first
photo is ignored; (4) fixed p = 0.35 (`MIXED_GROUP_PROBABILITY`), no slider.

### Original open questions

1. **Default grouping.** `'off'` keeps today's output and is the safe ship. `'auto'` is the better
   experience for mixed-orientation libraries. Recommendation: ship `'off'`, then flip the default to
   `'auto'` once T16 passes.
2. **Fit in cells.** Is forcing `cover` acceptable, or should `contain` be offered for cells too
   (letterboxed inside the cell)?
3. **`transitionIn` on a non-first photo.** It is currently ignored. An alternative is to reuse it as that
   cell's reveal style, but that would need a new `CellReveal` value per cell.
4. **Mixed density.** Is the fixed p = 0.35 right, or should it be a 0..1 slider like pacing?
