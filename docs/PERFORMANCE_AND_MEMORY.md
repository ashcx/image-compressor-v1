# Performance and memory

This document records the measurements and policy behind Image Compressor's speed-first
design: native browser encoding where practical, batch-level parallelism, decoded-canvas
memory limits, and stored ZIP output. It also makes clear which figures are measured,
derived, or still only policy assumptions.

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

## Why parallel scaling matters

Many current desktops, tablets, and phones expose **6–8 logical cores**. A sequential image
tool leaves most of that capacity unused. Image Compressor schedules independent images across
a bounded worker pool, targeting **cores − 1** for light work so one core remains available
for painting and input. High-memory desktops can use up to **16** workers; heavy codecs use
half the light-worker budget because each worker consumes more memory.

The practical result is that an 8-image batch can finish in roughly the time of one image when
the workload is compute-bound. The test VM achieved **~3.3–4×** scaling across 4 cores for
pure-compute jobs. Memory-heavy work reached about **~1.3×** because aggregate memory
bandwidth — roughly **3–5 GB/s** on that VM — became the bottleneck. Scaling is therefore a
real advantage, but it is not unlimited: adding workers past the device's useful capacity can
increase contention, memory pressure, and thermal load.

## Measurement basis

- Encode times were measured on a Linux x86-64 environment using Node.js 22 and headless
  Chrome after a warm-up pass. Memory figures are derived from RGBA canvas size and the device
  policy in `src/lib/device.ts`.
- iPhone, iPad, and Android worker budgets are policy choices, not physical-device
  measurements. Thermal throttling, battery behaviour, Safari/JSC speed, and OS tab eviction
  are outside this data set.
- The benchmark harness and deterministic fixture generator now live in
  [`bench/`](../bench/README.md), with a committed reference run in
  `bench/results/baseline.{json,md}`. They are still a synthetic, headless
  reference, not CI-enforced thresholds; gates are defined in Sprint 9.

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

- **JPEG:** quality presets **94 / 85 / 75 / 50**, default 75.
- **WebP:** quality presets **98 / 92 / 85 / 70**, default 85. These are tuned separately
  from JPEG — see [Quality presets and measured fidelity](#quality-presets-and-measured-fidelity).
- **HEIC:** quality presets **80 / 58 / 51 / 43**, default 51; a single `ultrafast` speed
  preset.
- **PNG:** mode 0 native lossless, default; mode 1 lossless optimisation; mode 2
  256-colour quantisation.
- **AVIF:** quality presets **95 / 85 / 75 / 58**, default 75; speed **10 / 8 / 6**,
  default 10. Slower speeds produce smaller files but take much longer.

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

### Quality presets and measured fidelity

Each lossy format exposes four labels (Best / Better / Default / Low), but the number behind
a label is format-specific because the scales are not comparable. libheif maps HEIC quality
straight onto a HEVC QP, and WebP and AVIF use 0–100 scales that run well below JPEG's.
Reusing the JPEG numbers made HEIC produce much larger files than JPEG at "Default" and made
WebP visibly lower quality at the same label.

| Label | JPEG | WebP | AVIF | HEIC (QP) |
| --- | ---: | ---: | ---: | ---: |
| Best | 94 | 98 | 95 | 80 (10) |
| Better | 85 | 92 | 85 | 58 (21) |
| Default | 75 | 85 | 75 | 51 (25) |
| Low | 50 | 70 | 58 | 43 (29) |

Measured on a 26 MP photograph — Chrome's native JPEG/WebP encoders, the app's `@jsquash/avif`
WASM encoder, and libheif + kvazaar `ultrafast` for HEIC — against the decoded source. SSIM
uses 8×8 windows over luma:

| Label | JPEG PSNR / SSIM / size | WebP PSNR / SSIM / size | AVIF PSNR / SSIM / size | HEIC PSNR / SSIM / size |
| --- | --- | --- | --- | --- |
| Best | 53.4 dB / 0.997 / 4.28 MB | 47.8 dB / 0.992 / 4.84 MB | 49.2 dB / 0.994 / 4.45 MB | 50.8 dB / 0.997 / 4.89 MB |
| Better | 45.3 dB / 0.984 / 2.92 MB | 44.7 dB / 0.981 / 2.59 MB | 45.1 dB / 0.981 / 2.08 MB | 45.9 dB / 0.987 / 2.16 MB |
| Default | 42.6 dB / 0.969 / 1.69 MB | 41.9 dB / 0.960 / 1.36 MB | 42.4 dB / 0.964 / 1.09 MB | 42.4 dB / 0.967 / 1.18 MB |
| Low | 39.9 dB / 0.947 / 0.89 MB | 39.7 dB / 0.936 / 0.60 MB | 39.9 dB / 0.937 / 0.43 MB | 40.1 dB / 0.942 / 0.53 MB |

SSIM bands: **≥ 0.99** near-lossless, **0.98–0.99** very good, **0.95–0.98** good (artifacts
possible on close inspection), **0.90–0.95** visibly compressed, **< 0.90** poor. "Low" is
therefore the deliberately visible tier, "Default" is good but not fully transparent, and
"Best" is near-lossless. At matched labels AVIF, HEIC, and WebP land close to JPEG in PSNR
while producing **25–50% smaller** files, which is the intent of the per-format values; their
SSIM runs a little below JPEG's because the reference is itself a JPEG that JPEG re-encodes
most faithfully.

These are single-photo figures with a JPEG-derived reference, which flatters JPEG at the top
end. WebP and AVIF are tuned to stop short of their near-lossless cliffs (WebP 100 and
AVIF 100), which multiply file size for little visible gain. WebP's lossy mode also tops out
around 48 dB (quality 99), so its Best trails the other formats and quality 100 would jump to
a lossless file. Safari's `@jsquash/webp` fallback is slower and roughly 10% larger than the
native WebP numbers. Treat these as calibration anchors, not device guarantees. Regenerate
with `node bench/preset-quality.mjs /path/to/photo.jpg`.

## 2. Parallelism and UI responsiveness

Image processing runs in a fixed-size `WorkerPool`; the UI thread owns state and presentation.

The UI's own list work is cheap — about **0.37 s of script time per 200 rows** — but codecs
are not. A single full-resolution AVIF encode at its default quality and speed takes
**~2–4 s** for an 8–16 MP image. Running that work on the UI thread would freeze the tab.

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

### Decoded memory model

- A decoded RGBA canvas costs `W × H × 4`: 2.7 MP ≈ **11 MB**, 8.6 MP ≈ **35 MB**,
  16.6 MP ≈ **66 MB**, 26 MP ≈ **104 MB**, 100 MP ≈ **400 MB**.
- Each codec path holds several copies at peak. Scheduling charges a multiplier of the RGBA
  size (`src/lib/memory.ts`):

  | Path | Weight |
  | --- | ---: |
  | Native JPEG / PNG mode 0 | 2.5 |
  | WebP (native on Chromium/Firefox, WASM on Safari) | 4 |
  | AVIF, PNG modes 1–2 | 5 |

- Estimate decodes are capped at **2048 px** (~11 MB at 2048 × 1365) plus the 384/896 sample
  canvases, which are under **5 MB**. The compressed input buffer and output Blob also count
  against the live working set.

### Browser canvas ceilings

The decoder output must fit the engine's maximum canvas. These limits are read from engine
source, not only from test tables:

| Engine / platform | Max side | Max area |
| --- | ---: | ---: |
| WebKit iOS/iPadOS, Safari ≥ 17.4 | 8,192 | 67,108,864 (8192²) |
| WebKit iOS/iPadOS, before 17.4 | 4,096 | 16,777,216 (4096²) |
| Blink (Chrome/Edge/Opera, Android) | 65,535 | 268,435,456 (`32768 × 8192`) |
| Gecko (Firefox) | 32,767 | none |
| WebKit macOS Safari | 16,384 | 268,435,456 (16384²) |
| Unknown | 8,192 | 67,108,864 (8192²) |

iOS raised its limit to **8192 per axis** in Safari 17.4 (WebKit bug 271002); older iOS is
detected from the UA `OS`/`Version` token and clamped to 4096. Every decode is scaled down to
satisfy both the side and area ceilings, and never upscaled. The app also applies a universal
**100 MP working-resolution cap** before these platform and memory limits. The effective decode
size is therefore the most restrictive of the 100 MP cap, the browser canvas ceiling, and the
device/codec memory budget. When a clamp applies, the worker reports it; the row shows the
original and decoded dimensions plus **"downscaled for device safety"**, and the app displays a
plain-language notice explaining why.

A 200 MP source is therefore reduced to at most 100 MP while preserving its aspect ratio when
the browser supports bounded image decoding. If a browser cannot perform that bounded decode and
the source exceeds the safety limits, the app fails that image with an explanatory error rather
than silently retrying at full resolution. A full-resolution fallback remains available only
when the source is already within the applicable safety limits.

### Decoded-memory budget and scheduling

Concurrent jobs are admitted against a device memory ceiling. A job is charged
`decodePixels × 4 × weight`; the pool admits the highest-priority job whose cost still fits
`activeCost + cost ≤ budget` and always admits at least one job. The scheduler lives in
`src/lib/workerPool.ts`; budgets and weights come from `src/lib/device.ts` and
`src/lib/memory.ts`.

| Device | Canvas memory budget |
| --- | ---: |
| iPhone | 512 MiB |
| iPad, light worker count ≥ 6 | 1 GiB |
| iPad, light worker count < 6 | 512 MiB |
| Android, `deviceMemory ≥ 8 GiB` | `deviceMemory / 6` |
| Android, otherwise / no signal | 512 MiB |
| Desktop | `deviceMemory / 2`; 2048 MiB fallback |

The single-job ceiling `maxJobPixels = 0.9 × budget / (4 × weight)` keeps one oversized image
from exceeding the budget on its own, so the "always admit one" rule cannot blow the ceiling.
On iOS/iPadOS, heavy codecs are pinned to **one worker on iPhone and non-Pro iPads** because
even one heavy encode can exhaust their canvas memory; Pro-class iPads (light worker count
≥ 6) use the normal halved pool and rely on the decoded-memory gate to bound concurrency.

This is the device-level model: iOS/iPadOS canvas memory scales with RAM (WebKit's
`ramSize() / 4`, reported into the JSC heap), and OS Jetsam can evict a tab before any
in-page limit is reached. The budgets above are therefore deliberately below the raw
ceiling.

### Device worker scaling

Worker budgets are defined in `src/lib/device.ts`.

| Device | Light pool | Heavy pool | App ZIP cap |
| --- | --- | --- | --- |
| iPhone (no RAM API) | cores ≥ 6 → 3, 4–5 → 2, otherwise 1 | 1 | 512 MB |
| iPad, reported cores < 7 | phone tier | 1 | 1 GB |
| iPad, reported cores ≥ 7 | `min(cores − 1, 8)` | halved | 1 GB |
| Android, `deviceMemory` < 6 or unknown | **2** | 1 | 384 MB |
| Android, ≥ 6 GB | `min(cores − 1, 8)` | halved | 1 GB |
| Desktop, `deviceMemory` ≥ 8 | `min(cores − 1, 8)`; cores ≥ 16 and RAM ≥ 12 GB → up to **16** | halved | 2 GB |
| Desktop, `deviceMemory` < 8 | `min(cores − 1, 6)` | halved | 1 GB |
| `?workers=N` override | N capped at 16 | — | — |

iPad is treated as Pro when its light worker count is **≥ 6** (7+ reported cores); that tier
gets the 1 GiB budget and can run about four 25 MP JPEGs concurrently.

These ZIP values are **conservative application caps**, not browser or device maximums. A
mobile browser may be able to create a larger archive, especially when the Origin Private
File System (OPFS) is available and the device has sufficient free storage. The practical
limit varies with browser quota, free disk space, memory pressure, and whether the app falls
back to holding the archive in JavaScript memory. The caps should therefore be treated as
initial safety policy and revisited after real-device ZIP testing.

In memory terms, for approximately 12 MP — about **48 MB decoded + ~15 MB estimate + heap
per worker**:

- iPhone at 3 light workers ≈ **~180 MB** live; heavy work is pinned to 1 worker. This is
  conservative because Safari exposes no RAM signal and iOS can evict a tab without warning.
- Budget Android at **2** light workers ≈ **~120 MB** live for JPEG, while heavy codecs
  collapse to a single worker.
- Desktop at 8 workers ≈ **~500 MB** plus WASM heaps at 12 MP, with teardown once idle. The
  budget is proportional to `deviceMemory`.
- The light budget is always **cores − 1**, reserving a core for paint and input.

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
small images are never upscaled. The sample encodes are the real cost. Ordinary images use
384/896 samples; images that reach the 2048 px estimate decode cap use 512/1536 samples so
high-resolution photographs retain more detail. The larger window is limited to those images
to avoid adding cost to ordinary inputs.

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
