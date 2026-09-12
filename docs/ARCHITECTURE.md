# Architecture

This document explains how Image Compressor works and why the project is structured this
way. The user-facing overview and setup instructions are in the [README](../README.md).

## System overview

```text
User selects files
        |
        v
File buffer store -----> estimates and thumbnails
        |
        v
Worker pool
  decode -> resize -> encode
        |
        v
Output Blobs
  |                 |
  v                 v
Individual files   Stored ZIP stream -> folder or ZIP download
```

The UI owns application state and presentation. Image processing is isolated in workers.
The worker returns a `Blob` and metadata for each completed job; the UI does not need to
understand codec internals.

## Performance position

The central product hypothesis is that a browser image tool can be faster when it avoids
uploading files and gives the browser enough independent work to run in parallel. The
implementation is built around that hypothesis:

- Common formats prefer native browser encoding, avoiding WebAssembly startup where the
  browser already has a capable encoder.
- Independent images are scheduled across a device-aware worker pool rather than handled
  sequentially on the UI thread.
- Inputs are transferred to workers where possible, reducing large buffer copies.
- The default PNG path is the fast native lossless mode; slower PNG optimisation modes are
  opt-in.

This explains the intended speed advantage, but it is not proof that the application is the
fastest web tool. That claim should be made only after testing representative image sets on
the target browsers and devices. Codec implementations, worker startup costs, thermal
throttling, and device memory can all change the result.

The concrete numbers behind these choices — encode times, output sizes, the per-worker
memory model, and device worker budgets — are in the
[Performance](./PERFORMANCE.md) document.

## Architectural choices

### Browser-only processing

The application is a static site with no image-processing service. This keeps deployment
simple and means the selected image bytes remain on the user's device. It also avoids a
server upload limit and server-side storage model.

The trade-off is that speed and maximum batch size depend on the device and browser. A
server could offer more predictable compute, but would change the privacy and operating
cost model.

### Worker pool instead of main-thread processing

Decoding, resizing, WebAssembly codec startup, and encoding can all be expensive. The UI
dispatches independent image jobs to a pool of workers so controls and progress remain
responsive while a batch runs.

The pool has separate high- and low-priority work for interactive operations such as
thumbnails and estimates. Worker counts are chosen from the detected device profile and
are bounded to prevent a large batch from creating an unreasonable number of workers.
Workers are retired when idle so a completed batch does not keep all of its resources alive.

This is batch parallelism, not a promise that every codec encodes one image using multiple
threads. The app does not require cross-origin isolation or `SharedArrayBuffer` for its
own worker protocol.

### Lazy codec loading and native-first encoding

Codec modules are loaded only when a format needs them. JPEG and WebP use native browser
encoding when the browser can provide it. The default PNG mode also uses the native browser
encoder; slower lossless optimisation and lossy palette modes use their format-specific
WebAssembly or native libraries. WebAssembly codecs are used when native support is
unavailable or when a format-specific mode requires them. This keeps the first page load
small and avoids paying AVIF or PNG-WASM startup cost when it is not needed.

The cost is a noticeable first-use delay for some formats. AVIF is intentionally labelled
as slower in the UI because its encoding work is heavier on many devices.

### Estimates are deliberately approximate

An exact output size requires running the real encoder. That would remove the benefit of
showing a useful preview before the user starts a batch. The estimator therefore combines
the original file size, parsed image dimensions, a bounded sample decode, selected options,
and format-specific calibration factors.

Estimates are capped to sane ranges and are presented as estimates. The completed result
always replaces the estimate with the actual encoded byte count.

### Memory and data movement

Input files are read through a bounded buffer store. Estimate work can use a copy, while
the final compression path transfers the input buffer to a worker where possible. This
avoids unnecessary copies for large files. The worker releases large intermediate data and
returns a compact result to the UI.

Thumbnails and estimate decodes use bounded dimensions. Full-resolution work is performed
only when the actual output is requested, with the configured maximum long edge applied at
that point.

### Why the ZIP path stores rather than recompresses

The output files are already JPEG, PNG, WebP, or AVIF. Deflating those formats again usually
adds CPU time and gives little or no size reduction. The ZIP implementation therefore uses
`fflate` with stored entries (`level: 0` for the synchronous path and `ZipPassThrough` for
the streaming path).

There are two paths:

- Small or already-materialised batches can use an in-memory ZIP.
- Larger batches are written incrementally to the Origin Private File System when the
  browser provides it, with an in-memory fallback.

This is not a zero-byte-overhead operation: ZIP headers and a central directory are still
written. It is, however, a byte-preserving bundle of the image outputs rather than a second
compression pass. `fflate` is already an appropriate fast, small dependency for this job;
switching to a heavier ZIP library would not improve the core operation.

### Downloads and folder saving

Every completed output remains available as a Blob for an individual download. For batch
delivery, the app can either build a ZIP or use the browser's File System Access API to
write files into a user-selected directory. The ZIP path is the portable fallback because
folder APIs are not consistently available across browsers.

### Failure isolation

Each image is an independent job. A decode or encode failure is reported on that row and
does not intentionally cancel the rest of the batch. Worker crashes are isolated by the
pool so the application can continue or report a targeted failure instead of losing the
entire queue.

## Scope boundaries

The current architecture deliberately excludes user accounts, cloud storage, an editing
timeline, server fallback, and animated-image editing. Those features would introduce
different privacy, state, and performance requirements and should be treated as separate
product decisions.

The architecture also does not claim universal browser compatibility. A release check must
exercise the production build on the browser/device combinations the project chooses to
support, especially for AVIF, large inputs, ZIP fallback, and folder saving.
