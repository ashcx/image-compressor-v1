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
npm run test:browser       # assert the virtualized queue mounts a small window
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

## Scenarios

| Id | Format | Cohort(s) | Notes |
| --- | --- | --- | --- |
| `jpeg-photo` | JPEG q75 | photo | Native encode baseline. |
| `jpeg-photo-resize` | JPEG q75 | photo | Resize-aware path, max long edge 1024. |
| `webp-photo` | WebP q75 | photo | Native WebP, WASM fallback. |
| `png-screenshot` | PNG mode 0 | screenshot | Native lossless. |
| `png-screenshot-lossless` | PNG mode 1 | screenshot | `@jsquash/png` + oxipng. |
| `avif-photo` | AVIF q50 speed 8 | photo | WASM; capped at 25 files by default. |
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

The generator produces a bounded pool of unique images per cohort and reuses them
to reach the requested count, which keeps generation fast while still measuring
per-file processing cost.

## Metrics

- **First result** — injection → first row available to download.
- **Complete** — injection → every row settled (done or failed).
- **Estimate** — injection → compression triggered (batch estimation settled).
- **Long tasks** — `PerformanceObserver('longtask')` entries inside the run window.
- **Frame gap** — max / p95 gap between `requestAnimationFrame` callbacks.
- **Peak rows** — max job rows mounted in the DOM (virtualization check).
- **Busy/size** — sampled app worker meter (busy workers / pool size).
- **Heap** — peak `performance.memory.usedJSHeapSize` where available (Chromium).

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

`npm run test:browser` (`bench/virtual-check.mjs`) injects 1,000 files and
asserts that only the visible window plus overscan is mounted — at the top,
middle, and bottom of the scroll range — and that the window moves when
scrolling. It runs in CI so a virtualization regression fails the build.

## Limitations

- Headless Chromium only; Safari and Firefox are not exercised here.
- Synthetic fixtures cannot stand in for real photographs or malformed inputs.
- `performance.memory` and `longtask` are Chromium-specific; other engines report nulls,
  and `performance.memory` returns a near-constant figure in headless Chromium.
- Mobile worker budgets are policy, not measured on physical devices.
- The app retains every finished output Blob until Sprint 4 (PERF-10, OPFS output store);
  very large batches pay for that retained memory.
