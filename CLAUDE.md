# Montage — agent guide

Client-side web app: photos → MP4 montage (H.264 via WebCodecs + Mediabunny). Latest desktop Chrome only.
No backend; photos never leave the browser. Full spec: **PLAN.md** (§1 requirements, §2 architecture,
§3 contract, §4 behaviour, §5 tasks/acceptance, §8 orchestration).

## Conventions
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
- Conventional Commits (`feat(engine): …`, `fix(export): …`, `chore: …`, `test: …`).

## Scripts
| Command | What |
|---|---|
| `npm run dev` | Vite dev server (app + harness pages) |
| `npm run build` | Typecheck + production build |
| `npm run typecheck` | `tsc -b` |
| `npm test` | Vitest unit tests (`src/**/*.test.ts`) |
| `npm run test:e2e` | Playwright e2e in Google Chrome |
| `npm run lint` / `npm run format` | ESLint / Prettier |
| `npm run fixtures` | Generate test photos into `fixtures/` |

## Ownership
Agents may only create/edit files inside their owned paths. Only the orchestrator edits shared files
(`src/types.ts`, `src/lib/`, `package.json`, lockfile, configs, `.github/`, `CLAUDE.md`, `README.md`),
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
