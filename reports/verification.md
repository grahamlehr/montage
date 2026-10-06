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
