# Montage verification (T9)

## Environment
- Google Chrome 153.0.8010.55 (headed, Playwright channel chrome), macOS 27.0.1 (26A434), ffmpeg/ffprobe 8.1.1
- Encoder: hardware (VideoToolbox) via prefer-hardware for every matrix case; software path forced with `--disable-accelerated-video-encode` (tmp/t9/sw.mjs)
- Dev server on :5190. Scripts and raw evidence in tmp/t9/ (meta.json per case, frames/, sheet-*.jpg, pvc/, valid.json, repeat.json, misc.json, edge.json)

## Gates
typecheck, unit tests (92), build, lint: all pass. `E2E_FULL=1 npm run test:e2e`: 7/7 pass (design-load 8.7 s).

## Matrix (all: h264 High yuv420p, one stream, frames = round(L*fps), duration within 1 frame, `ffmpeg -f null` decode clean)
| Case | Dims/fps/len/photos/fit | Result | Wall | encoderPath | codec | bytes | frames / dur |
|---|---|---|---|---|---|---|---|
| Design load | 1080x1920 30 60s 50 blur | PASS | 8.4 s | hardware | avc1.640028 | 38,612,054 | 1800 / 60.0 |
| Landscape | 1920x1080 60 30s 20 cover, intensity 1 | PASS | 8.2 s | hardware | avc1.64002a | 50,288,262 | 1800 / 30.0 |
| Odd ratio | 1234x778 25 20s 10 contain #336699 | PASS | 1.9 s | hardware | avc1.640020 | 5,069,713 | 500 / 20.0 |
| Tall | 720x2560 30 15s 8 cover, intensity 1, focus extremes | PASS | 2.3 s | hardware | avc1.640028 | 3,895,411 | 450 / 15.0 |
| Max | 4096x2160 30 20s 10 blur | PASS | 10.7 s | hardware | avc1.640034 | 26,417,989 | 600 / 20.0 |
| Max, transitionPool [blur] | same | PASS | 11.5 s | hardware | avc1.640034 | 37,069,763 | 600 / 20.0 |
| Stress pacing 0 | 1080x1920 10s 50 | validation error (expected), "at least 13 s" | - | - | - | - | - |
| Stress pacing 1 | same | validation error, "at least 79 s" | - | - | - | - | - |
| Boundary 13 s pacing 0 / 79 s pacing 1 | 50 photos | PASS both (2.4 s / 10.8 s) | | hardware | | | |
| All styles | 1080x1080 30 45s 22 blur, intensity 1, sequence | PASS; getTimeline() contains all 11 transitions and all 8 motions | 4.4 s | hardware | avc1.640020 | 14,884,651 | 1350 / 45.0 |
| Forced software: design / max | | PASS / PASS | 8.0 s / 9.7 s | software | avc1.640028 / .640034 | 40.6 MB / 37.1 MB | 1800 / 600 |

Contact sheets (photo midpoints + transition midpoints): tmp/t9/{design,landscape,odd,tall,max,maxblur,allstyles}/sheet-N.jpg (index in sheet-N.txt). Viewed design, odd, tall, allstyles: no black frames, EXIF-rotated shows TOP/arrow up, panorama and tiny.png not stretched, contain letterbox = #336699, transitions render as expected.

## Other checks
- Preview vs export (tmp/t9/*/pvc/prev-*.png vs exp-*.png, 12 times per case incl. transition midpoints, normalised MAE at 256x256): odd 0.8-1.2 %, tall 0.1-0.5 %, landscape 0.3-0.4 %, max 0.5-0.9 %, allstyles 0.8-3.5 % (push 3.5 %, slides 1.4-2 %); control (different time) 8-30 %. No content/position mismatch.
- Determinism: 5 exports of the same settings+seed gave byte-identical decoded streams (identical md5); an export during which settings were changed (fit, duration, size, seed) was also identical to the baseline.
- Cancel at 26 %: status cancelled, next export OK and identical md5; 5 rapid cancels fine.
- Memory over 5 repeated 50-photo exports: JS heap 72-74 MB flat, preview bitmaps/textures constant (4/4), Chrome total RSS 3.4 -> 3.27 GB, GPU 277 -> 278 MB. No growth. Note renderer-process RSS is ~2.1 GB at idle with 50 photos loaded (stable).
- Console errors / unhandled rejections / 4xx: none in any run.
- Responsiveness during design-load export: 0 rAF gaps > 50 ms, 0 long tasks, 2-rAF latency 20-31 ms. Preview playback rAF ~60 fps at 1080x1920, 1920x1080 and 4096x2160 (no gaps).
- Edge reveal: cover, intensity 1, magenta background, focus extremes, panorama/tiny/EXIF/HEIC, 4 sizes, every 4th frame border-scanned: 0 frames show background colour.
- Validation: 0 photos -> export disabled; 1 photo exports; widths typed 1235/1081/127/129 become 1236/1082/128/130; 5000->4096; 0/-4->128; heights likewise; duration 1->2, 601->600, 0->2; ratio 7:5, 16:9 ok, abc and 0:5 flagged invalid, extreme ratios clamp; aspect lock works. Exports at 128x128, 4096x128, 128x4096, 4096x2304, 2160x3840, 4096x2160@60, duration 2 s, duration 600 s (41 s wall) all pass ffprobe.

## Suspects
(a) CONFIRMED by code only: pipeline.ts `tried` is pushed but never used for a retry; `setup()` is called once, and an `encodeError` after configure just throws. Not reproduced at runtime (no way to inject a runtime hardware failure without modifying source).
(b) REFUTED: Max with blur transitions 11.5 s vs 10.7 s.
(c) REFUTED on this machine: 4096x2160 preview plays at ~59 fps with no gaps. Canvas is full output resolution (confirmed via getPreviewStats), may be heavier on weaker GPUs.
(d) CONFIRMED: see finding 2.
(e) CONFIRMED by code (renderer.ts blurredBackground is a per-photo cache drawn at scale 1, no transform); cosmetic.

## Findings
1. major - sizes above about 9.4 Mpx fail only after clicking Export (see final report).
2. minor - non-image files silently dropped.
3. minor - no runtime encoder fallback (a).
4. minor - pacing 1 makes the design-load photo count invalid (needs 79 s for 50 photos).
5. minor - blur-fit background static (e).
6. minor - encoderPath 'software' is reported for 'no-preference' too (code reading, not verified at runtime).
7. note - non-integer duration (2.5) accepted in the field.

---

# Re-verification (post-T10)

Branch HEAD 98cdef1 (commits for #19, #20, #21, #22 plus the R3 contract change). Chrome 153, same machine as T9. Scripts and evidence in tmp/t9b/ (cap.mjs/cap.json, retry.mjs, blur.mjs, runcase.mjs, newdims.mjs, lock.mjs, pvc.mjs, repeat.mjs, sw.mjs, misc.mjs, valid.mjs).

## Gates
typecheck pass; `npm test` 116/116 (12 files); build pass (only the chunk-size warning); lint clean; `E2E_FULL=1 npm run test:e2e` 10/10 pass (design-load 8.5 s, 4096x2304 export test 2.6 s).

## Issue status
- **#19 VERIFIED.**
  - Real-input sweep (tmp/t9b/cap.json, 2 lock states x 12 size pairs x 4 edits, 14 ratios x 3 widths, all 8 presets): 0 results with ceil(w/16)*ceil(h/16) > 36,864; 4096x4096 is unreachable via width/height fields (becomes 4096x2304 / 2304x4096), ratio field (1:1 gives 3072x3072, 16:9 gives 4096x2304, 4:3 gives 3540x2656, 7:5 gives 3628x2592), aspect lock (1:1 gives 3072x3072; 16:9 gives 4096x2304 or 4092x2304) and presets. The area-cap note shows ("Max 9.4 MP for H.264 in Chrome - height limited to 2304 / width limited to ... / size reduced to ... / this size is at the limit") and is absent for normal sizes.
  - Store-injected 4096x4096: Export disabled, reason shown: "4096x4096 is too large: Chrome's H.264 encoder supports at most 9.4 MP (for example 4096x2304 or 3072x3072). Choose a smaller size." (tmp/t9b/inject.png).
  - Exports pass ffprobe: 4096x2304@30 blur and cover (hardware), 3072x3072 blur (label "software": prefer-hardware is not supported at that size, still valid h264), 2304x4096 contain, 4096x2304@60 (avc1.64003c), 3840x2160@60, 4096x2160@60, 4096x128, 128x4096. Store-set 4096x4096 gets clamped to 4096x2304 and exports as that.
  - Presets unchanged (1080x1920, 1920x1080, 1080x1080, 1080x1350, 1440x1080, 1080x1440, 2560x1080, 1080x1620); none shows a note.
- **#20 VERIFIED.** not-an-image.txt shows "Skipped 1 file that isn't a supported image: not-an-image.txt" with a dismiss control (tmp/t9b/skipped.png).
- **#21 VERIFIED.** Harness export-fail-montage.worker.ts driven from tmp/t9b/retry.mjs, 8 real photos, 1080x1920@30, 8 s:
  | injected failures | outcome | encoderPath | restarts | ffprobe | decoded md5 |
  |---|---|---|---|---|---|
  | 0 | done | hardware | 0 | h264 1080x1920 240 frames 8.0 s | cebab733... |
  | 1 | done (retry from frame 0) | hardware | 1 | same | identical to baseline |
  | 2 | done | software | 2 | same | differs (software encoder, expected) |
  | 3 | error "Video encoder failed: Injected encoder failure" | - | - | - | - |
  Labels are sensible. Note: after one hardware failure the retry (no-preference) is labelled "hardware" because prefer-hardware is supported for the config; its md5 equals the baseline, so it did use the same encoder in practice.
- **#22 VERIFIED.** Blur-fit exports with motionIntensity 1, all 7 motions, focus extremes, panorama/tiny/EXIF/HEIC, 3 sizes, background magenta and black: every 2nd frame (540 frames x 6 exports) scanned along all four borders for background-colour pixels; 0 frames show any (tmp/t9b/blur/edge.json). Frames viewed (tmp/t9b/blur/strip.png): the blurred ghost of the digits in the backdrop zooms/pans with the photo; top-strip differences between frames within a photo grow smoothly (0.7 to 25 mean abs diff), so the backdrop moves. Cover and contain output byte-identical to T9 (see matrix).

## Matrix (all: h264 High, yuv420p, 1 stream, frames = round(L*fps), duration within 1 frame, `ffmpeg -f null` decode clean)
| Case | Dims/fps/len/photos/fit | Result | Wall (T9) | encoderPath | codec | bytes (T9) | frames / dur |
|---|---|---|---|---|---|---|---|
| Design load | 1080x1920 30 60s 50 blur | PASS | 8.4 s (8.4) | hardware | avc1.640028 | 40,292,184 (38,612,054) | 1800 / 60.0 |
| Landscape | 1920x1080 60 30s 20 cover, intensity 1 | PASS | 8.2 s (8.2) | hardware | avc1.64002a | 50,288,262 (identical) | 1800 / 30.0 |
| Odd ratio | 1234x778 25 20s 10 contain | PASS | 2.0 s (1.9) | hardware | avc1.640020 | 5,069,713 (identical) | 500 / 20.0 |
| Tall | 720x2560 30 15s 8 cover, focus extremes | PASS | 2.2 s (2.3) | hardware | avc1.640028 | 3,895,411 (identical) | 450 / 15.0 |
| Max | 4096x2160 30 20s 10 blur | PASS | 10.6 s (10.7) | hardware | avc1.640034 | 27,725,356 (26,417,989) | 600 / 20.0 |
| Max, transitionPool [blur] | same | PASS | 11.5 s (11.5) | hardware | avc1.640034 | 37,993,292 (37,069,763) | 600 / 20.0 |
| Stress pacing 0 / 1 (10 s, 50 photos) | | validation error as before ("at least 13 s" / "at least 79 s"), export disabled | - | - | - | - | - |
| Boundary 13 s p0 / 79 s p1 | 50 photos | PASS / PASS | 2.3 s / 10.8 s (2.4 / 10.8) | hardware | | | |
| All styles | 1080x1080 30 45s 22 blur, intensity 1 | PASS, all 11 transitions + 8 motions present | 4.4 s (4.4) | hardware | avc1.640020 | 15,107,343 (14,884,651) | 1350 / 45.0 |
| Forced software design / max | | PASS / PASS | 8.2 s / 10.1 s (8.0 / 9.7) | software | avc1.640028 / .640034 | 41.8 MB / 38.5 MB | 1800 / 600 |
| New: 4096x2304 @30 blur / cover | 6 s 10 photos | PASS / PASS | 3.6 s / 3.5 s | hardware | avc1.640034 | 9.2 MB / 10.4 MB | 180 |
| New: 3072x3072 @30 blur | 6 s | PASS | 4.1 s | software | avc1.640034 | 17.4 MB | 180 |
| New: 4096x2304 @60 cover | 4 s | PASS | 4.6 s | hardware | avc1.64003c | 13.1 MB | 240 |
Byte differences from T9 only where fit is blur (expected: the backdrop now moves); cover/contain files are byte-identical. Walls within noise of T9. Duration 2 s / 600 s (38.9 s wall) / 2160x3840 / 4096x2160@60 also re-pass.

## Other re-checks
- Preview vs export (normalised MAE at 256x256, 6 photo + 6 transition times per case): odd 0.79-1.21 %, tall 0.06-0.46 %, landscape 0.25-0.42 %, max (blur) 0.50-0.91 %, allstyles 0.81-3.49 %, design (blur) 0.88-1.18 %; controls 5.7-30 %. Same as T9, no preview/export mismatch for the new blur backdrop (side-by-side tmp/t9b/cmp-design.png).
- Determinism: 5 repeated exports have identical decoded md5; export during setting changes and the export after cancel are also identical to the baseline.
- Memory over 5 repeated 50-photo exports: JS heap 72 MB flat (102 MB on the first run), textures/bitmaps constant (4/4, 1 blur cache), Chrome total RSS 2947 to 2976 MB, GPU 252 to 258 MB. No growth. Cancel works, 5 rapid cancels fine.
- Responsiveness during export: 0 rAF gaps, 0 long tasks; preview 59-60 fps at 4096x2160.
- Console errors: none in the app runs (the harness page logged one 404 resource load, not the app).

## New findings
1. minor - aspect lock drifts after the cap/even-rounding kicks in. With lock on and 16:9: width 4096 gives 4096x2304, then width 2000 gives 2000x1126, then width 4096 gives 4092x2304 (not exactly 16:9; 1:1 locks do not drift). The ratio is taken from the current rounded dimensions, so repeated edits walk the ratio. Repro: tmp/t9b/lock.mjs. Expected: lock should hold the original ratio. Owning path: src/ui/logic.ts (lockedDims / applySettingsPatchDetailed). Not a blocker; likely pre-existing rounding behaviour made more visible by the cap.
2. note - the encoderPath for 3072x3072 is "software" while 4096x2304 is "hardware" on this machine: prefer-hardware is unsupported at 3072x3072 here, so this is correct reporting, only slower in principle (4.1 s for 6 s of video, fine).
3. note (cosmetic, not a defect) - blur backdrop shows a slightly lighter band at the extreme edge, which is the source photo's own white border blurred, not a reveal.

No blocker or major findings. v1.0.0 can proceed from the verification side.
