# HEIC feasibility, licensing, and security decision (HEIC-01)

Status: **spike complete** — decoder recommended, encoder gated.
Probed: 2026-09-13.

## Decision

1. **HEIC/HEIF decoding: proceed** (`HEIC-02` … `HEIC-05`). `libheif-js` is a viable,
   worker-hosted WASM decoder and fits the existing codec abstraction.
2. **HEIC encoding: gate remains closed** (`HEIC-06` … `HEIC-08`). The available
   `libheif-js` build has **no HEIC encoder backend**, and every realistic backend
   carries a licensing or patent obligation. Do not schedule encoding until a
   licensing/patent review and a purpose-built WASM build are approved.

This satisfies the Sprint 1 gate: the project may commit to HEIC *input* now and
must treat HEIC *output* as unresolved.

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
