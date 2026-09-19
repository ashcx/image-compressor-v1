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
- **Metadata is not preserved.** Only the primary still image is decoded and re-encoded from raw
  pixels, so EXIF, GPS, XMP, ICC colour profiles, depth maps, burst frames, and auxiliary images
  are dropped. This applies to every output format, not just HEIC.
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

## Recommended integration path

- **HEIC-02:** recognise `heic`/`heif` by container brand and magic bytes; parse
  dimensions safely (decoder-backed if header parsing is insufficient).
- **HEIC-03:** pin a `libheif-js` WASM build, lazy-load it in the worker, keep
  security limits on, and code-split so JPEG/PNG/WebP/AVIF never load it.
- **HEIC-04:** implement `decode(buffer)` in the codec adapter and feed the
  existing `ImageSource`, resize, thumbnail, and estimate pipeline.
- **HEIC-05:** validate against iPhone/Android fixtures, portrait orientation,
  alpha, multi-image and malformed files, and compare native vs WASM output.

## Open items before HEIC encoding can be scheduled

1. Approval of an encoder backend and its license (kvazaar preferred over x265).
2. HEVC patent-licensing decision for the distribution.
3. A purpose-built WASM build with the chosen backend and a reproducible build script.
4. Calibration data for HEIC quality presets, separate from AVIF.
