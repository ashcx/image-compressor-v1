# Architecture

This document explains how Image Compressor works and why it is structured this way. The
short, user-facing overview is in the [README](../README.md); measured results are in
[Performance](./PERFORMANCE.md).

## Design priorities

The architecture optimises for four things, in this order:

1. **Speed:** use native browser encoders where they are effective and process independent
   images concurrently.
2. **Privacy and network efficiency:** keep image bytes on the user's device instead of
   uploading them to a service.
3. **Responsiveness:** keep expensive decode, resize, and encode work away from the UI thread.
4. **Bounded resource use:** adapt concurrency and data movement to the device's memory and
   processor budget.

These priorities explain the performance strategy, but they do not by themselves prove that
the application is the fastest web tool. That requires representative benchmarks.

## End-to-end flow

```text
User selects files
        |
        v
File buffer store -----> estimates and thumbnails
        |
        v
Device-aware worker pool
  decode -> resize -> encode
        |
        v
Output Blobs
  |                 |
  v                 v
Individual files   Stored ZIP stream -> folder or ZIP download
```

The UI owns application state and presentation. Workers own image processing and return a
`Blob` plus metadata for each completed job. The UI does not need to understand codec
internals.

## Processing lifecycle

### 1. Intake and preview

Selected files are read through a bounded file-buffer store. The app detects the input format,
reads dimensions, and creates thumbnails and size estimates without sending the file away.
Estimates use bounded sample decodes and format-specific calibration rather than running a
full encode before the user starts the batch.

### 2. Scheduling

The worker pool schedules independent image jobs. It has separate high- and low-priority work
so user-requested compression can take priority over background thumbnails and estimates.
Worker counts are chosen from the detected device profile and are bounded so a large drop does
not create one worker per image.

### 3. Processing

Each worker decodes an image, applies the optional maximum long-edge resize, and encodes the
result. The final compression path transfers input buffers where possible to avoid unnecessary
large copies. A completed worker returns only the result Blob and metadata, not full ImageData.

### 4. Delivery

Results remain available for individual downloads. A batch can be written to a user-selected
folder when the File System Access API is available, or bundled into a ZIP for browsers that
do not support folder saving.

## Key decisions and trade-offs

### Browser-only processing

The application is a static site with no image-processing service. This keeps deployment
simple, avoids server upload limits, and keeps selected image bytes on the user's device.

The trade-off is that speed and maximum batch size depend on the browser and device. A server
could provide more predictable compute, but would change the privacy, network, and operating
cost model.

### Native-first, lazy codec loading

Codec modules are loaded only when a format needs them. JPEG and WebP use native browser
encoding when the browser can provide it. The default PNG mode also uses the native browser
encoder; slower lossless optimisation and lossy palette modes use their format-specific
libraries. AVIF uses its WebAssembly codec.

Native support is probed because browsers can report support for a MIME type while returning
another format in practice. WebAssembly fallbacks preserve functionality where a native
encoder is unavailable. Lazy loading keeps the initial page smaller and avoids paying AVIF or
PNG-WASM startup cost when it is not needed.

The trade-off is a first-use delay for some formats. AVIF is labelled as slower because its
encoding work is heavier on many devices.

### Worker pool instead of main-thread processing

Decoding, resizing, WebAssembly startup, and encoding can all be expensive. Moving them into
workers keeps controls, scrolling, and progress responsive while a batch runs.

This is batch-level parallelism: one image job can run per worker. It is not a promise that
each codec encodes one image using multiple threads, and the app does not require
cross-origin isolation or `SharedArrayBuffer` for its own worker protocol.

Workers are retired after becoming idle so completed batches do not keep all their resources
alive. Heavy codecs use a smaller pool because their WASM heaps and full-resolution canvases
consume more memory.

### Estimates are deliberately approximate

An exact output size requires running the real encoder, which would remove the benefit of a
preview. The estimator combines original file size, parsed dimensions, bounded sample decodes,
selected options, and format-specific calibration factors.

Estimates are capped to sane ranges and presented as estimates. The completed result always
replaces the estimate with the actual encoded byte count.

### Memory and data movement

Thumbnails and estimate decodes use bounded dimensions. Full-resolution work happens only when
the output is requested, with the configured maximum long edge applied at that point.

Inputs can be transferred to workers for one-shot compression, while copies are retained only
when a later pass needs the same bytes. Intermediate data is released in the worker, and the
pool, metadata worker, and codec heaps are torn down after idle time.

### Stored ZIP output

JPEG, PNG, WebP, and AVIF are already compressed formats. Deflating them again generally adds
CPU time for little or no size reduction. The ZIP implementation therefore uses `fflate` with
stored entries: `level: 0` for the synchronous path and `ZipPassThrough` for the streaming path.

Small batches can use an in-memory ZIP. Larger batches are written incrementally to the Origin
Private File System where available, with an in-memory fallback. ZIP headers and the central
directory still add a small amount of metadata, but the image payloads are preserved rather
than compressed a second time.

### Failure isolation

Each image is an independent job. A decode or encode failure is reported on that row and does
not intentionally cancel the rest of the batch. Worker failures are isolated by the pool so
the app can continue or report a targeted failure instead of losing the whole queue.

## Scope boundaries

The current architecture excludes user accounts, cloud storage, an editing timeline, server
fallback, and animated-image editing. Those features would introduce different privacy, state,
and performance requirements and should be separate product decisions.

The architecture also does not claim universal browser compatibility. Release validation must
exercise the production build on the browser/device combinations the project chooses to
support, especially for AVIF, large inputs, ZIP fallback, and folder saving.
