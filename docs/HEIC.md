# HEIC feasibility, licensing, and security decision (HEIC-01)

Status: **implemented** — HEIC decode and encode ship through `elheif`.
Probed: 2026-09-13. Implemented: 2026-09-17.

## Decision

1. **HEIC/HEIF decoding: shipped.** `elheif` (libheif + libde265) decodes HEIC/HEIF inside the
   worker. Safari's native decoder is tried first; the WASM path covers Chrome, Firefox, and
   older WebKit.
2. **HEIC encoding: shipped.** The same `elheif` package bundles libheif + kvazaar, so HEIC
   output runs in the worker on every browser. The vendored build adds a kvazaar speed preset
   and a quality control. HEIC quality values are calibrated separately from JPEG because
   libheif maps them straight onto a HEVC QP, which is a much higher scale than JPEG's. The
   format is classified as a heavy codec and uses the reduced worker pool.

The original feasibility spike (below) is retained as the record of why a purpose-built
libheif WASM build was required for encoding.

## Orientation and metadata policy (HEIC-09)

- **Orientation is baked into the pixels.** Container `irot`/`imir` transforms are applied by
  libheif. The EXIF orientation tag, which libheif ignores, is applied on the WebAssembly path
  in `src/lib/orientation.ts` so Chrome and Firefox match Safari's native decode. Parsed
  dimensions are swapped for transposing orientations (5-8) so the queue, resize, and estimates
  match the oriented output.
- **Metadata is copied only for EXIF, only into JPEG, PNG, and WebP output.** The image is decoded
  and re-encoded from raw pixels, so nothing survives by default. With the Keep metadata checkbox
  on, `src/lib/exif.ts` extracts the EXIF block from the source (JPEG, PNG, WebP, or the HEIC/AVIF
  Exif item), resets Orientation to 1, updates the pixel dimensions, unlinks the stale thumbnail,
  and injects it into the encoded file. XMP, ICC colour profiles, depth maps, burst frames, and
  auxiliary images are always dropped, and AVIF and HEIC output never carry EXIF.
- **Multi-image files** contribute their first top-level image; the remaining images are ignored.

## Evidence

Probed against `libheif-js@1.23.2`:

```sh
npm view libheif-js version license            # 1.23.2  LGPL-3.0
npm pack libheif-js && tar -xzf libheif-js-*.tgz
# public JS API (bundled and node entries):
grep -oE "Heif[A-Za-z]+" package/libheif-wasm/libheif-bundle.mjs | sort -u
#   HeifDecoder
#   HeifImage
# decoder backend present:
grep -aoE "libde265|de265" package/libheif-wasm/libheif.wasm | wc -l     # > 0
# HEVC encoder backends absent:
for s in x265 kvazaar aom; do
  grep -ao "$s" package/libheif-wasm/libheif.wasm | wc -l               # 0 each
done
```

Findings:

- The public API exposes only `HeifDecoder` and `HeifImage`. There is **no
  `HeifEncoder`**, despite low-level `_heif_encoder_*` C symbols existing in the
  compiled module (they are unused without a backend).
- The WASM contains the `libde265` decoder but **no `x265`, `kvazaar`, or `aom`**,
  so `heif_context_encode_image` cannot produce HEVC even though the symbol exists.
- The package README and its ecosystem (`heic-decode`) are decoder-oriented.

## Licensing and patents

| Component | License | Implication for this project |
| --- | --- | --- |
| `libheif-js` | LGPL-3.0 | Dynamic/late-bound WASM use; must ship license notices and allow relinking (swap the WASM artifact). No source disclosure of app code. |
| libheif | LGPL-3.0 | Same as above. |
| libde265 | LGPL-3.0 | Decoder-only; already satisfied by the WASM notice. |
| x265 (encoder) | **GPL-2.0** | Strong copyleft; distribution would impose GPL obligations on the combined work. Avoid. |
| kvazaar (encoder) | LGPL-2.1 | Compatible with the app's licensing posture, but an extra WASM build to maintain. |
| HEVC patents | MPEG LA / Access Advance pools | Encoding/decoding HEVC may require patent licences depending on distribution and jurisdiction. Legal review required before shipping an encoder. |

Decoder-only use still interacts with HEVC patents, so the release checklist must
include a patent review even for input support.

## Security

HEIC parsing is untrusted-input processing.

- Keep libheif's security limits enabled (bounded dimensions, allocation limits)
  and never disable them for large inputs; report a row-level error instead.
- Pin `libheif-js` and review [libheif security releases](https://github.com/strukturag/libheif/releases)
  before each release; add it to the dependency-update process.
- Add malformed/multi-image HEIC fixtures to the QA corpus
  ([TEST-MATRIX.md](./TEST-MATRIX.md)).
- Decode in the worker only; never initialise the WASM module on the main thread.

## Browser behaviour

Safari 17+ can decode HEIC natively; Chrome/Firefox cannot be relied on for native
HEIC. The app therefore treats *native decode support as a probe*, not a default,
and uses the WASM decoder everywhere else. See the engine matrix in
[TODO.md](./TODO.md).

## Decode memory and worker scheduling

The scheduler selects the light or heavy budget from the **output** format
(`isHeavyFormat(targetFormat)`) and charges `formatMemoryWeight(outputFormat)`
(`src/lib/memory.ts`). A HEIC **input** that the browser cannot decode natively
adds a second, heavier cost, so it is modelled separately. The three scenarios
classify as follows:

1. **HEIC in → other out (most common).** Decode is the entire heavy cost and the
   encoder is native and light, even though libheif/libde265 is the heaviest
   decoder in the app.
   - WASM (Chrome/Firefox): libde265 reference planes plus a **doubled RGBA**
     output (the vendored binding appends the plane twice) and the `ImageData` copy.
     Measured at 12 MP, one decode adds about 385 MB to a worker, and the WASM
     heap never shrinks.
   - Native (Safari/iPadOS): `createImageBitmap` is tried first, so iPadOS
     decodes through ImageIO, which is cheaper than WASM. A full-resolution
     48 MP HEIC is still large, and scaled decode
     (`resizeWidth`/`resizeHeight`) is not guaranteed for HEIC, so the 2048 px
     estimate cap can fall back to a full decode.
   - **Scheduling.** `needsWasmHeic` (`src/App.tsx`) marks a HEIC on a browser
     that does not decode it natively (`decodesHeicNatively`, `src/lib/device.ts`).
     Such a job is charged `WASM_HEIC_DECODE_WEIGHT` (8x RGBA) at **source**
     size, because the WASM decode ignores the resize target, and runs under the
     heavy-worker limit whatever the output format. The pool replaces the worker
     after each such job so its WASM heap is returned during the batch. A batch
     that is mostly WASM HEIC also samples like a heavy codec for estimates.
2. **other in → HEIC out.** Encoding is kvazaar WASM on every browser — no
   native HEIC encoder exists in Chrome/Firefox, and canvas cannot encode HEIC
   on Safari. Already heavy: the target HEIC selects the heavy pool and weight 5.
   No change.
3. **HEIC in → HEIC out (least common).** Both sides are heavy. It is already
   heavy via the target; the source-format rule in (1) covers it automatically,
   so it stays grouped with (2).

### Is faster HEIC decode possible?

- Native decode is faster than WASM and is already preferred wherever the
  platform supports it.
- The WASM libde265 decoder runs single-threaded (no `SharedArrayBuffer` /
  cross-origin isolation in this app), so there is no in-worker parallelism to
  exploit.
- Removing the extra RGBA copies is a small speed win and a larger memory win.
  The doubled plane comes from a stray second `std::copy` in upstream elheif's
  decode, so fixing it needs a rebuild of the vendored WASM.
- Scaled decode is the real lever, but libde265's scaled output is limited and
  not exposed by the vendored binding, so the estimate cap cannot reduce HEIC
  decode work as reliably as JPEG's reduced IDCT.

## Recommended integration path

- **HEIC-02:** recognise `heic`/`heif` by container brand and magic bytes; parse
  dimensions safely (decoder-backed if header parsing is insufficient).
- **HEIC-03:** pin a `libheif-js` WASM build, lazy-load it in the worker, keep
  security limits on, and code-split so JPEG/PNG/WebP/AVIF never load it.
- **HEIC-04:** implement `decode(buffer)` in the codec adapter and feed the
  existing `ImageSource`, resize, thumbnail, and estimate pipeline.
- **HEIC-05:** validate against iPhone/Android fixtures, portrait orientation,
  alpha, multi-image and malformed files, and compare native vs WASM output.

## Build and calibration status

The items above are resolved:

1. **Backend and license:** kvazaar (LGPL-2.1) was selected over x265 (GPL-2.0); the patched
   build is vendored under `vendor/elheif/`.
2. **Reproducible build:** pinned kvazaar v2.3.1 + libheif v1.18.2 + elheif patches, scripted
   in [`wasm/heic/build.sh`](../wasm/heic/build.sh).
3. **Calibration:** HEIC quality presets are calibrated separately from JPEG; measured
   fidelity is in
   [PERFORMANCE_AND_MEMORY.md](./PERFORMANCE_AND_MEMORY.md#quality-presets-and-measured-fidelity).

Still tracked as release gates in [TODO.md](./TODO.md): the HEVC patent-licensing decision,
the dependency-advisory process (SEC-01), and the licensing/security release gate.
