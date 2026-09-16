# Vendored elheif (HEIC quality + speed)

This is a local build of [`elheif`](https://github.com/hpp2334/elheif) (libheif +
libde265 + kvazaar) with two additions the upstream npm package does not expose:

- `heif_encoder_set_lossy_quality(encoder, quality)` — quality control.
- a `preset` encoder parameter applied via `kvz_config_parse(config, "preset", …)`
  — kvazaar speed control (`ultrafast` … `placebo`).

The `elheif` package in `pkg/` is generated; `elheif-wasm.js` is the Emscripten
single-file bundle and `index.js` is the small ESM wrapper.

## Build

Pinned versions: kvazaar `v2.3.1`, libde265 `v1.0.15`, libheif `v1.18.2`,
Emscripten SDK `3.1.60` (matching the known-good elheif build).

1. Install emsdk 3.1.60 and CMake 3.29 (`cmake_minimum_required` in the deps
   predates CMake 4 compatibility).
2. Clone `hpp2334/elheif`, plus kvazaar/libde265/libheif at the tags above.
3. Apply the libheif `encoder_kvazaar.cc` patch (add a `preset` string parameter
   and call `api->config_parse(config, "preset", value)` after `config_init`).
4. Point elheif's `core/CMakeLists.txt` at the local dependency checkouts, then:
   `emcmake cmake -S . -B build -DEMSCRIPTEN=ON -DCMAKE_BUILD_TYPE=Release`
   `cmake --build build --target elheif-wasm`
5. Copy `build/wasm/elheif-wasm.js` over `pkg/elheif-wasm.js` and run
   `node scripts/patch-js.mjs` to wrap it in `globalThis.__init__ELHEIF_MODULE`.

The full patch and build script are tracked under `wasm/heic/`.
