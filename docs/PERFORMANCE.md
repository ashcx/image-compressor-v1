# Performance

This document records the measurements behind Image Compressor's speed-first design:
native browser encoding where practical, batch-level parallelism, bounded memory use,
and stored ZIP output. It also makes clear which figures are measured, derived, or still
only policy assumptions.

## Results at a glance

| Finding | Result | What it means |
| --- | --- | --- |
| JPEG native encode | **97 ms** for a 16.6 MP image at q75 | The fastest common path on the test machine |
| WebP native encode | **1223 ms** for a 16.6 MP image at q75 | Roughly **10–16×** slower than JPEG on the same pixels |
| AVIF encode | **~2–4 s** for an 8–16 MP image at q50 / speed 8 | Strong size potential, but materially slower |
| UI responsiveness | **0 long tasks** in 60- and 240-row scroll tests | Worker processing keeps list interaction responsive |
| Frame behaviour | Maximum gap **23 ms / 58 ms**; drift **5 ms / 23 ms** | Results for the 60- and 240-row tests respectively |
| Compute scaling | **~3.3–4×** across 4 cores for pure-compute work | Parallelism helps, but not linearly forever |
| Memory-bound scaling | About **~1.3×** at 4 workers on the test VM | Memory bandwidth becomes the bottleneck |
| Estimate accuracy | **11.8% median error**, **46% within ±10%** overall | Estimates are useful guidance, not guarantees |

The fastest-tool claim remains a product hypothesis until it is compared with competing web
tools using the same image sets, browsers, devices, and measurement rules.

## How the numbers were obtained

- **Measured:** a Linux x86-64 container, Node.js 22, headless Chrome driven via
  Playwright through the production codec path (`encodeImageSource` /
  `buildEstimateSamples`). Encode timings were taken after a warm-up pass and averaged over
  several runs.
- **Derived:** canvas memory is computed from `width × height × 4` bytes of RGBA plus the
  device worker policy in `src/lib/device.ts`.
- **Policy, not device-measured:** the iPhone, iPad, and Android worker budgets. No physical
  mobile devices were available for testing.
- **Not measured here:** thermal throttling, battery behaviour, Safari/JSC codec speed, and
  OS-level tab eviction.
- **Reproducibility:** these figures were captured with a temporary local measurement harness.
  The benchmark harness and 25-image fixture corpus are not currently checked into the
  repository, so the figures are documented evidence rather than CI-enforced regression
  thresholds.

Mobile memory figures are sizing rationale, not verified device limits.

## 1. Encoding strategy and cost

### Native-first codec selection

| Format | Encoder | When used |
| --- | --- | --- |
| JPEG | Native `OffscreenCanvas.convertToBlob` | Always in Chromium, Firefox, and Safari |
| WebP | Native, otherwise `@jsquash/webp` | Native where supported; WebAssembly fallback on Safari |
| PNG mode 0 | Native `convertToBlob` | Default fast lossless mode |
| PNG mode 1 | `@jsquash/png` + `@jsquash/oxipng` (level 0) | Opt-in lossless optimisation |
| PNG mode 2 | `imagequant` (256 colours) | Opt-in lossy palette mode |
| AVIF | `@jsquash/avif` | Always |

The application probes native support once per MIME type because Safari's
`convertToBlob` can silently return PNG for `image/webp`.

The Safari WebP fallback uses libwebp `method: 1`. It measured roughly **3× faster** than
the default method 4 for about **10% larger output**; method 3 was close to method 4.

AVIF and the compressed PNG modes are imported lazily, so the initial page load does not pay
their WebAssembly startup cost unless the user selects them. ZIP output uses `fflate` with
stored entries (`level: 0`) because the image payloads are already compressed.

### Native encode speed

Full-resolution measurements on the test machine:

| Setting | 2.7 MP | 8.6 MP | 16.6 MP |
| --- | ---: | ---: | ---: |
| JPEG q75 | 17 ms | 60 ms | 97 ms |
| WebP q75 | 175 ms | 940 ms | 1223 ms |

WebP's native encoder was roughly **10–16× slower** than JPEG on the same pixels, which is
why JPEG is the default output.

### Format cost and output size

Settings are defined in `src/lib/codecs/formats.ts`:

- **JPEG / WebP:** quality presets **94 / 85 / 75 / 50**, default 75.
- **PNG:** mode 0 native lossless, default; mode 1 lossless optimisation; mode 2
  256-colour quantisation.
- **AVIF:** quality **1–100**, default 50; speed **6 / 8 / 10**, default 8. Lower speed
  values produce smaller files but take longer.

Full-resolution results vary with content. These are representative measurements, not fixed
promises.

**3600 × 2400 photo (8.6 MP)**

| Setting | Time | Size |
| --- | ---: | ---: |
| JPEG q75 | 60 ms | 1.76 MB |
| JPEG q94 | 61 ms | 2.56 MB |
| WebP q75 | 940 ms | 1.42 MB |
| PNG mode 0 | 399 ms | 19.59 MB |
| PNG mode 1 | 1489 ms | 14.95 MB (−24%) |
| PNG mode 2 | 3548 ms | 5.63 MB (−71%) |
| AVIF q50 / speed 10 | 1200 ms | 0.92 MB |
| AVIF q50 / speed 8 | 4073 ms | 0.93 MB |
| AVIF q50 / speed 6 | 14318 ms | 0.97 MB |

**5000 × 3333 photo (16.6 MP)**

| Setting | Time | Size |
| --- | ---: | ---: |
| JPEG q75 | 97 ms | 0.74 MB |
| WebP q75 | 1223 ms | 0.32 MB |
| PNG mode 0 | 341 ms | 10.73 MB |
| PNG mode 1 | 2274 ms | 7.16 MB |
| PNG mode 2 | 4229 ms | 4.54 MB |
| AVIF q50 / speed 8 | 2007 ms | 0.14 MB |
| AVIF q50 / speed 6 | 11751 ms | 0.13 MB |

**1920 × 1200 screenshot (2.3 MP)**

| Setting | Time | Size |
| --- | ---: | ---: |
| JPEG q75 | 20 ms | 0.06 MB |
| WebP q75 | 158 ms | 0.02 MB |
| PNG mode 0 | 12 ms | 0.08 MB |
| PNG mode 1 | 300 ms | 0.03 MB |
| PNG mode 2 | 250 ms | 0.02 MB |
| AVIF q50 / speed 8 | 374 ms | 0.01 MB |

Practical reading: PNG mode 0 is essentially free; mode 1 is about **4–6×** and mode 2
about **10–14×** the time of mode 0. AVIF takes seconds per image, and speed 6 can be
several times slower than speed 8 for a small size gain. This is why the UI labels AVIF as
slower and warns about the slow preset. Output size depends strongly on image content, not
just resolution.

## 2. Parallelism and UI responsiveness

Image processing runs in a fixed-size `WorkerPool`; the UI thread owns state and presentation.

The UI's own list work is cheap — about **0.37 s of script time per 200 rows** — but codecs
are not. A single full-resolution AVIF encode at quality 50 / speed 8 takes **~2–4 s** for
an 8–16 MP image. Running that work on the UI thread would freeze the tab.

Moving decode, encode, and thumbnail work into workers produced the following scroll results
while processing:

- **60 and 240 rows:** **0 long tasks**.
- Maximum frame gap: **23 ms / 58 ms**.
- Cumulative drift: **5 ms / 23 ms**.

The two values in each pair correspond to the 60-row and 240-row tests.

Parallelism is batch-level — one image per worker — rather than intra-image threading, so no
`SharedArrayBuffer` or cross-origin isolation is required.

The pool is fixed and device-sized rather than one worker per image. Two queue tiers let
user-initiated compression preempt background estimates, queued tasks can be aborted, and
large payloads are materialised only just before dispatch.

Pure-compute worker jobs scaled **~3.3–4×** across 4 cores on the test VM. Memory-heavy
codec work reached only about **~1.3×** because aggregate memory bandwidth of **~3–5 GB/s**
did not scale with the number of workers. Adding workers therefore stops helping after a
point; the worker budget is a balance between throughput and responsiveness.

## 3. Memory and device policy

### Approximate memory per worker

- Decoded RGBA canvas = `W × H × 4`: 2.7 MP ≈ **11 MB**, 8.6 MP ≈ **35 MB**,
  16.6 MP ≈ **66 MB**, 26 MP ≈ **104 MB**.
- Estimate decode is capped at **2048 px** — about **11 MB** at 2048 × 1365 — plus
  the 384/896 sample canvases, which are under **5 MB**.
- The codec's WebAssembly heap is also material for AVIF, oxipng, and imagequant.
- The input buffer and output Blob add to the live working set.

### Techniques that keep memory bounded

- Fixed, bounded pool; never one worker per image.
- Heavy codecs run on half the pool, `max(1, round(base / 2))`, because each worker holds
  a large WASM heap and a full canvas for seconds.
- Zero-copy input transfer for one-shot compression. Cloning is used only when a later pass
  reuses the bytes. Removing input copies reduced JPEG time from roughly **35 ms to
  20.5 ms per image**.
- Lazy task materialisation so queued jobs do not hold buffers.
- Only the result crosses the worker boundary: a compact Blob plus metadata, never full
  ImageData.
- Thumbnails are generated in the worker at **96 px**; output object URLs are created lazily
  on download.
- Idle teardown terminates the worker pool and metadata worker about **two seconds** after
  becoming idle, and immediately on format change or clearing the list.
- Per-device ZIP size caps prevent buffering very large archives.

### Device worker scaling

Worker budgets are defined in `src/lib/device.ts`.

| Device | Light pool | Heavy pool | Maximum ZIP |
| --- | --- | --- | --- |
| iPhone (no RAM API) | cores ≥ 6 → 3, 4–5 → 2, otherwise 1 | 3→2, 2→1, 1→1 | 512 MB |
| iPad, reported cores < 7 | phone tier | halved | 1 GB |
| iPad, reported cores ≥ 7 | `min(cores − 1, 8)` | halved | 1 GB |
| Android, `deviceMemory` < 6 or unknown | **1** | 1 | 384 MB |
| Android, ≥ 6 GB | `min(cores − 1, 8)` | halved | 1 GB |
| Desktop, `deviceMemory` ≥ 8 | `min(cores − 1, 8)`; cores ≥ 16 and RAM ≥ 12 GB → up to **16** | halved | 2 GB |
| Desktop, `deviceMemory` < 8 | `min(cores − 1, 6)` | halved | 1 GB |
| `?workers=N` override | N capped at 16 | — | — |

In memory terms, for approximately 12 MP — about **48 MB decoded + ~15 MB estimate + heap
per worker**:

- iPhone at 3 light workers ≈ **~180 MB** live; heavy halving to 2 ≈ **~120 MB**.
  This is conservative because Safari exposes no RAM signal and iOS can evict a tab without
  warning.
- Low-RAM Android is pinned to **1** because Chrome on Android reclaims tabs aggressively;
  a second concurrent full canvas can be the difference between finishing and reloading.
- Desktop at 8 workers ≈ **~500 MB** plus WASM heaps at 12 MP, acceptable on an 8 GB+
  machine, with teardown once idle.
- The budget is always **cores − 1**, reserving a core for paint and input.

With 8 workers, an 8-image batch finishes in roughly the time of one image, while a
300-image batch runs in waves. On memory-bound work, speedup per added worker decays — about
**1.3× at 4 workers** on the test VM — so the budget is capped and heavy codecs are halved.

## 4. Estimate accuracy

Exact output sizes would require running the encoder, which would defeat the preview. Estimates
run the real codec on bounded samples instead.

Scaled decoding is not meaningfully cheaper than a full decode in Chrome:

- 2.5 MP: 512 px **27 ms** versus full **25 ms**.
- 16.6 MP: 512 px **137 ms** versus full **145 ms**.

The estimate decode cap is therefore **2048 px**, capped at the image's natural size, so
small images are never upscaled. The sample encodes are the real cost. Moving from 192/448
to 384/896 samples cost about **33 ms → 81 ms** per light image and improved median error
from about **25% → ~11%**. Larger samples — 512/1024 and 768/1792 — added little accuracy
for **30–200%** more time.

Measured against a real full-resolution encode on a 25-image corpus of photos from 0.3–26 MP,
plus screenshots, text, graphics, gradients, noise, and alpha:

| Target | Median error | Within ±10% |
| --- | ---: | ---: |
| WebP | 8.1% | 55% |
| PNG (modes 0/1/2) | 6–11% | 48–60% |
| JPEG | 13.2% | 37% |
| AVIF | 10.6–18.1% | 28–48% |
| All | 11.8% | 46% |
| Photos only | 10.7% | 48% |

Photographic content lands close to ±10%. Synthetic text and UI graphics remain the hardest
cases because a downscaled sample cannot fully reveal the high-frequency detail a
full-resolution encode will produce.

## 5. Measurement gaps and next benchmark

The following are not yet verified and should be covered before making a universal speed or
memory claim:

- Mobile worker counts and memory ceilings are sizing policy, not device-tested. Test an
  iPhone with 12 MP and 48 MP images, a mid-range Android, and an iPad Pro.
- Parallelism figures come from a shared Linux VM. A physical desktop with independent
  memory channels may scale better than the memory-bound ceiling observed here.
- Thermal throttling, battery impact, and Safari/JSC codec performance are untested.
- A competitor comparison needs identical input files, output settings, cold and warm runs,
  single-image and batch measurements, and the same definition of completion.

Until those checks are complete, the defensible message is that the application is designed
for high-throughput, local, parallel browser processing — not that it is proven fastest on
every device.
