# Montage

## What this is
Client-side web app: photos → MP4 montage (H.264 via WebCodecs + Mediabunny). Latest desktop Chrome only.
No backend; photos never leave the browser. Full spec: **PLAN.md** (§1 requirements, §2 architecture,
§3 contract, §4 behaviour, §5 tasks/acceptance, §8 orchestration).

## Stack
- React 19 + Zustand + Vite + TypeScript (strict), Vitest (unit), Playwright (e2e, installed Google Chrome), ESLint + Prettier.
- Mediabunny + WebCodecs for H.264 export; static site on GitHub Pages.

## Commands
| Task | Command |
|---|---|
| Install | `npm ci` |
| Dev | `npm run dev` (Vite dev server: app + harness pages, http://localhost:5173) |
| Build | `npm run build` (typecheck + production build) |
| Typecheck | `npm run typecheck` (`tsc -b`) |
| Test | `npm test` (Vitest unit tests, `src/**/*.test.ts`) |
| E2E | `npm run test:e2e` (Playwright in Google Chrome) |
| Lint / format | `npm run lint` / `npm run format` (ESLint / Prettier) |
| Fixtures | `npm run fixtures` (generate test photos into `fixtures/`) |
| Deploy | Merge to `main` runs `.github/workflows/pages.yml` and publishes `dist/` to GitHub Pages |

## Environments
| Env | URL / host | How to reach it | Notes |
|---|---|---|---|
| Local | `http://localhost:5173` | `npm run dev` | Harness pages at `/harness/<module>.html` |
| Staging | `<ask Graham>` | none known | Verify locally before merging |
| Prod | https://grahamlehr.github.io/montage/ | push to `main` (pages workflow) | **Protected**: public site, real users. Changes need Graham's explicit OK |

## Invariants
- TypeScript strict (`strict`, `noUncheckedIndexedAccess`); no `any` in exported signatures.
- **No `Math.random()` / `Date.now()` in `src/engine` or `src/render`** — use `src/lib/rng.ts`
  (`mulberry32`, `deriveSeed`, `pick`, `shuffle`). ESLint enforces this.
- `buildTimeline()` and `frameAt()` are pure and deterministic; the renderer only draws a `FrameDescriptor`.
- Every `VideoFrame` and `ImageBitmap` must be `.close()`d when no longer needed.
- `src/types.ts` is the shared contract and source of truth: import from it, never redefine its types.
- Harness pages for browser-only modules live at `harness/<module>.html` (served by `npm run dev` at
  `/harness/<module>.html`); they are excluded from the production build.
- Anything using the H.264 encoder must run in installed Google Chrome (Playwright `channel: 'chrome'`),
  never Playwright's bundled Chromium. Verify MP4s with `ffprobe`.
- Photos never leave the browser. Analytics (Google Analytics) loads only in production builds and only after cookie consent; never send file names or image data.
- Conventional Commits (`feat(engine): …`, `fix(export): …`, `chore: …`, `test: …`).
- Secrets live in `.env` (gitignored). Never commit, print or log them. This repo is **public**: nothing private goes in.

## Ownership
Agents may only create/edit files inside their owned paths. Only the orchestrator edits shared files
(`src/types.ts`, `src/lib/`, `package.json`, lockfile, configs, `.github/`, `AGENTS.md`, `README.md`),
installs dependencies, and runs `git`/`gh`. Need a change outside your paths? Put it under
CONTRACT REQUESTS in your report.

| Task | Owned paths |
|---|---|
| T0 (orchestrator) | root config, `src/types.ts`, `src/lib/`, `.github/`, docs |
| T1 Ingest | `src/ingest/`, `harness/ingest.*`, `scripts/make-fixtures.sh`, `fixtures/` |
| T2 Engine | `src/engine/` |
| T3 Renderer core | `src/render/` (except `transitions/`, `motion*`), `harness/render.*` |
| T4 Export | `src/export/`, `harness/export.*` |
| T5 Transitions + motion | `src/render/transitions/`, `src/render/motion*`, `harness/transitions.*` |
| T6 UI | `src/ui/`, `harness/ui.*` |
| T7 App integration | `src/app/`, `src/main.tsx` |
| T8 E2E | `tests/e2e/` |
| T9 Verification | read-only; writes `reports/`, `tmp/` |

## Doc map
- `PLAN.md`: the full spec and agreed plan
- `README.md`: user-facing overview and privacy notes
- `docs/UA_ONBOARDING.md`: onboarding guide (layers, key concepts, guided tour, hotspots), generated from the
  Understand-Anything graph; regenerate with `/understand` then `/understand-onboard`
- `docs/HANDOFF.md`: current state and the prompt for the next session (`/handoff`)
- `docs/DECISIONS.md`: decisions already made. Don't relitigate them.
- `docs/STATUS.md`, `docs/HISTORY.md`: status and field notes (create when needed)

## Definition of done
1. `npm run lint`, `npm run typecheck`, `npm test` and `npm run build` pass.
2. Docs touched by the change are updated in the same PR, including this file when commands, environments or conventions change.
3. The PR says where it was verified: local or prod.
4. Use `/ship` to commit and open the PR, and `/tidy` to clean up afterwards.
