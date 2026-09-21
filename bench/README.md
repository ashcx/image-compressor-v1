# Benchmark harness

Repeatable browser benchmarks for the production build, covering the metrics the
performance backlog asks for: time to first result, batch completion time, long
tasks, frame gaps, worker utilisation, and (where the browser exposes it) JS heap.

The harness drives the **built** app in headless Chromium with Playwright, so it
exercises the shipped decode → estimate → encode path rather than a mock. Nothing
is uploaded; fixtures are generated in-page and handed to the real file input.

## Running

```sh
npm run benchmark          # build + counts 25, 60 (default scenarios)
npm run benchmark:quick    # fast subset at 8 files
npm run benchmark:scale    # 500 and 1,000-file cohorts (jpeg/png/mixed)
npm run test:browser       # bounded row window + output download checks
node bench/repeat-check.mjs --iterations 6 --count 300         # leak diagnostic
node bench/repeat-check.mjs --iterations 6 --count 300 --clear # with clear between
node bench/preset-quality.mjs /path/to/photo.jpg               # PSNR + SSIM per preset
node bench/webp-compare.mjs /path/to/photo.jpg                 # native vs WASM WebP
npm run benchmark:preview -- --repeats 3                        # preview strategy matrix
```

Each scenario runs in a **fresh browser process**. Reusing one process across
runs caused retained memory (blobs, WASM heaps, terminated workers) to slow later
runs by up to ~2× and made large batches look super-linear. With isolation,
scaling is roughly linear and repeated runs agree.

Pass options through the script:

```sh
node bench/run.mjs --counts 25,60,240 --label baseline
node bench/run.mjs --counts 1000 --scenarios jpeg-photo,webp-photo --label large
node bench/run.mjs --seed 2 --headed       # watch the run
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--counts` | `25,60` | Comma-separated batch sizes. |
| `--scenarios` | all | Scenario ids to run (see below). |
| `--label` | `baseline` | Output file name in `bench/results/`. |
| `--seed` | `1` | Fixture seed; same seed ⇒ same images. |
| `--port` | `4317` | Preview server port. |
| `--timeout` | `240000` | Per-scenario timeout in ms. |
| `--headed` | off | Run a visible browser. |

Each run writes `bench/results/<label>.json` (machine-readable) and
`bench/results/<label>.md` (summary table). Commit a labelled baseline when you
change the app so future runs have a comparison point.

## Preset quality

`node bench/preset-quality.mjs <image>` encodes one image with the shipped
JPEG, WebP, AVIF, and HEIC quality presets and reports PSNR plus windowed
SSIM against the decoded source. It runs against the Vite dev server and uses
the app's own codec registry, so JPEG/WebP use the browser's native encoders
and AVIF/HEIC use the same WASM codecs the app ships. The measured table behind
the per-format preset values is in
[../docs/PERFORMANCE_AND_MEMORY.md](../docs/PERFORMANCE_AND_MEMORY.md).

## Scenarios

| Id | Format | Cohort(s) | Notes |
| --- | --- | --- | --- |
| `jpeg-photo` | JPEG q75 | photo | Native encode baseline. |
| `jpeg-photo-resize` | JPEG q75 | photo | Resize-aware path, max long edge 1024. |
| `webp-photo` | WebP q75 | photo | Native WebP, WASM fallback. |
| `jpeg-large` / `webp-large` | JPEG/WebP q75 | large-hires | High-resolution calibration. |
| `jpeg-large-noise` / `webp-large-noise` | JPEG/WebP q75 | large-noise | High-resolution high-frequency calibration. |
| `png-screenshot` | PNG mode 0 | screenshot | Native lossless. |
| `png-screenshot-lossless` | PNG mode 1 | screenshot | `@jsquash/png` + oxipng. |
| `avif-photo` | AVIF q50 speed 8 | photo | WASM; capped at 25 files by default. |
| `avif-large` / `avif-large-noise` | AVIF q50 speed 8 | large-hires / large-noise | High-resolution calibration; capped at 4 / 2 files. |
| `jpeg-mixed` | JPEG q75 | all cohorts | Representative batch content. |

## Fixture cohorts

Fixtures are generated deterministically in the browser (seeded PRNG) and encoded
with `canvas.toBlob`, so no binary corpus needs to be committed. Cohorts follow
the QA corpus definition in [../docs/TEST-MATRIX.md](../docs/TEST-MATRIX.md):

- **photo** — smooth gradients and translucent blobs (1600×1200 JPEG).
- **screenshot** — flat UI blocks and text lines (1440×900 PNG).
- **transparency** — alpha shapes on a transparent background (800×800 PNG).
- **noise** — per-pixel high-frequency content, the worst case for size (1200×1200 JPEG).
- **large** — 4000×3000 JPEG to exercise decode/resize and memory.
- **large-hires** — 6240×4160 JPEG with broad and fine detail to exercise high-resolution
  estimate calibration.
- **large-noise** — 6240×4160 per-pixel random JPEG to exercise worst-case output sizing.

The generator produces a bounded pool of unique images per cohort and reuses them
to reach the requested count, which keeps generation fast while still measuring
per-file processing cost.

## Native vs WASM WebP

`node bench/webp-compare.mjs <image>` decodes one input and sends identical pixels to
separate workers. It measures native `OffscreenCanvas.convertToBlob` and libwebp WASM
methods 0–6 at the requested quality. The WASM `medianMs` includes the canvas-to-
`ImageData` readback used by the app, while `medianEncodeMs` reports only the libwebp
portion. The first call is reported separately as `coldMs`, because it includes WASM
module initialization.

Use `--quality 75` and `--repeats 5` by default, or change them for a matched test. Compare
both median time and output bytes: a faster WASM method may use a different compression
trade-off and is not automatically equivalent to the browser's native output.

## Preview strategy comparison

`npm run benchmark:preview` uses the 25.9MP `test_pictures/IMG_1792.jpeg` fixture
and creates matching JPEG, PNG, WebP, AVIF, and HEIC source variants through the
app's codec registry. It compares:

- `current-jpeg` — the current bounded native decode followed by a fixed 96px JPEG.
- `small-bitmap-canvas` — native or fallback decode requested directly at the 96px
  display size, without JPEG encoding.
- `small-jpeg` — the same small decode followed by JPEG encoding.

The report includes cold and warm worker timings, output bytes, tracked RGBA raster
memory, a synthetic offscreen-scroll frame-gap probe, and Chromium page-heap samples
when available. The HEIC row is a codec-fallback test; the current WASM decoder does
not support reduced-size decode, so it reports the full decoded source surface even
when the requested display output is only 96px. This is a controlled microbenchmark,
not a claim about every browser or device.

## Metrics

- **First result** — injection → first row available to download.
- **Complete** — injection → every row settled (done or failed).
- **Estimate** — injection → compression triggered (batch estimation settled).
- **Long tasks** — `PerformanceObserver('longtask')` entries inside the run window.
- **Frame gap** — max / p95 gap between `requestAnimationFrame` callbacks.
- **Peak rows** — max job rows mounted in the DOM (virtualization check).
- **Busy/size** — sampled app worker meter (busy workers / pool size).
- **Heap** — peak `performance.memory.usedJSHeapSize` where available (Chromium).
- **Estimate ratio** — exact output bytes divided by the estimate captured immediately before
  compression; 1.0 is a perfect estimate.

## Baseline

`bench/results/baseline.{json,md}` is the recorded reference for 25 / 60 / 240
files. The 500 / 1,000-file cohorts are recorded in
`bench/results/scale-500-1000.{json,md}`. They are synthetic, headless
references, not device claims. Compare a new run against them by diffing the
JSON files or regenerating the Markdown table.

Absolute times vary across machines and invocations (the reference numbers were
taken on a shared VM), so compare counts **within a single run** and prefer
repeats or medians over cross-run ratios. The committed scale report shows
1,000 files at ~1.8–2.1× the 500-file time, i.e. roughly linear.

## Browser regression test

`npm run test:browser` builds the app and runs, in a real browser:

- `bench/virtual-check.mjs` injects 1,000 files and asserts that only the
  visible window plus overscan is mounted — at the top, middle, and bottom of
  the scroll range — and that the window moves when scrolling.
- `bench/output-check.mjs` compresses a file and downloads it, then downloads a
  batch as a ZIP, asserting both are non-empty (covers the OPFS output store).

Both run in CI so a virtualization or output-store regression fails the build.

## Leak diagnostic

`bench/repeat-check.mjs` runs several batches in one tab and reports JS heap and
DOM counts after forced GC, with per-run timing. Use `--clear` to clear the queue
between runs. It is a diagnostic, not a pass/fail test: absolute timings vary on
shared machines, but a rising per-run `elapsedMs` while heap stays flat points at
retained binary memory rather than a JS-heap leak.

## Limitations

- Headless Chromium only; Safari and Firefox are not exercised here.
- Synthetic fixtures cannot stand in for real photographs or malformed inputs.
- `performance.memory` and `longtask` are Chromium-specific; other engines report nulls,
  and `performance.memory` returns a near-constant figure in headless Chromium.
- Mobile worker budgets are policy, not measured on physical devices.
- When OPFS is unavailable, completed outputs fall back to bounded in-memory blobs; very
  large batches are then limited by the device output budget rather than the queue.
