# QA corpus and release matrix

This is the QA-01 reference for the fixtures, browsers, and validation tools used
to release Image Compressor. It defines *what* is tested; the automated harness in
[`bench/`](../bench/README.md) is one consumer of it.

## Test corpus

The corpus is defined by cohort and count. Fixtures are generated deterministically
(seeded) from the same cohort descriptions the benchmark uses, so a given seed and
count always produce the same images. Input fixtures are JPEG, PNG, and WebP.
AVIF/HEIC decoding fixtures are produced by the encoder under test and validated
with the tools below.

| Cohort | Content | Dimensions | Input type | What it exercises |
| --- | --- | --- | --- | --- |
| photo | Gradients, blobs, mild noise | 1600×1200 | JPEG | Realistic photographic encode + estimate. |
| screenshot | Flat UI, text lines | 1440×900 | PNG | Lossless modes, palette quantisation. |
| transparency | Alpha shapes | 800×800 | PNG | Alpha flattening in thumbnails. |
| noise | Per-pixel random | 1200×1200 | JPEG | Worst-case output size. |
| large | Wide gradient + blocks | 4000×3000 | JPEG | Decode/resize memory, resize-aware decode. |
| orientation | EXIF-oriented photo | 1200×1600 | JPEG/HEIC | Orientation handling. |
| malformed | Truncated / bad magic bytes | — | mixed | Intake guards and error rows. |
| duplicate | Same basename, two folders | — | mixed | ZIP/folder name collisions. |

### Batch sizes

Run the benchmark at **25, 60, 240, 500, and 1000** files. The committed baseline
covers 25 / 60 / 240; 500 / 1000 are run on demand (`--counts 500,1000`) before a
release because they are slow.

### Malformed and adversarial inputs

- Truncated header and truncated pixel data for each format.
- Valid magic bytes with impossible dimensions (0, 1, huge).
- Mismatched extension vs magic bytes (e.g. `.png` containing JPEG).
- For HEIC: multi-image files, unsupported HEVC profiles, and oversized `ispe`.

No input may crash the app or stop unrelated batch jobs; failures must appear as
per-row errors with a clear message.

## Supported browser / device matrix

The matrix mirrors the target set in [ARCHITECTURE.md](./ARCHITECTURE.md). Test the
production build (GitHub Pages), not just the dev server.

| Platform | Representative | Required checks |
| --- | --- | --- |
| Desktop Chromium | Chrome / Edge, latest stable | All formats, 1000-file batch, OPFS zip, folder save. |
| Desktop Firefox | Firefox, latest stable | All formats except AVIF/HEIC native encode fallbacks. |
| Desktop Safari | Safari, current major | WebP WASM fallback, HEIC native decode path. |
| iPad | iPadOS Safari, current | Portrait + landscape layout, touch targets, memory budget. |
| iPhone | iOS Safari, current | Phone worker budget, sticky actions, no tab eviction. |
| Android | Chrome on mid-range device | Conservative workers, low-memory fallback. |

## Output validation

Independent validation avoids "it opens in the same tool that wrote it" bias.

| Format | Tool |
| --- | --- |
| JPEG / PNG / WebP | `file`, `identify` (ImageMagick), browser re-open. |
| AVIF | `avifdec` / `ffprobe`, browser re-open. |
| HEIC | `heif-convert` (libheif) and macOS Preview / `sips`. |
| ZIP | `unzip -t`, plus per-entry size/name checks. |

Validated properties: reported dimensions, orientation, colour profile, alpha
policy, and that the bytes decode without error in an independent decoder.

## Release checklist

- [ ] `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` pass.
- [ ] `npm run benchmark` against the release build; compare to the committed baseline.
- [ ] Corpus cohorts run through every enabled output format.
- [ ] Malformed and adversarial inputs produce row-level errors only.
- [ ] Duplicate filenames remain distinct in ZIP and folder save.
- [ ] Storage cleanup leaves no stale object URLs or OPFS files.
- [ ] Browser matrix smoke-tested on the deployed build.
- [ ] Mobile budgets re-checked on a physical iPhone and Android device.
