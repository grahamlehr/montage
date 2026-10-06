# Montage — Implementation Plan

A fully client-side web app that turns a set of photos into a downloadable MP4 montage.
Target: latest desktop Chrome on a high-spec machine. No backend. Photos never leave the browser.

This plan is written to be executed by an **Opus orchestrator session** that delegates implementation
to **Sonnet subagents** (`.claude/agents/montage-implementer.md`, `.claude/agents/montage-verifier.md`).
Section 8 is the orchestration playbook, section 9 the GitHub setup; sections 1–7 are the spec every agent works from.

---

## 1. Requirements (agreed)

| # | Requirement | Decision |
|---|---|---|
| R1 | Accept multiple photos | Drag-drop / file picker. JPEG, PNG, WebP, AVIF, GIF (first frame), **HEIC/HEIF**. Reorder, remove, shuffle. Design load: **~50 photos**. |
| R2 | Output MP4 download | H.264 (AVC) in MP4 via WebCodecs + Mediabunny. No audio track. |
| R3 | Configurable dimensions | Presets **and arbitrary W×H** (non-standard aspect ratios). Design load: **1080×1920**. Range 128–4096 px per side, forced even, **and W×H ≤ 36,864 macroblocks (≈9.4 Mpx, e.g. 4096×2304 / 3072×3072)** — Chrome's H.264 encoders reject larger frames (decided with the user in wave 3, #19). |
| R4 | Configurable length | **Total duration** (seconds). Per-photo time is derived. |
| R5 | Animation styles | Motion (within a photo) + transitions (between photos). Styles can be **combined**: a pool of enabled styles applied across the montage (sequence or seeded random), plus **per-photo overrides**. |
| R6 | Speed | **Three independent sliders**: *Transition speed*, *Motion intensity*, *Pacing*. |
| — | Excluded | Background music / any audio. Text overlays. Video inputs. Non-Chrome browsers. |

---

## 2. Architecture

```
┌──────────────────────── Main thread (React UI) ────────────────────────┐
│ PhotoTray ── SettingsPanel ── PerPhotoInspector ── PreviewPlayer        │
│      │              │                                    │              │
│   ingest/decode   settings store (zustand)        renderer (WebGL2,     │
│   (thumbs+preview  ──► buildTimeline() ──► frameAt(t) ──► HTMLCanvas)   │
│    bitmaps)                                                              │
│      │ Files + settings + seed                                          │
└──────┼──────────────────────────────────────────────────────────────────┘
       ▼ postMessage
┌──────────────────────── Export Worker ─────────────────────────────────┐
│ decode Files at export size → buildTimeline() (same seed) →            │
│ for i in 0..frameCount: frameAt(i/fps) → renderer.draw (OffscreenCanvas)│
│ → new VideoFrame(canvas) → VideoEncoder (H.264) → Mediabunny MP4 → Blob │
└─────────────────────────────────────────────────────────────────────────┘
```

**Core invariant:** `buildTimeline()` and `frameAt()` are **pure and deterministic** (seeded RNG, no `Math.random`,
no `Date`). The renderer only draws a `FrameDescriptor`. Preview and export therefore produce identical frames.

### Stack
- Vite + React 19 + TypeScript (strict)
- zustand (state), dnd-kit (reorder)
- WebGL2 (renderer; one shader program per transition, shared vertex/fit/motion code)
- WebCodecs `VideoEncoder` + **mediabunny** (MP4 muxing, `fastStart: 'in-memory'`)
- **heic-to** (libheif WASM) for HEIC; try native `createImageBitmap` first, fall back to WASM.
  If `heic-to` proves unusable in a Worker, fall back to `libheif-js` (wasm-bundle).
- Vitest (unit), Playwright with **`channel: 'chrome'`** (e2e). *Playwright's bundled Chromium has no H.264
  encoder — always use installed Google Chrome (v153 present on this machine).*
- ffprobe (installed via Homebrew) for verifying exported files.

### Directory layout & ownership

```
src/
  types.ts                 # SHARED CONTRACT — orchestrator only
  lib/rng.ts               # seeded PRNG (mulberry32) — orchestrator (wave 0)
  ingest/                  # T1  decode, HEIC, EXIF, resize, thumbnails
  engine/                  # T2  timeline, pacing, style assignment, frameAt
  render/                  # T3  WebGL2 core, fit modes   | T5 motion+transition shaders
  export/                  # T4  codec/level selection, encoder, muxer, worker
  ui/                      # T6  components, store
  app/                     # T7  App shell, preview player, wiring
tests/e2e/                 # T8
scripts/make-fixtures.sh   # T8
fixtures/                  # generated test photos (incl. HEIC via `sips`)
```

An agent may only create/edit files inside its owned paths. Changes to `src/types.ts`, `package.json`,
or config files go through the orchestrator (agents propose them in their report).

---

## 3. Shared contract — `src/types.ts` (written by orchestrator in wave 0)

```ts
export type FitMode = 'cover' | 'contain' | 'blur';           // blur = contain over blurred cover

export type MotionStyle =
  | 'none' | 'kenBurns' | 'zoomIn' | 'zoomOut'
  | 'panLeft' | 'panRight' | 'panUp' | 'panDown';

export type TransitionStyle =
  | 'cut' | 'crossfade' | 'dipToBlack'
  | 'slideLeft' | 'slideRight' | 'slideUp' | 'slideDown'
  | 'push' | 'wipe' | 'zoom' | 'blur';

export type StyleSelection = 'sequence' | 'random';

export interface PhotoSource {
  id: string;
  file: File;
  name: string;
  naturalWidth: number;        // after EXIF orientation applied
  naturalHeight: number;
}

export interface PhotoOverrides {
  motion?: MotionStyle;
  transitionIn?: TransitionStyle;   // transition INTO this photo (ignored for photo 0)
  fit?: FitMode;
  focus?: { x: number; y: number }; // 0..1 focal point for cover crop / motion target
}

export interface MontageSettings {
  width: number;                  // even, 128..4096
  height: number;                 // even, 128..4096
  fps: 24 | 25 | 30 | 60;
  totalDuration: number;          // seconds, 2..600
  transitionSpeed: number;        // 0..1   0 = slow (long transitions), 1 = fast
  motionIntensity: number;        // 0..1   0 = static, 1 = strong zoom/pan
  pacing: number;                 // 0..1   0 = even durations, 1 = dynamic rhythm
  motionPool: MotionStyle[];      // ≥1 enabled styles
  transitionPool: TransitionStyle[]; // ≥1 enabled styles
  selection: StyleSelection;
  seed: number;                   // drives all randomness
  fit: FitMode;
  background: string;             // CSS hex, used for contain letterbox
  quality: 'standard' | 'high' | 'max';
}

/** Fully resolved, deterministic plan for the whole video. */
export interface Segment {
  photoIndex: number;
  start: number;                  // seconds, photo first visible (start of its transition-in)
  end: number;                    // seconds, photo last visible (end of transition-out)
  motion: MotionStyle;
  motionFrom: Transform;          // transform at `start`
  motionTo: Transform;            // transform at `end`
  fit: FitMode;
  focus: { x: number; y: number };
  transitionIn: { style: TransitionStyle; start: number; duration: number } | null;
}

export interface Transform { scale: number; tx: number; ty: number } // tx/ty in output-frame fractions

export interface Timeline {
  duration: number;
  fps: number;
  frameCount: number;             // round(duration * fps)
  segments: Segment[];
}

export interface Layer {
  photoIndex: number;
  fit: FitMode;
  focus: { x: number; y: number };
  transform: Transform;           // eased, at time t
}

export type FrameDescriptor =
  | { kind: 'single'; layer: Layer }
  | { kind: 'transition'; style: TransitionStyle; progress: number /*0..1 eased*/; from: Layer; to: Layer };

export interface Renderer {
  setSize(width: number, height: number): void;
  setPhoto(index: number, bitmap: ImageBitmap | null): void;   // null = release texture
  setBackground(hex: string): void;
  draw(frame: FrameDescriptor): void;
  dispose(): void;
}

export interface ExportRequest {
  files: File[];                  // in montage order
  photos: PhotoSource[];
  overrides: Record<string, PhotoOverrides>; // keyed by PhotoSource.id
  settings: MontageSettings;
}

export type ExportMessage =
  | { type: 'progress'; phase: 'decoding' | 'encoding' | 'finalizing'; done: number; total: number; etaSeconds?: number }
  | { type: 'done'; blob: Blob; bytes: number; codec: string; encoderPath: 'hardware' | 'software' }
  | { type: 'error'; message: string };
```

---

## 4. Behaviour spec

### 4.1 Timing model (total duration fixed)
Given N photos, total `L`:
1. **Transition duration** `T = lerp(1.6, 0.15, transitionSpeed)` s (ease the slider with a slight curve).
   Cut transitions have duration 0 regardless.
2. **Pacing weights** `w_i`: `pacing = 0` → all 1. As pacing rises, blend in (a) seeded per-photo variation
   (±60% at max) and (b) an arc that lingers on the first and last photo and quickens in the middle.
   Normalise so `Σ w_i` = N.
3. With overlapping transitions, `L = Σ D_i − Σ T_j`, so `D_i = w_i · (L + Σ T_j) / N`.
4. **Clamp**: each `T_j ≤ 0.45 · min(D_j, D_{j+1})`; after clamping, recompute `D_i`. If even
   `T = 0` gives `D_i < 0.25 s`, return a validation error the UI shows ("too many photos for this length").
5. Invariants (unit-tested): segments contiguous; last segment ends exactly at `L`; `frameCount = round(L·fps)`;
   identical output for identical inputs + seed.

### 4.2 Motion intensity
- Zoom delta `= lerp(0, 0.30, motionIntensity)`; pan travel `= lerp(0, 0.12, motionIntensity)` of frame size.
- `kenBurns` = seeded combination of zoom direction + pan toward/away from `focus`.
- Motion runs across the whole segment (including the overlap) with ease-in-out so the photo moves through transitions.
- Cover crops must never reveal edges: renderer clamps translation to the scaled image bounds.

### 4.3 Combining styles (R5)
- `motionPool` / `transitionPool` are multi-select in the UI (defaults: `[kenBurns]`, `[crossfade]`).
- `sequence`: photo i gets `pool[i % pool.length]`. `random`: seeded pick, never repeating the previous style
  when the pool has >1 entry.
- Per-photo `overrides` take precedence over the pool. A "Randomise" button changes `seed`.

### 4.4 Fit modes
- `cover`: fill, crop around `focus`. `contain`: letterbox on `background`. `blur`: contain over a blurred,
  darkened cover copy (two-pass separable Gaussian at reduced resolution, cached per photo per size).
- Default `blur` (best for mixed portrait/landscape into arbitrary aspect ratios).

### 4.5 Dimensions & codec (R3)
- UI: preset chips (9:16 1080×1920 *default*, 16:9 1920×1080, 1:1 1080×1080, 4:5 1080×1350, 4:3, 3:4,
  21:9 2560×1080, 2:3) + free W/H inputs with aspect-lock toggle and a free-text ratio field (e.g. `7:5`).
  Values are rounded to even numbers.
- `pickAvcCodec(w, h, fps)`: compute macroblocks `ceil(w/16)·ceil(h/16)` and MB/s; choose the lowest
  High-profile level (`avc1.6400xx`) satisfying MaxFS, MaxMBPS, and `max(wMB,hMB) ≤ sqrt(8·MaxFS)`.
- Configure order: `{hardwareAcceleration:'prefer-hardware'}` → `'no-preference'` → `'prefer-software'`, each
  gated by `VideoEncoder.isConfigSupported`. Report which path was used.
- Bitrate = `w·h·fps·bpp`, bpp = 0.08 / 0.12 / 0.18 for standard/high/max. Keyframe every 2 s.
  Show estimated file size in the UI.

### 4.6 Ingest & memory
- Detect HEIC by magic bytes (`ftyp` brand `heic|heix|hevc|mif1|msf1`), not extension.
- Decode with `createImageBitmap(blob, { imageOrientation: 'from-image', resizeWidth/Height, resizeQuality: 'high' })`.
- Three decode sizes: **thumbnail** (256 px long edge), **preview** (fits output × (1 + max zoom), capped at
  output long edge × 1.35), **export** (same rule, decoded inside the worker from the original `File`).
- Renderer keeps only the textures for the current ± 1 photos resident; upload ahead of need.
- Ingest functions must be worker-safe (no DOM).

### 4.7 Export
- Worker: decode → render → `new VideoFrame(offscreenCanvas, { timestamp: i*1e6/fps, duration })` →
  `encoder.encode(frame, { keyFrame: i % (2*fps) === 0 })` → `frame.close()`.
- Backpressure: await while `encoder.encodeQueueSize > 8`.
- Progress events at most every 100 ms with ETA. `AbortSignal`-style cancel via message.
- Result: Blob → `URL.createObjectURL` → download `montage-{w}x{h}-{L}s.mp4`.

### 4.8 Preview
- Same renderer on an `HTMLCanvasElement`, scaled via CSS to fit the panel (letterboxed for odd ratios).
- Play/pause, scrubber, current time / duration, loop toggle. Settings changes rebuild the timeline and
  re-render the current frame immediately.

---

## 5. Work breakdown

| ID | Task | Owner paths | Depends on | Wave |
|---|---|---|---|---|
| T0 | Scaffold, deps, `types.ts`, `rng.ts`, CLAUDE.md, git init | root config, `src/types.ts`, `src/lib/` | — | 0 (orchestrator) |
| T1 | Ingest: HEIC detect/decode, EXIF, resized decodes, thumbnails; fixtures script | `src/ingest/`, `scripts/make-fixtures.sh`, `fixtures/` | T0 | 1 |
| T2 | Engine: timing, pacing, style assignment, motion transforms, `frameAt` + unit tests | `src/engine/` | T0 | 1 |
| T3 | Renderer core: WebGL2 setup, texture mgmt, fit modes (cover/contain/blur), `single` frames, transform | `src/render/` (core files) | T0 | 1 |
| T4 | Export pipeline: `pickAvcCodec`, encoder config fallback, Mediabunny muxing, worker protocol. Validate with a **test-pattern** renderer before T3 lands. | `src/export/` | T0 | 1 |
| T6 | UI: store, PhotoTray (dnd), SettingsPanel (dims/presets/aspect, duration, 3 sliders, pools, selection, fit, quality), PerPhotoInspector. Mock data until T1/T2 land. | `src/ui/` | T0 | 1 |
| T5 | Transitions (all 11) + motion styles in shaders | `src/render/transitions/`, `src/render/motion*` | T3 | 2 |
| T7 | App integration: wire UI→engine→preview; export button→worker→download; validation errors | `src/app/`, `src/main.tsx` | T1–T4, T6 | 2 |
| T8 | Playwright e2e + ffprobe checks (uses T1's fixtures: HEIC via `sips`, EXIF-rotated, panorama, tiny, 50-photo set) | `tests/e2e/` | T1, T7 | 2 |
| T9 | Verification & hardening pass (verifier agent): full matrix, perf, memory | read-only + bug reports | T5, T7, T8 | 3 |
| T10 | Fix-up tasks from T9 findings | per finding | T9 | 3 |

### Acceptance criteria per task (agents must self-verify)

- **T1** `decodePhoto(file, {maxW,maxH})` and `readPhotoSource(file)` work in Window and Worker; HEIC fixture
  decodes; EXIF-rotated JPEG comes out upright; unsupported file → typed error. Vitest where possible
  (logic like magic-byte sniffing, size math); browser behaviour checked via a tiny harness page.
- **T2** Vitest coverage of §4.1 invariants, pacing extremes, clamp behaviour, sequence vs random,
  override precedence, determinism (same seed ⇒ deep-equal timeline), `frameAt` at boundaries
  (t=0, t=L, mid-transition). Pure TS, no DOM.
- **T3** Demo harness renders a photo in all 3 fit modes at 1080×1920, 1920×1080 and 1234×778; no edge
  reveal at max zoom; textures released on `setPhoto(i, null)`; works on HTMLCanvas and OffscreenCanvas.
- **T4** Unit tests for `pickAvcCodec` (1080×1920@30, 3840×2160@60, 4096×4096@30, 1234×778@25).
  Harness exports a 5 s test pattern at 1080×1920 and 1234×778; `ffprobe` shows h264, correct w/h,
  correct frame count, duration within 1 frame.
- **T5** Every transition visually verified (screenshot strip at progress 0, .25, .5, .75, 1) on two
  aspect ratios; each motion style moves in the stated direction; progress 0 = pure `from`, 1 = pure `to`.
- **T6** All controls bound to store; even-number rounding; aspect lock; ratio text input; slider labels
  show derived values (e.g. "Transitions: 0.8 s", "Avg 2.4 s / photo"); keyboard accessible; reorder works.
- **T7** Load 50 fixtures → preview plays smoothly → export 1080×1920, 60 s, 30 fps completes and downloads;
  validation error shown for impossible settings; cancel works; UI stays responsive during export.
- **T8** `npm run test:e2e` runs headed-capable Chrome (`channel:'chrome'`), uploads fixtures, exports,
  saves the file, and asserts via ffprobe (codec, dims, frame count, duration).
- **T9** Matrix below passes; report written to `reports/verification.md`.

### Verification matrix (T9)
| Case | Dims | fps | Length | Photos | Notes |
|---|---|---|---|---|---|
| Design load | 1080×1920 | 30 | 60 s | 50 mixed incl. HEIC | must finish < 60 s |
| Landscape | 1920×1080 | 60 | 30 s | 20 | |
| Odd ratio | 1234×778 | 25 | 20 s | 10 | non-16-multiple dims |
| Tall ratio | 720×2560 | 30 | 15 s | 8 | |
| Max | 4096×2160 | 30 | 20 s | 10 | may use software path; report |
| Stress pacing | 1080×1920 | 30 | 10 s | 50 | expect validation or very short holds |
| All styles | 1080×1080 | 30 | 45 s | 22 | every transition + motion at least once |

Check each output with ffprobe and play it in QuickTime (`open -a QuickTime\ Player file.mp4`).

---

## 6. Conventions (go in CLAUDE.md at T0)
- TypeScript strict; no `any` in exported signatures.
- No `Math.random()` / `Date.now()` in `src/engine` or `src/render` — use `src/lib/rng.ts`.
- Every `VideoFrame` and `ImageBitmap` must be `.close()`d when no longer needed.
- Scripts: `npm run dev`, `npm run build`, `npm run typecheck`, `npm test` (Vitest), `npm run test:e2e`.
- Harness pages for browser-only modules live at `/harness/<module>.html` (Vite multi-page) and are excluded from production build.

---

## 7. Risks
| Risk | Mitigation |
|---|---|
| HEIC WASM is large (~1.5 MB) / slow | Lazy-load only when a HEIC file is detected; decode in worker. |
| Hardware encoder rejects odd dims | Fallback chain in §4.5; software path tested in matrix. |
| Bundled Playwright Chromium lacks H.264 | Use `channel: 'chrome'`. |
| Memory with 50 high-res photos | Size-capped decodes (§4.6), ±1 resident textures, close bitmaps. |
| Preview/export mismatch | Single pure `frameAt` + shared renderer; T9 compares a preview frame screenshot to the decoded export frame at the same t (ffmpeg `-ss`). |
| Parallel agents colliding | Strict path ownership; only orchestrator edits shared files and installs deps. |

---

## 8. Orchestration playbook (for the Opus session)

### Roles
- **Opus (orchestrator)**: owns the contract (`types.ts`), dependencies, config, integration review,
  and wave gates. Does T0 itself. Does **not** write feature code except small integration fixes.
- **`montage-implementer` (Sonnet)**: one task per invocation, stays within owned paths, self-verifies
  against acceptance criteria, returns a structured report.
- **`montage-verifier` (Sonnet)**: read-only adversarial checks (tests, ffprobe, browser), returns findings.

### Procedure
1. **Wave 0 (Opus, sequential)**
   - **Confirm the GitHub details with the user once before creating anything** (§9 defaults:
     `grahamlehr/montage`, private). Creating the repo is an outward-facing action.
   - `git init -b main`, Vite React-TS scaffold, install all deps up front:
     `zustand @dnd-kit/core @dnd-kit/sortable mediabunny heic-to` and dev deps
     `vitest @playwright/test @types/dom-webcodecs` (if still needed for the TS version).
   - Write `src/types.ts` (§3), `src/lib/rng.ts`, `CLAUDE.md` (§6 + ownership table), npm scripts,
     Vite multi-page harness config, Playwright config with `channel: 'chrome'`.
   - Write the GitHub scaffolding from §9.2 (README, .gitignore, CI workflow, templates, etc.).
   - `npm run typecheck && npm run build` green → commit `chore: scaffold (wave 0)` on `main`
     → create the remote and push (§9.1) → confirm CI is green on `main` → apply repo settings (§9.4).
2. **Wave 1** — `git switch -c wave-1`. Launch **T1, T2, T3, T4, T6 in parallel** (single message,
   five `Agent` calls, `subagent_type: montage-implementer`, background). T1 also owns the fixture
   script (`scripts/make-fixtures.sh`, `fixtures/`). Each prompt = the task template below.
3. **Gate 1 (Opus)** — for each report: read the diff, check ownership was respected, run
   `npm run typecheck && npm test && npm run build`. Spot-check harness pages in the Browser pane.
   Resolve any contract change requests (edit `types.ts` yourself, then notify affected agents via
   `SendMessage` to the same agent rather than spawning fresh). Commit **one commit per task**
   (`feat(ingest): … (T1)` etc.), push, open a PR `Wave 1: …` (§9.3), wait for CI, squash-merge
   is *not* used — **merge commit** so per-task history is kept. Delete the branch.
4. **Wave 2** — `git switch main && git pull && git switch -c wave-2`. Launch **T5, T7, T8 (e2e)** in
   parallel. T7 may need small edits in other modules: it must list them for the orchestrator
   instead of making them.
5. **Gate 2** — same checks + `npm run test:e2e`. Run the app yourself (Browser pane), do one real
   export of the design load, ffprobe it. Per-task commits → PR `Wave 2: …` → CI green → merge.
6. **Wave 3** — branch `wave-3`. Launch `montage-verifier` with the §5 matrix. File each confirmed
   finding as a GitHub issue (label `bug`, severity label, milestone `v1`). Dispatch a
   `montage-implementer` fix task per issue (parallel when paths don't overlap); commit with
   `Fixes #N`. Re-verify. PR → merge → tag `v1.0.0` and create a GitHub release with the
   verification summary and a sample exported MP4 attached.
7. Finish with a summary to the user: repo URL, release URL, (Pages URL if enabled), matrix results,
   open issues / known limitations.

### Rules for the orchestrator
- Keep ≤ 5 subagents running at once.
- Never let two agents own the same path in the same wave.
- If an agent fails acceptance twice on the same task, take it over yourself or re-scope it.
- Prefer continuing an existing agent (`SendMessage`) for follow-ups on its own task — it keeps context.
- Don't trust "done" claims: always run the gate commands yourself.
- **Only the orchestrator runs git or gh.** Subagents never commit, push, branch, or open PRs/issues.
- Never force-push `main`; never merge a PR with failing CI.

### Task prompt template
```
You are implementing task {ID}: {title} for the Montage app.
Read first: PLAN.md (sections 1–4, 6 and the {ID} row + acceptance criteria), CLAUDE.md, src/types.ts.
You own ONLY these paths: {paths}. Do not edit anything else (incl. package.json, types.ts).
If you need a contract or dependency change, stop and describe it in your report.
Context from earlier waves: {notes, e.g. exported function names from T1/T2}.
Done = every acceptance criterion for {ID} demonstrably met; `npm run typecheck` and `npm test` pass.
Report back in this format:
  STATUS: done | blocked | partial
  FILES: list of created/modified files
  PUBLIC API: exported functions/components with signatures
  VERIFICATION: commands run + results; harness pages checked
  CONTRACT REQUESTS: proposed changes to types.ts / deps (or "none")
  KNOWN ISSUES: …
```

### Kickoff prompt (paste into a fresh Opus session in this folder)
```
Implement the Montage app by following PLAN.md exactly. You are the orchestrator described in §8:
do wave 0 yourself, including creating the GitHub repo and scaffolding in §9 (confirm the repo
name and visibility with me first), then delegate tasks to the montage-implementer and
montage-verifier subagents (Sonnet) in the waves listed. Gate each wave with the checks in §8 and
land it as a PR with green CI. Stop and ask me only if a requirement in §1 turns out to be infeasible.
```

---

## 9. Repository & GitHub

### 9.1 Repo creation
- Account: `grahamlehr` (gh CLI is already authenticated with `repo` + `workflow` scopes).
- Defaults: name **`montage`**, **private**, description *"Turn photos into an MP4 montage, entirely in
  the browser."*, default branch `main`. Confirm with the user before running:
  ```
  gh repo create grahamlehr/montage --private --source . --remote origin \
    --description "Turn photos into an MP4 montage, entirely in the browser." --push
  ```
- Commit messages: Conventional Commits (`feat(engine): …`, `fix(export): …`, `chore: …`, `test: …`).

### 9.2 Files to scaffold (wave 0)
| File | Content |
|---|---|
| `README.md` | What it is, features, browser requirement (latest Chrome), privacy note (nothing uploaded), `npm` scripts, architecture summary (link PLAN.md), screenshot placeholder updated at v1. |
| `.gitignore` | node_modules, dist, coverage, playwright-report, test-results, `tmp/`, `*.mp4` (except `docs/samples/`), `.DS_Store`, `.env*`. **Do not** ignore `.claude/agents/` or `CLAUDE.md`. |
| `.editorconfig`, `.nvmrc` (`24`), `.prettierrc` | Basic formatting; add `prettier` + `eslint` (typescript-eslint, react-hooks) dev deps and `lint`/`format` scripts. |
| `.github/workflows/ci.yml` | On PR and push to `main`: `npm ci` → `lint` → `typecheck` → `test` → `build`, Node from `.nvmrc`, npm cache. Second job `e2e` (see 9.5). |
| `.github/workflows/pages.yml` | Build and deploy `dist/` to GitHub Pages on push to `main`. **Only if** the repo is public or the account supports Pages on private repos — otherwise leave it out and say so. Set Vite `base` from an env var so it works under `/montage/`. |
| `.github/pull_request_template.md` | Summary, tasks covered (T-IDs), verification evidence, checklist (typecheck/test/build/e2e, ownership respected). |
| `.github/ISSUE_TEMPLATE/bug.yml`, `feature.yml` | Bug: repro, expected/actual, dims/fps/length/photo count, Chrome version, evidence. Feature: problem, proposal. |
| `.github/dependabot.yml` | npm + github-actions, weekly, grouped minor/patch. |
| `LICENSE` | **Ask the user** (default: none while private). |

### 9.3 Issues, labels, milestones
- Labels: `wave-0`…`wave-3`, `task`, `bug`, `severity:blocker|major|minor`, `area:ingest|engine|render|export|ui|app|e2e`.
- Milestone `v1`.
- In wave 0 create one issue per task T1–T10 from the §5 table (title `T1: Ingest …`, body = owned
  paths + acceptance criteria, labels `task` + wave + area, milestone `v1`). Each wave PR body lists
  `Closes #…` for its tasks, so the project's progress is visible on GitHub.

### 9.4 Repo settings (after first push)
```
gh repo edit grahamlehr/montage --enable-squash-merge=false --enable-merge-commit \
  --enable-rebase-merge=false --delete-branch-on-merge --enable-issues --enable-wiki=false
```
Branch protection on `main` (require the `ci` check, no force-push) via `gh api` — this needs a
public repo or a paid plan on private repos. If the API refuses, skip it, tell the user, and rely on
the orchestrator rule "never merge with failing CI".

### 9.5 E2E in CI
- `ubuntu-latest` runners ship Google Chrome stable; use Playwright `channel: 'chrome'` and run
  under `xvfb-run` (headed) for WebGL. Upload `playwright-report/` and exported MP4s as artifacts on
  failure. Install ffmpeg with `apt-get` for ffprobe assertions.
- Linux Chrome may encode H.264 in software only; that's acceptable (it also exercises the fallback
  path). If the e2e job proves unreliable in CI, mark it `continue-on-error: true`, open an issue,
  and keep local `npm run test:e2e` as the gate. Don't block the whole project on it.
