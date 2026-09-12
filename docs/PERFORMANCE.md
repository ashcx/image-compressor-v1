# Performance

This document expands the "Performance position" section of the
[Architecture overview](./ARCHITECTURE.md) with the measurements behind the
project's main engineering choices: why work runs in Web Workers, when native
encoders are used instead of WebAssembly, what each output format costs, and how
the worker budget is scaled to device memory.

## How the numbers were obtained

- **Measured:** a Linux x86-64 container, Node.js 22, headless Chrome driven via
  Playwright through the production codec path (`encodeImageSource` /
  `buildEstimateSamples`). Encode timings are taken after a warm-up pass and
  averaged over several runs.
- **Derived:** canvas memory is computed from `width × height × 4` bytes of RGBA
  plus the device worker policy in `src/lib/device.ts`.
- **Policy, not device-measured:** the iPhone, iPad, and Android worker budgets.
  No physical mobile devices were available for testing.
- **Not measured here:** thermal throttling, battery behaviour, Safari/JSC
  codec speed, and OS-level tab eviction.

Treat mobile memory figures as sizing rationale, not verified device limits.

## Why Web Workers

Image processing runs in a fixed-size `WorkerPool`; the UI thread only owns
state and presentation.

- The UI's own list work is cheap (**~0.37 s of script time per 200 rows**), but
  codecs are not: a single full-resolution AVIF encode at quality 50 / speed 8
  is **~2–4 s for an 8–16 MP image** (see [Format cost](#format-cost-and-output-size)).
  Running that on the UI thread would freeze the tab.
- With decode, encode, and thumbnail work moved into workers, scroll tests at
  **60 and 240 rows** recorded **0 long tasks, a maximum frame gap of 23 ms /
  58 ms, and cumulative drift of 5 ms / 23 ms**. The list stays interactive
  during a batch.

Parallelism here is **batch-level** (one image per worker), not intra-image
threading, so no `SharedArrayBuffer` or cross-origin isolation is required.

The pool is a fixed, device-sized set of workers rather than one worker per
image, so a large drop cannot spawn an unbounded number of isolates. Two queue
tiers let user-initiated compression preempt background estimates, tasks can be
aborted while queued, and large payloads are materialized lazily just before
dispatch.

## Native-first encoding, WebAssembly where necessary

| format | encoder | when |
| --- | --- | --- |
| JPEG | native `OffscreenCanvas.convertToBlob` | always (Chromium/Firefox/Safari) |
| WebP | native, else `@jsquash/webp` | native where supported; WASM fallback on Safari |
| PNG mode 0 | native `convertToBlob` | default |
| PNG mode 1 | `@jsquash/png` + `@jsquash/oxipng` (level 0) | opt-in |
| PNG mode 2 | `imagequant` (256 colours) | opt-in |
| AVIF | `@jsquash/avif` | always |

- Native support is **probed once per MIME type** because Safari's
  `convertToBlob` silently returns PNG for `image/webp`.
- The Safari WebP fallback uses libwebp **`method: 1`**, measured at roughly
  **3× faster than the default method 4 for ~10 % larger output** (method 3 is
  close to method 4).
- AVIF and the compressed PNG modes are imported lazily, so first load does not
  pay their WebAssembly startup unless the user selects them.
- ZIP uses `fflate` with **stored** entries (`level: 0`), because the payloads
  are already compressed and re-deflating costs CPU for negligible gain.

Native encode speed on the test machine (full-resolution):

| setting | 2.7 MP | 8.6 MP | 16.6 MP |
| --- | --- | --- | --- |
| JPEG q75 | 17 ms | 60 ms | 97 ms |
| WebP q75 | 175 ms | 940 ms | 1223 ms |

WebP's native encoder is **roughly 10–16× slower than JPEG** on the same pixels,
which is why JPEG is the default output.

## Format cost and output size

Settings are defined in `src/lib/codecs/formats.ts`:

- **JPEG / WebP** — quality presets **94 / 85 / 75 / 50** (default 75).
- **PNG** — mode 0 native lossless (default); mode 1 lossless optimisation;
  mode 2 256-colour quantisation.
- **AVIF** — quality **1–100** (default 50), speed **6 / 8 / 10** (default 8;
  lower is smaller and slower).

Full-resolution results vary with content. Representative measurements:

**3600 × 2400 photo (8.6 MP)**

| setting | time | size |
| --- | --- | --- |
| JPEG q75 | 60 ms | 1.76 MB |
| JPEG q94 | 61 ms | 2.56 MB |
| WebP q75 | 940 ms | 1.42 MB |
| PNG mode 0 | 399 ms | 19.59 MB |
| PNG mode 1 | 1489 ms | 14.95 MB (−24 %) |
| PNG mode 2 | 3548 ms | 5.63 MB (−71 %) |
| AVIF q50 / speed 10 | 1200 ms | 0.92 MB |
| AVIF q50 / speed 8 | 4073 ms | 0.93 MB |
| AVIF q50 / speed 6 | 14318 ms | 0.97 MB |

**5000 × 3333 photo (16.6 MP)**

| setting | time | size |
| --- | --- | --- |
| JPEG q75 | 97 ms | 0.74 MB |
| WebP q75 | 1223 ms | 0.32 MB |
| PNG mode 0 | 341 ms | 10.73 MB |
| PNG mode 1 | 2274 ms | 7.16 MB |
| PNG mode 2 | 4229 ms | 4.54 MB |
| AVIF q50 / speed 8 | 2007 ms | 0.14 MB |
| AVIF q50 / speed 6 | 11751 ms | 0.13 MB |

**1920 × 1200 screenshot (2.3 MP)**

| setting | time | size |
| --- | --- | --- |
| JPEG q75 | 20 ms | 0.06 MB |
| WebP q75 | 158 ms | 0.02 MB |
| PNG mode 0 | 12 ms | 0.08 MB |
| PNG mode 1 | 300 ms | 0.03 MB |
| PNG mode 2 | 250 ms | 0.02 MB |
| AVIF q50 / speed 8 | 374 ms | 0.01 MB |

Practical reading: PNG mode 0 is essentially free; mode 1 is ~4–6× and mode 2
~10–14× mode 0. AVIF is seconds per image, and speed 6 can be several times
slower than speed 8 for a small size gain — hence the "AVIF (slower)" label and
the slow-preset warning. Output size depends strongly on image content, not just
resolution.

## Memory efficiency across parallel workers

Approximate live memory per worker:

- Decoded **RGBA canvas** = `W × H × 4`: 2.7 MP ≈ 11 MB, 8.6 MP ≈ 35 MB,
  16.6 MP ≈ 66 MB, 26 MP ≈ 104 MB.
- Estimate decode canvas capped at **2048 px** (≈ 11 MB at 2048 × 1365) plus the
  small 384/896 sample canvases (< 5 MB).
- The codec's WebAssembly heap (material for AVIF, oxipng, and imagequant).
- The input buffer (transferred) and the output `Blob`.

Techniques that keep this bounded:

- **Fixed, bounded pool** — never one worker per image.
- **Heavy codecs run on half the pool** (`max(1, round(base / 2))`) because each
  worker holds a large WASM heap and a full canvas for seconds.
- **Zero-copy transfer** of input buffers for one-shot compression; cloning only
  when a later pass reuses the same bytes. Removing input copies reduced JPEG
  time from roughly **35 ms to 20.5 ms per image**.
- **Lazy materialization** of task payloads so queued jobs do not hold buffers.
- **Only the result crosses the worker boundary** — a compact `Blob` plus
  metadata, never full `ImageData`.
- **Thumbnails are generated in the worker** at 96 px, and output object URLs are
  created lazily on download.
- **Idle teardown**: the worker pool and metadata worker are terminated about two
  seconds after going idle (and immediately on format change or clearing the
  list), releasing WASM heaps and canvases.
- **Per-device ZIP size caps** prevent buffering very large archives.

The limiting resource is often **memory bandwidth**, not RAM or cores. On the
test VM, pure-compute worker jobs scaled **~3.3–4×** across 4 cores, but
memory-heavy codec work capped at **~1.3×**, because aggregate bandwidth
(**~3–5 GB/s, non-scaling**) saturates before the cores do. This is why adding
workers stops helping past a point, and why the UI can still feel strained under
a large batch even though its own script time is small.

## Device worker scaling

Worker budgets are chosen in `src/lib/device.ts`.

| device | light pool | heavy pool | max ZIP |
| --- | --- | --- | --- |
| iPhone (no RAM API) | cores ≥ 6 → 3, 4–5 → 2, else 1 | 3→2, 2→1, 1→1 | 512 MB |
| iPad, reported cores < 7 | phone tier | halved | 1 GB |
| iPad, reported cores ≥ 7 | `min(cores − 1, 8)` | halved | 1 GB |
| Android, `deviceMemory` < 6 or unknown | **1** | 1 | 384 MB |
| Android, ≥ 6 GB | `min(cores − 1, 8)` | halved | 1 GB |
| desktop, `deviceMemory` ≥ 8 | `min(cores − 1, 8)`; cores ≥ 16 and RAM ≥ 12 GB → up to **16** | halved | 2 GB |
| desktop, `deviceMemory` < 8 | `min(cores − 1, 6)` | halved | 1 GB |
| `?workers=N` override | N capped at 16 | — | — |

In memory terms (≈ 12 MP, about 48 MB decoded + ~15 MB estimate + heap per
worker):

- iPhone at 3 light workers ≈ **~180 MB** live; heavy halving to 2 ≈ **~120 MB**.
  Conservative because Safari exposes no RAM signal and iOS can evict a tab
  without warning.
- Android low-RAM is pinned to **1** because Chrome on Android reclaims tabs
  aggressively; a second concurrent full canvas is the difference between
  finishing and reloading.
- Desktop at 8 workers ≈ **~500 MB** plus WASM heaps at 12 MP, acceptable on an
  8 GB+ machine, with teardown once idle.
- The budget is always **`cores − 1`**, reserving a core so paint and input stay
  responsive.

Scaling is batch-level: with 8 workers an 8-image batch finishes in roughly the
time of one image, while a 300-image batch runs in waves. On memory-bound work
the speedup per added worker decays (≈ 1.3× at 4 workers on the test VM), which
is why the budget is capped and heavy codecs are halved rather than expanded.

## Size estimates

Exact output sizes would require running the encoder, which would defeat the
preview. Estimates run the real codec on bounded samples instead.

- Scaled decoding is **not** meaningfully cheaper than a full decode in Chrome
  (2.5 MP: 512 px 27 ms vs full 25 ms; 16.6 MP: 137 ms vs 145 ms), because the
  entropy stream is decoded regardless. The estimate decode cap is therefore
  **2048 px**, capped at the image's natural size, so small images are never
  upscaled.
- The sample encodes are the real cost. Moving from 192/448 to 384/896 samples
  cost about **33 ms → 81 ms** per light image and improved median error from
  ~25 % to ~11 %. Larger samples (512/1024, 768/1792) added little accuracy for
  30–200 % more time.

Measured accuracy against a real full-resolution encode (25-image corpus:
photos from 0.3–26 MP plus screenshots, text, graphics, gradients, noise and
alpha):

| target | median error | within ±10 % |
| --- | --- | --- |
| WebP | 8.1 % | 55 % |
| PNG (modes 0/1/2) | 6–11 % | 48–60 % |
| JPEG | 13.2 % | 37 % |
| AVIF | 10.6–18.1 % | 28–48 % |
| all | 11.8 % | 46 % |
| photos only | 10.7 % | 48 % |

Photographic content lands close to ±10 %; synthetic text and UI graphics remain
the hardest cases because a downscaled sample cannot fully reveal the
high-frequency detail a full-resolution encode will produce.

## Measurement gaps

- Mobile worker counts and memory ceilings are sizing policy, not device-tested.
  A real-device pass (iPhone 12 MP and 48 MP, a mid-range Android, an iPad Pro)
  is needed before publishing memory claims.
- Parallelism figures come from a shared Linux VM; a physical desktop with
  independent memory channels should scale better than the memory-bound ceiling
  observed here.
- Thermal throttling, battery impact, and Safari/JSC codec performance are
  untested.
