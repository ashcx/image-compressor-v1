# Client-Side Parallel Image Compressor — Product Design Document

**Status:** Draft
**Owner:** (you)
**Target hosting:** GitHub Pages (static, no backend)

---

## 1. Summary

A browser-based tool that compresses and converts images (JPEG, PNG, WebP, AVIF)
entirely client-side — no server, no upload, no backend. Users drop in one or many images,
pick an output format and quality, and the tool processes them in parallel across CPU cores
using a Web Worker pool wrapping `jsquash` WASM codecs. Results are downloadable individually
or as a zip.

**Core constraint:** must run unmodified on GitHub Pages — no custom HTTP headers, no server
logic, no build step beyond static asset generation.

---

## 2. Goals

- Convert between JPEG, PNG, WebP, and AVIF, client-side, in-browser.
- Process a batch of images with true multi-image parallelism (one image per worker,
  many workers running concurrently).
- Work on desktop, tablet, and phone browsers (Chrome, Firefox, Safari — recent versions).
- Zero backend. Deployable as static files to GitHub Pages with no header configuration.
- No hard file-size or resolution limit beyond what the user's own device/browser memory
  allows.
- Batch download as a single zip.

## 3. Non-Goals

- **In-image thread parallelism.** We are explicitly not pursuing SharedArrayBuffer /
  COOP-COEP / pthread-based WASM (e.g. wasm-vips). Each image is encoded single-threaded;
  parallelism comes from running many images at once. This was a deliberate decision — see
  Appendix A for the reasoning.
- **Server-side fallback.** If a browser can't run WASM or Workers (essentially unheard of
  in any browser from the last ~6 years), we degrade to "doesn't work," not "falls back to
  a server."
- **Editing features** (crop, rotate, filters) — out of scope for v1. Resize (via
  `@jsquash/resize`) is in scope since it's commonly paired with compression.
- **Account systems, history, cloud sync** — none of this is a backend-having product.

---

## 4. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                      Main Thread (UI)                    │
│                                                            │
│  Drag/drop zone → Job Queue → Worker Pool Manager         │
│                                     │                      │
│                                     ▼                      │
│              ┌──────────┬──────────┬──────────┐          │
│              │ Worker 1 │ Worker 2 │ Worker N │  (N ≈     │
│              │          │          │          │  hardware │
│              │ jsquash  │ jsquash  │ jsquash  │  concurr.)│
│              │ codec(s) │ codec(s) │ codec(s) │          │
│              └──────────┴──────────┴──────────┘          │
│                                     │                      │
│                                     ▼                      │
│                  Results collector → Zip (JSZip) →         │
│                  Progress UI → Download                    │
└─────────────────────────────────────────────────────────┘
```

- **No SharedArrayBuffer, no COOP/COEP, no service-worker header spoofing.** Each worker is
  a normal, isolated Web Worker. Data moves between main thread and workers via
  `postMessage` with `Transferable` `ArrayBuffer`s (not copied).
- **Codecs load on demand.** A worker only imports the WASM module for the format it's
  currently asked to encode/decode, not all formats up front.
- **Static hosting only.** Build output is plain HTML/CSS/JS/WASM files; GitHub Pages serves
  them with correct default MIME types (including `application/wasm`), no custom
  configuration required.

---

## 5. Tech Stack

Crystallized before implementation (Sprint 1). Chosen for a small, compute-offloaded,
static-hosted tool.

| Concern | Choice | Notes |
|---|---|---|
| Language | TypeScript (strict) | Shared message types for the worker protocol in §6 |
| UI framework | Preact + `@preact/signals` (`@preact/preset-vite`) | ~4 KB runtime, TSX; signals update individual progress rows without re-rendering the batch list |
| Codecs | `@jsquash/jpeg` (MozJPEG), `@jsquash/webp`, `@jsquash/avif`, `@jsquash/png`, `@jsquash/oxipng`, `@jsquash/resize` | All WASM, browser + worker targeted |
| Bundler | Vite | Handles WASM asset copying; requires `optimizeDeps.exclude` for jsquash (below) |
| Parallelism | Native `Worker` API, `type: 'module'` | No threading libraries needed |
| Zipping | `fflate` | Client-side, no server round-trip. Lighter and faster than JSZip (~12 KB gzip vs ~28 KB); chosen now, used from Sprint 7. |
| Lint / format | Biome | One fast tool for both; minimal config |
| Testing | Vitest (unit) + Playwright (browser/e2e, later sprints) | Vitest reuses the Vite config; Playwright covers cross-browser and worker behavior |
| Package manager | npm | Lockfile committed; zero extra CI setup |
| Hosting/CI | GitHub Pages + GitHub Actions | PR CI runs lint/typecheck/test/build; `main` deploys `dist/` |

**Codec adapter.** Codecs sit behind a small `Codec` interface plus a registry that
`import()`s each format lazily (`src/lib/codecs/`). Core and UI never import `@jsquash/*`
directly. This keeps unused formats out of the initial bundle (per-format lazy loading),
makes codecs mockable in unit tests, and turns a future HEIC (v1.1) or `wasm-vips` swap into
a registry entry rather than a rewrite.

**Size estimation (hybrid).** While the quality slider moves, the UI shows an instant rough
estimate. Once per file, the worker encodes two downscaled copies (~192px and ~448px long
edge) at several quality points, fits a power law `bytes ≈ k · pixels^β` per quality (clamped
to `β ∈ [0.35, 0.8]`), and extrapolates to the full resolution; a calibration constant
corrects the residual bias. Encoded size does not scale linearly with pixel count, so this
beats a naive thumbnail × pixel-ratio model. The full-resolution encode then runs (debounced)
and replaces the estimate with the exact size.

**UI framework rationale.** The UI is a small stateful list (per-file status/progress) plus
a settings form, not a content site. Preact + signals covers this with a tiny runtime and
fine-grained updates; plain DOM would require hand-rolled list reconciliation, React adds
weight for no benefit, and Svelte was the runner-up but adds a different component
paradigm for marginal gain.

**Known Vite/jsquash constraint.** jsquash WASM modules break under Vite's dependency
pre-bundler; the fix (documented by the jSquash maintainers) is to exclude them:

```ts
optimizeDeps: { exclude: ['@jsquash/avif', '@jsquash/jpeg', '@jsquash/png', '@jsquash/webp'] }
```

Note: `@jsquash/avif` and `@jsquash/oxipng` ship nested workers that hit a
Vite production-build bug; if this surfaces in Sprint 6, use their
`*-single-thread-only` builds.

### 5.1 Project layout

```
index.html            # Vite entry
vite.config.ts        # base path + jsquash optimizeDeps excludes
src/
  main.tsx            # app mount
  App.tsx             # shell (drag/drop, settings, results)
  lib/
    codecs/           # Codec interface + lazy format registry
    convert.ts        # decode -> encode orchestration (worker-side)
    image.ts          # decode / downscale (worker-safe: OffscreenCanvas)
    estimate.ts       # thumbnail quality-curve size estimate
    workerClient.ts   # processImage() facade over the pool
    workerPool.ts     # fixed-size worker pool + FIFO queue + fault isolation
    protocol.ts       # shared worker message types
    format.ts         # size/name helpers
  workers/            # worker scripts (image-worker.ts)
public/               # static assets (.nojekyll)
```

---

## 6. Worker Message Protocol

A simple request/response contract between the main thread and a worker. Implemented in
`src/lib/protocol.ts`. Each job is self-contained (it carries its own `fileBuffer`) so it
can be handed to any worker in the pool without shared state.

**Main → Worker**
```ts
{
  type: 'process',
  jobId: string,
  fileBuffer: ArrayBuffer,   // transferred, not copied
  targetFormat: 'jpeg' | 'png' | 'webp' | 'avif',
  quality?: number,          // encoder-specific
  buildEstimate?: boolean    // if true, also return the size-estimate curve
  // resize?: { width?: number; height?: number }  // Sprint 6
}
```

**Worker → Main**
```ts
{
  type: 'result' | 'error',
  jobId: string,

  // on result (transferred back where applicable):
  outputBuffer?: ArrayBuffer,
  outputSize?: number,
  width?: number,
  height?: number,
  format?: 'jpeg' | 'png' | 'webp' | 'avif',
  extension?: string,
  mimeType?: string,
  samples?: Array<{ quality: number; bytes: number }>,  // when buildEstimate

  // on error:
  error?: string
}
```

`sourceFormat` is deliberately not part of the request: the worker decodes with
`createImageBitmap`, which sniffs the container itself. A `progress` message is reserved for
Sprint 4 (batch progress).

Design intent: **one bad file should never take down a worker or stall the queue.** All
codec calls inside the worker are wrapped in try/catch; failures are reported per-job, and
the pool manager immediately assigns the next job to that worker.

---

## 7. Phased Delivery Plan

Each phase has an explicit **Definition of Done** — a phase isn't "finished" until its
listed results are demonstrably true, not just implemented.

### Phase 0 — Environment & Hello World
**Goal:** Prove the toolchain works before writing any real logic.

**Work:**
- Scaffold Vite project.
- Add one `jsquash` package (`@jsquash/webp` is a good first pick).
- Set `base: '/<repo-name>/'` in `vite.config.js`.
- Add `.nojekyll` to repo root.
- Write minimal GitHub Actions workflow: build → deploy to Pages.

**Definition of Done:**
- A trivial static page is live at `https://<username>.github.io/<repo>/`.
- No 404s in the browser console for any asset (this catches the base-path issue early).

---

### Phase 1 — Single Image, Main Thread, No Workers Yet
**Goal:** Confirm jsquash itself works correctly before adding any concurrency complexity.

**Work:**
- File input (or drag-drop of exactly one file).
- Decode the file, re-encode to a chosen format at a chosen quality, all on the main thread.
- Display before/after file size and a download link.

**Definition of Done:**
- One JPEG → WebP conversion round-trips correctly and visibly shrinks file size.
- Confirmed working in Chrome, Firefox, and Safari (desktop) at minimum.
- Any Vite/jsquash bundling quirks (e.g. `optimizeDeps.exclude` for `@jsquash/png`) are
  identified and fixed here, not later.

**Why this phase exists:** if something's broken, you want to know whether it's "jsquash"
or "my worker pool" — this phase isolates the former.

---

### Phase 2 — Move Codec Work Into a Single Worker
**Goal:** Get codec execution off the main thread, still one file at a time.

**Work:**
- Create a dedicated worker script implementing the message protocol in §6.
- Main thread posts one job, waits for one result, no queue yet.
- Confirm `Transferable` objects are actually being transferred, not copied (check via
  `ArrayBuffer.byteLength === 0` on the sender's side post-transfer, or DevTools memory
  profiling).

**Definition of Done:**
- UI remains responsive (no jank/freeze) during a large/slow encode (e.g. a high-res AVIF
  encode), proving the work is genuinely off the main thread.
- Same conversion correctness as Phase 1, now via a worker.

---

### Phase 3 — Worker Pool + Job Queue (the actual parallelism)
**Goal:** Multiple images processed simultaneously across multiple workers.

**Work:**
- Pool manager: spawn `N = navigator.hardwareConcurrency || 4` workers (cap at a sane
  max, e.g. 8, regardless of core count — see §9 risk notes on memory).
- Job queue: FIFO list of pending files; each idle worker pulls the next job on completion.
- Multi-file drag-and-drop / multi-select input.
- Per-file and overall progress UI.

**Definition of Done:**
- Dropping 20+ images results in multiple workers visibly active concurrently (check
  DevTools' Performance tab or a simple in-UI "workers busy: X/N" indicator).
- Total wall-clock time for a batch is measurably lower than sequential processing of the
  same batch on the same machine (this is your actual proof the parallelism is working —
  measure it, don't assume it).
- A single corrupted/unsupported file does not stop the rest of the batch from completing.

---

### Phase 4 — Format-Specific Correctness & Options
**Goal:** All five formats work correctly with sensible per-format options exposed.

**Work:**
- Per-format quality controls (JPEG/WebP/AVIF quality sliders; PNG via `oxipng` effort
  level).
- Optional resize step (`@jsquash/resize`) before encode.
- Format auto-detection from file signature, not just file extension.

**Definition of Done:**
- Every supported input format can be converted to every supported output format at least
  once, verified visually and by file size, in a manual test pass.
- Quality slider changes produce visibly different output sizes/quality (sanity check that
  options are actually wired through to the codec, not silently ignored).

---

### Phase 5 — Batch Output & Download
**Goal:** Get results out of the browser in a usable form.

**Work:**
- Zip all results with `JSZip`, trigger download.
- (Optional, Chromium-only) File System Access API to write outputs back to a chosen
  folder directly, with a zip fallback for Safari/Firefox.

**Definition of Done:**
- A batch of N images produces one zip containing N correctly-named, correctly-converted
  files.
- Fallback path (zip download) works on Safari and Firefox, not just Chrome.

---

### Phase 6 — Cross-Device Validation
**Goal:** Confirm the "phone, tablet, desktop" requirement, not just assume it.

**Work:**
- Manual test pass on: one Android phone, one iOS device, one tablet, plus desktop
  Chrome/Firefox/Safari.
- Note actual wall-clock performance differences between device classes — this
  informs whether you need a "reduce quality/threads on mobile" fallback.

**Definition of Done:**
- The app loads and successfully processes at least one image on every listed device.
- Any device-specific breakage (memory limits, worker count too high, WASM feature gaps)
  is documented, even if not fixed in v1.

---

### Phase 7 (Optional / Future) — Polish
Not required for a functioning v1, but natural next steps:
- Persist last-used settings (in-memory or via `window.storage` if built as a Claude
  artifact rather than a standalone site — plain `localStorage` if standalone).
- Drag-reorder or per-file override of output settings within a batch.
- Visual before/after comparison slider per image.
- Revisit Jpegli if/when a browser-ready WASM build becomes available (see Appendix B).

---

### Phase 8 — v1.1: HEIC Preview (post-v1.0)

**Status: Deferred — NOT part of v1.0.** The first version of this project ships without
HEIC support. This phase is documented so the design intent and library choices are
captured; it is explicitly **not** required for the initial release.

**Goal:** Add HEIC as a clearly-labeled **preview** feature once v1.0 is stable. Decode and
encode deliberately use different libraries:

| Direction | Library | Rationale |
|---|---|---|
| **Decode** (HEIC → RGBA) | `libheif-js` | Mature, decoder-focused Emscripten build of libheif. Single-threaded (no SharedArrayBuffer / COOP-COEP), so it stays GitHub-Pages-deployable. LGPL-3.0. |
| **Encode** (RGBA → HEIC) | `elheif` | The only browser-capable package found that HEIC-encodes (libheif + libde265 for decode, **kvazaar** for HEVC encode). Self-contained ESM bundle with embedded WASM (~1.5 MB). MIT wrapper; bundles LGPL components (libheif, libde265, kvazaar). |

**Why preview, not full support:**
- `elheif` is v0.1.0 (single release, June 2024) with a dormant repo — treat as experimental.
- `elheif`'s encode API is `jsEncodeImage(rgba, width, height)` with **no quality/effort
  parameter**, so HEIC encode cannot honor the per-format quality controls required by
  Phase 4; output is fixed-quality.
- kvazaar is a real but simpler HEVC encoder than x265 — expect different size/quality
  behavior than Apple-generated HEIC.
- HEVC/HEIC is patent-encumbered and the bundled components are LGPL; revisit licensing
  before ever promoting HEIC out of preview.

**Work (when picked up):**
- Add `'heic'` to the format unions in §6 (a v1.1 protocol change — the v1.0 unions stay
  unchanged) and detect it from the ISO-BMFF `ftyp` box (`heic`/`heix`/`mif1`), not the
  file extension.
- Lazy-load both libraries only when a HEIC job arrives. `elheif`'s entrypoint statically
  imports its WASM, so it must be reached via a dynamic `import()` inside the worker to
  preserve the on-demand codec loading principle in §4.
- Decode path: `libheif-js` RGBA → existing `@jsquash/resize` + encoders.
- Encode path: existing decoders → RGBA → `elheif`.
- Both directions run inside the existing worker pool; the queue design in §6/§7 is unchanged.

**Definition of Done (relaxed — this is preview):**
- At least one real iPhone HEIC file decodes correctly via `libheif-js`.
- At least one RGBA image encodes via `elheif` to a HEIC that re-opens in a known-good viewer.
- The UI clearly labels HEIC as **Preview / unstable**, and a HEIC failure degrades
  gracefully (per-job error, batch continues) per §6.
- HEIC is excluded from the Phase 4 "every format → every format" matrix.

---

## 8. Explicit Non-Goals Recap (so scope doesn't creep)

- No SharedArrayBuffer / COOP-COEP — if a future phase seems to need this, that's a sign
  scope has drifted back toward "in-image parallelism," which was deliberately rejected.
- No server component of any kind, ever, in this project.
- No accounts, history, or analytics beyond what's needed for local debugging.

---

## 9. Risks & Open Questions

| Risk | Notes |
|---|---|
| Over-parallelizing on mobile | High worker counts + memory-hungry AVIF WASM instances could thrash on phones. Cap worker count; consider lowering it further on detected low-core-count devices. |
| Vite/jsquash bundler friction | Documented issue with wasm-pack-generated glue code; needs `optimizeDeps.exclude` for at least `@jsquash/png`. Budget time for this in Phase 0/1, not as a surprise later. |
| GitHub Pages base-path bugs | Works locally, breaks on deploy if `base` isn't set correctly. Catch this in Phase 0. |
| Safari/iOS quirks | Historically the least predictable target for WASM + Worker combos. Don't assume desktop testing generalizes — Phase 6 exists specifically to catch this. |
| AVIF encode speed | It is CPU-heavy regardless of parallelism; large batches in this format may be slow even with a full worker pool. Set realistic user expectations in the UI (progress bar, estimated time) rather than over-promising speed. |
| jsquash lacks Jpegli | Currently only MozJPEG is available via jsquash for JPEG output. Jpegli is a possible future upgrade but isn't a ready-made drop-in today (see Appendix B). |

---

## 10. Competitive Landscape (Prior Art)

Desktop research into existing **free, web-based** tools performing similar or adjacent
tasks (client-side batch image compression/conversion). Filtered to tools that are (a) free,
(b) support batch processing across multiple images, and (c) support conversion across
multiple file formats — matching this project's stated requirements. Scope, open-source
status, and architecture are stated explicitly since several of these are small/personal
projects rather than established products, and their concurrency model is often unclear
from public documentation.

| Tool | Scope | Open Source | Parallelism model (as documented) | Formats | Notes vs. our design |
|---|---|---|---|---|---|
| **Squoosh** (official, squoosh.app) | Single-image compressor/converter | Yes (Apache-2.0, GoogleChromeLabs) | N/A — no batch support at all | JPEG, PNG, WebP, AVIF | The reference implementation for the codecs we're using, but doesn't meet the "batch" requirement out of the box. CLI/library maintenance was deprioritized in 2023; the hosted web app continues to be supported. |
| **Allless/compressor** ("Lessly") | Small hobby/indie in-browser utility | Yes (public GitHub repo) | Not documented — README describes "drop images → compress → download/zip" with no mention of a worker pool or concurrency count | JPEG, PNG, WebP, AVIF, HEIC, GIF | Closest in stack to our design (jsquash + Preact + Vite + client-zip). Broader format support (HEIC, GIF) than our v1 scope. No stated resize step yet (on their own roadmap). Whether batch is processed in parallel or sequentially isn't stated — this is exactly the ambiguity our Phase 3 "Definition of Done" (measured wall-clock speedup) is designed to avoid leaving unverified. |
| **reserban/filefork** | Broad multi-media tool (images, video, audio, PDF) | Yes (public GitHub repo, states "Open source") | Not documented for images specifically; video/audio explicitly use FFmpeg WASM, images use "canvas-based encoders" (not clearly jsquash) | Images: JPG/PNG/WebP/AVIF/GIF/HEIC/TIFF/BMP/SVG, plus video/audio/PDF | Much larger scope than our project (video, audio, PDF). Batch + ZIP for up to 500 files claimed. Because it spans several media types, its per-image parallelism strategy isn't a focus of its own documentation. |
| **david02324/webtools** | Small SEO-oriented multi-page tool site (format converters + metadata analyzer) | Yes (public GitHub repo) | Explicitly states conversion "runs in **a** Web Worker" (singular) using jsquash | WebP, AVIF (conversion targets); broader read support | Batch + ZIP supported, but the singular-worker phrasing suggests one job processed at a time rather than a sized worker pool — i.e., background-thread-safe, but not necessarily multi-image-parallel in the way our design specifies. |
| **coda1997/WebPify** | Single-format converter (WebP only) | Yes (public GitHub repo) | Explicitly "a dedicated Web Worker" (singular) | WebP only | No batch/multi-format conversion — doesn't meet two of the three filter criteria. Included for architecture comparison only: confirms the "single worker, not a pool" pattern is common even in 2025-era hobby projects. |
| **Zapixal** (via dev.to writeup) | Personal project, blog-announced | Not stated/unclear | "Web Workers" (plural) mentioned generally; no explicit worker-pool/job-queue design described | HEIC, PNG, JPG, WebP, AVIF | Meets the batch + multi-format + free criteria on paper, but there's no public repo link confirmed in what I found, and no architecture detail beyond "Web Workers" — can't verify the parallelism claim beyond the author's description. |
| **z0b1/starconvert** | Media converter (images + video audio extraction) | Yes (public GitHub repo) | Uses `SharedArrayBuffer`-dependent WASM (ffmpeg.wasm), requiring COOP/COEP headers — the exact complexity our design deliberately avoided (see Appendix A) | HEIC, JPEG, PNG, WebP (+ MP4 audio extraction) | Notable as a real-world example of the header-dependent approach requiring active server configuration (their README explicitly walks through setting COOP/COEP in `next.config.js`) — this isn't GitHub-Pages-deployable without extra tooling, unlike our design. |
| **Bulk Resize Photos** (bulkresizephotos.com) | Established consumer product (browser extension + web tool) | No — proprietary | Not documented; likely sequential given quoted throughput (~150 photos/minute ≈ 2.5 images/sec, not obviously parallel-across-cores) | Resize + format/quality conversion | The most mature/polished of the tools found, with real user base (10k+ extension installs). Closed-source, so implementation can't be verified either way — included as the "best established competitor" benchmark rather than an architectural reference. |
| **Mass Image Compressor** | Native Windows desktop app (not web-based) | Yes, per listing | Advertised "fast parallel encoding" (native, not WASM) | JPEG, PNG, WebP, AVIF, **Jpegli** | Doesn't meet the "web-based" filter, included for context since it already ships the Jpegli support flagged as a future upgrade in Appendix B. Native parallelism will outperform any WASM-based approach, consistent with the Caesium comparison. |

### Takeaways for this project

1. **No tool found clearly documents a sized worker-pool architecture with verified
   multi-image concurrency.** Most either process one job at a time in a single worker
   (webtools, WebPify), don't document their concurrency model at all (Lessly's compressor,
   filefork, Zapixal), or sidestep the question by using a different, header-dependent
   threading model entirely (starconvert). This means our Phase 3 requirement — a job queue
   feeding a pool sized to `hardwareConcurrency`, with concurrency *measured*, not assumed —
   is a genuine differentiator, not a redundant reimplementation.
2. **Format scope is generally similar or broader** in existing tools (several support HEIC
   and GIF, which our v1 doesn't). Worth considering folding HEIC support in, given it's
   clearly a common, expected format in this space.
3. **The GitHub-Pages-with-no-header-tricks constraint is not universal** among comparable
   projects — starconvert explicitly requires COOP/COEP server configuration, meaning it
   couldn't be deployed as-is to plain GitHub Pages the way our design is scoped to be.
4. **None of the open-source options found are large or heavily maintained** — these are
   small hobby/indie projects (low star counts, single-maintainer READMEs), not
   competing-at-scale products. The realistic frame of reference remains the desktop tools
   from the earlier comparison (Caesium, Mass Image Compressor) for raw performance, with
   this web-tool category being comparatively immature and fragmented.

---

## Appendix A — Why Not In-Image Threading (wasm-vips)

Considered and rejected for this project. Reasons:
- Requires `SharedArrayBuffer`, which requires COOP/COEP headers — not natively supported
  by GitHub Pages, requiring a service-worker workaround (`coi-serviceworker`) to spoof
  headers client-side.
- Real-world reports show integration friction with modern bundlers (Vite) and the
  underlying library documents itself as "still under early development."
- The most successful, widely-used precedent (Squoosh itself) deliberately avoids this
  approach, using one-codec-per-worker instead — a strong signal that the simpler
  architecture is the actually-proven one.
- Our per-image parallelism target doesn't need in-image threading to be satisfied.

## Appendix B — Jpegli Status

Google's Jpegli JPEG encoder (announced April 2024) outperforms MozJPEG in independent
human-rated comparisons at comparable quality, while remaining a standard, fully
interoperable JPEG file. However, no browser-ready WASM package (e.g. a `jsquash`-style
npm package) was found to exist as of this writing — it currently lives as a C++ library
intended for native/server use. Adopting it here would
require compiling it to WASM in-house (via Emscripten), which is materially more work than
using the existing `@jsquash/jpeg` (MozJPEG) package. Treated as a future upgrade path, not
a v1 requirement.
