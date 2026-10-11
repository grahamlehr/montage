# Wave 4 verification (T16): multi-photo shots

Branch `claude/multi-photo-shots` @ 1f938c4. Google Chrome 155 (Playwright `channel: 'chrome'`, headed), macOS, ffmpeg/ffprobe 8.1.1.
Evidence in `tmp/t16/` (gitignored). Run config `tmp/t16/playwright.config.ts` uses a private port (5191). See finding 1.

## Gates
- Existing suite (`E2E_FULL=1`, this branch's code): **10/10 pass**. Design load is 8.6 s.
- New specs: **9/9 pass**. `tsc -p tsconfig.node.json` and ESLint are clean on `tests/e2e`.

## Matrix
| Case | Result | Evidence |
|---|---|---|
| a. `'off'` identity vs main, 1280x720@30 10 s, 8 mixed photos (HEIC, EXIF, panorama), 4 transitions, motion 1; cover / contain / blur | **PASS**: 300/300 decoded frames framemd5-identical to main (PSNR = inf) for every fit. The preview canvas pixels match main at 0.6 / 3.1 / 7.4 s. | `grouping-off-identity.spec.ts` (needs `MONTAGE_MAIN_URL`), `tmp/t16/run-a.log` |
| b. `auto`, 1920x1080, 12 photos P P L repeating (incl. HEIC, EXIF-rotated) | **PASS**: 4 Duo brackets in the strip at the right positions. The label reads "8 shots". Timeline is duo/single x4 and keeps photo order. ffprobe: h264 1920x1080, 600 frames, 20.0 s. In every duo the centre gutter is background and both cells have content. | `tmp/t16/auto-1920x1080.{png,txt}` |
| c. `mixed` + stagger, all 5 layouts, 40 photos 60 s, 1080x1920 (seed 3) and 1920x1080 (seed 1) | **PASS**: every layout appears (portrait output: 9 duo / 1 trio / 1 quad / 1 pip / 1 polaroid; landscape output: 2/2/2/1/1). Cell 0 is never staggered and the label count matches. ffprobe: h264, 1800 frames, 60.0 s for both. | `tmp/t16/mixed-{1080x1920,1920x1080}.{png,txt}`, `tmp/t16/polaroid-*-hold.png`, `pip-landscape-hold.png`, `polaroid-aa-crop.png` |
| c'. Reveal smoothness (quad, cells 1..3) | **PASS**: monotonic ease-out over about 10 frames, 0.3 s step between cells | `tmp/t16/reveal/quad10-1920x1080-yavg.txt` |
| d. Inspector overrides (Keep solo / Join with next / chain to trio / grouping off) | **PASS**: strip, timeline and "N shots" label all update. The transition select is disabled on joined photos and shows "Joined with the previous photo". Join with next is disabled on the last photo. Grouping off ignores overrides. | `grouping-overrides.spec.ts` |
| e. 40 photos 3840x2160@30 30 s: off / mixed pool ['quad'] (6 quads of 22 shots) / all-quad via joinNext (10 quads) | **PASS**: no context loss, OOM or console errors. Wall time is 15.2 s / 15.3 s / 15.3 s (hardware encoder for all three), so grouping adds no measurable cost. Preview afterwards: 16 resident bitmaps, `contextLost: false`. | `tmp/t16/perf/summary.json`, `perf/quad-3840x2160.png` |

## Visual inspection
- Duo, trio and quad: the gutters are even and filled with the background colour. Trio hero is 58%. Nothing is stretched, and the cover crops show no background inside any cell.
- Pip: the inset is 34% of the short side, 4% from the edge, in the top-right corner, with a polaroid border and shadow.
- Polaroid: rotated edges are anti-aliased (an 8x crop shows a smooth gradient). Cards have a white border with a thicker bottom and a soft dark shadow. The pale blobs behind the cards are the blurred backdrop photo's digits, not an artifact.
- Transitions into and out of collage shots (crossfade, wipe, push, zoom, slide) look right. As specified, the incoming shot shows only cell 0 during the transition, and the remaining cells reveal afterwards.

## Findings (by severity)
1. **minor (test infra, not product), FIXED in b7cf42b**: `playwright.config.ts` uses `reuseExistingServer` on the fixed port :5173. When another worktree's dev server holds that port (here the leftover t15-ui server), `npm run test:e2e` silently tests that worktree's code. The first baseline run did exactly that, against t15-ui. **CONTRACT REQUEST (orchestrator):** make the port configurable (e.g. `E2E_PORT`) or set `reuseExistingServer: false`, and wire `MONTAGE_MAIN_URL` into CI if the identity spec should run there.
2. **cosmetic**: in the polaroid stack the cards overlap heavily, especially in portrait output, so only about 30-40% of the back cards shows (`tmp/t16/polaroid-portrait-hold.png`). The cause is the fan spread in `src/engine/layouts.ts`. Consider a wider spread.
3. **note**: while revealing, a staggered cell slides up by its 6% y-offset and briefly overlaps the area of the cell below it (a +0.3 luma bump in the neighbouring crop). This matches spec §4.7.5. It is not clipped to the rect, which is expected.
4. **note**: `auto` pairs the very first photo when both photo 1 and photo 2 are mismatched. The "first/last stay solo" rule applies only to `mixed`'s random groups (spec §4.7.1 step 3 runs before step 4). This is consistent with the spec.

No blocker or major product findings.

## Recommendation
**GO**: merge `claude/multi-photo-shots` to main. `'off'` is byte-identical to main, and auto, mixed, stagger, the overrides and 4K memory all pass. Finding 1 should be fixed in config but does not block.

## How to rerun
`npx playwright test` now starts its own server on port 5199 (`E2E_PORT` overrides it), and `E2E_REUSE_SERVER=1` opts in to reusing a running server. Add `E2E_FULL=1` for the design-load spec. For the identity spec, start a detached worktree of main with `npx vite --port 5174` and set `MONTAGE_MAIN_URL=http://localhost:5174`.

## Re-verification after merging main (b7cf42b, orchestrator)
`origin/main` at 7ea265b (seamless loop #26 and six transitions #27) was merged in. Looping is now per shot: the wrap goes from the last shot into shot 0, and a staggered shot 0 reveals its later cells after the seam.
- Unit: 222/222 pass. The loop tests are ported to shots: the v1 golden is compared through an adapter, and new seam-continuity tests cover auto/mixed × together/stagger. Typecheck 0 errors, lint clean.
- E2E (Chrome 155, port 5199, own server): 19/19 pass, including design load with `E2E_FULL=1` (8.6 s) and the loop seam spec.
- `'off'` identity vs new main (default `loop: true` on both sides): cover, contain and blur each have 300 frames, 0 differ, PSNR = inf.
- Perf at 3840×2160 with 40 photos: off 15.2 s, mixed quad 15.3 s, all-quad 15.3 s, hardware encoder, no context loss.

**GO** still stands.
