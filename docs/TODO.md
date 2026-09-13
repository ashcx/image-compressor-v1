# Product and Engineering TODO

This is the implementation backlog for the next performance, responsive UI, and HEIC
milestone. It is organised as a Scrum plan so each sprint has a goal, concrete tasks,
expected output, verification steps, dependencies, and parallel work opportunities.

The backlog is intentionally more detailed than the current codebase. A checked item means
the work has been implemented and accepted; unchecked items are planned work.

## Planning assumptions

- Sprint length: two weeks.
- Planning capacity: approximately 25 story points per sprint.
- Team assumption: one senior engineer with part-time design and QA support.
- Story points are relative estimates, not hours. They include implementation, tests, review,
  documentation, and integration.
- The full plan is approximately **245 story points**, or roughly 10 sprints at the assumed
  capacity.
- HEIC encoding is a technical and licensing risk. The feasibility spike is a mandatory
  decision gate before committing to production HEIC output.
- The application remains browser-only and must preserve its no-upload privacy model.

## Definition of Done for every story

- The implementation is covered by an appropriate unit, integration, browser, or manual test.
- `npm run lint` passes.
- `npm run typecheck` passes.
- `npm test` passes.
- `npm run build` passes.
- User-visible failures have a clear message and do not stop unrelated batch jobs.
- New memory, worker, and browser-support assumptions are documented.
- No image bytes are sent to a server.

## Program-level acceptance gates

The program is complete only when all of these are true:

- A 1,000-file queue does not mount 1,000 active row components.
- Adding 500–1,000 files does not create a long main-thread task that makes the UI feel stuck.
- Scrolling remains smooth while compression is active.
- Progress and aggregate counters are updated without repeatedly scanning and rerendering the
  entire queue.
- Input and output memory are bounded by device class and image dimensions.
- Resize operations avoid unnecessary full-resolution canvas allocation where the browser allows.
- Completed output blobs do not grow unbounded in JavaScript memory.
- JPEG, PNG, WebP, AVIF, and HEIC are tested on the supported desktop and mobile browsers.
- HEIC decoding works in browsers without native HEIC support through the WASM fallback.
- HEIC output is validated with independent decoders and common Apple tooling.
- HEIC WASM is lazy-loaded only when HEIC input or output is used.
- The project has an explicit HEIC metadata, licensing, and browser-support policy.

## Parallel workstreams

These streams can run in parallel after Sprint 1 establishes the interfaces and acceptance
criteria:

- **Performance core:** queue rendering, state aggregation, memory scheduling, resize-aware
  decoding, and output storage.
- **Responsive UI:** desktop/tablet/mobile layout, settings presentation, progress states, and
  accessibility.
- **HEIC:** decoder, encoder, fixtures, compatibility, security, and licensing.
- **QA and documentation:** fixture corpus, browser matrix, benchmark reporting, support
  documentation, and release notes.

The HEIC decoder and UI work can proceed in parallel once the codec interface is agreed. HEIC
encoding should follow the feasibility spike and can be developed independently from the UI,
but its final integration depends on the output-storage and worker-budget contracts.

## Sprint 1 — Baseline, UX contract, and HEIC feasibility

**Goal:** establish measurable performance targets, agree the responsive product shape, and
decide whether HEIC encoding is technically and legally viable.

**Capacity: 21 points**

### TODO

- [x] **PERF-01 — Create a repeatable browser benchmark harness (8 points)**
  - Add a production-build benchmark path for JPEG, WebP, PNG, AVIF, and representative
    decode/resize operations.
  - Record time to first result, batch completion time, worker utilization, queue depth,
    frame gaps, long tasks, and peak memory where the browser exposes it.
  - Add fixture sets for 25, 60, 240, 500, and 1,000 files.
  - Record separate photo, screenshot, transparency, noisy, and large-image cohorts.
  - Persist benchmark summaries so changes can be compared between commits.
  - Delivered in [`bench/`](../bench/README.md) with a committed 25/60/240 baseline in
    `bench/results/baseline.{json,md}`; fixture counts up to 1,000 run on demand.

- [x] **UX-01 — Define responsive information architecture and design tokens (5 points)**
  - Produce desktop, tablet, portrait-tablet, and mobile wireframes.
  - Define spacing, typography, control heights, radius, colors, focus states, and density
    tokens.
  - Define the empty state, importing state, estimating state, compressing state, complete
    state, and error state.
  - Decide whether single-file auto-compression remains distinct from batch compression.
  - Delivered in [DESIGN.md](./DESIGN.md); tokens are implemented in `src/app.css`.

- [x] **HEIC-01 — Run HEIC feasibility, licensing, and security spike (5 points)**
  - Prototype the current `libheif` Emscripten/WASM build path.
  - Verify whether the selected JavaScript wrapper exposes the required decoder and encoder
    functionality in a Vite worker bundle.
  - Compare `libde265` decoding with an encoder backend such as x265 or kvazaar.
    owner.
  - Confirm the minimum patched libheif version and security-update process.
  - Ensure both HEIC encoding and decoding works on all platforms, and if HEIC support fails on obscure browsers and platforms, an error message is shown to the user rather than just implicitly failing
  - Decision in [HEIC.md](./HEIC.md): proceed with `libheif-js` decoding; keep encoding gated
    (no encoder backend, licensing/patent review required).

- [x] **QA-01 — Define the test corpus and release matrix (3 points)**
  - Collect representative JPEG, PNG, WebP, AVIF, and HEIC fixtures.
  - Include iPhone portrait images, Android HEIC images, transparency, large dimensions,
    malformed files, and duplicate filenames.
  - Define the supported browser/device matrix.
  - Define the expected output-validation tools for HEIC.
  - Delivered in [TEST-MATRIX.md](./TEST-MATRIX.md); the deterministic corpus is generated by
    the benchmark fixture generator.

### Expected output

- A runnable benchmark harness and baseline report.
- Approved responsive wireframes and UI acceptance criteria.
- A documented HEIC feasibility decision.
- A versioned fixture corpus and browser test matrix.

### Tests and verification

- Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build`.
- Run the benchmark against the current production build.
- Verify that the harness reports the existing 60- and 240-row baseline as a regression
  reference.
- Manually review wireframes at 360px, 768px, 1024px, and 1440px widths.

### Parallel work

UX-01 and QA-01 can run in parallel. HEIC-01 can run in parallel with the benchmark harness,
but its decision must be complete before HEIC encoding is scheduled.

## Sprint 2 — Batch ingestion, state aggregation, and virtualized queue

**Goal:** make 500–1,000-file intake and scrolling cheap on the main thread.

**Capacity: 26 points**

### TODO

- [ ] **PERF-02 — Batch file ingestion (5 points)**
  - Create all job records and IDs in one state transaction.
  - Avoid repeatedly copying the growing ID array during a 1,000-file import.
  - Show an immediate import summary while metadata and previews arrive progressively.
  - Preserve ordering and duplicate filenames.

- [ ] **PERF-03 — Incremental aggregate state (5 points)**
  - Replace repeated full-batch reductions for completed, failed, pending, and byte totals with
    incremental counters or selectors.
  - Throttle visual progress updates to an appropriate frame rate.
  - Prevent a single row completion from causing unnecessary panel and queue work.

- [ ] **PERF-04 — True virtualized job list (13 points)**
  - Mount only the visible rows plus a small overscan window.
  - Preserve correct scroll height with a spacer or measured row offsets.
  - Support keyboard focus, removal, download, error actions, and screen-reader navigation.
  - Keep row height predictable for the default density.
  - Handle insertion, removal, resize, and orientation changes without scroll jumps.
  - Keep `content-visibility` as a secondary optimization where useful.

- [ ] **PERF-05 — File validation and intake guardrails (3 points)**
  - Validate supported formats using magic bytes after reading a bounded header.
  - Report unsupported files before they enter the processing queue.
  - Show count, total input size, and device-risk warnings for unusually large batches.

### Expected output

- A 1,000-file queue that renders a small visible window rather than the entire list.
- Import feedback that appears immediately and continues progressively.
- O(1)-style aggregate updates for normal job transitions.
- Clear unsupported-file and oversized-batch messages.

### Tests and verification

- Add unit tests for bulk insertion, ordering, duplicate names, invalid files, and aggregate
  transitions.
- Add browser tests for 25, 240, 500, and 1,000 synthetic rows.
- Measure DOM row count, script time, scroll frame gaps, and long tasks.
- Acceptance target: only visible rows plus overscan are mounted at 1,000 files.
- Run all standard project checks.

### Parallel work

PERF-02 and PERF-03 can be implemented in parallel. PERF-04 depends on the final job-list
state contract but can be developed alongside PERF-05.

## Sprint 3 — Memory budgets, worker scheduling, and resize-aware decoding

**Goal:** keep processing smooth and bounded on mobile, tablet, and desktop devices.

**Capacity: 29 points**

### TODO

- [ ] **PERF-06 — Hard input-buffer reservations (8 points)**
  - Reserve `file.size` before starting an eager read.
  - Ensure in-flight reads cannot collectively exceed the configured byte budget.
  - Separate file-read concurrency from codec-worker concurrency.
  - Use smaller read-ahead limits on memory-constrained devices.

- [ ] **PERF-07 — Pixel-aware and adaptive worker budget (8 points)**
  - Track estimated decoded pixels per active job.
  - Prevent too many large canvases from running simultaneously.
  - Retain conservative mobile defaults.
  - Lower concurrency after allocation errors, worker crashes, or sustained long frames.
  - Add diagnostics for worker count, active pixel budget, and queue depth.

- [ ] **PERF-08 — Resize-aware decoding (8 points)**
  - Pass target decode dimensions into `createImageBitmap` where supported.
  - Avoid decoding a full-resolution image when the requested output is substantially smaller.
  - Preserve the existing fallback path for browsers that cannot scale during decode.
  - Verify orientation and dimensions after scaled decode.

- [ ] **PERF-09 — Pause and cancellation semantics (5 points)**
  - Add a user-visible cancel action for active batches.
  - Stop queued work immediately and allow active worker tasks to settle safely.
  - Keep completed results available after cancellation.
  - Clearly distinguish cancelled, failed, and completed rows.

### Expected output

- A bounded read scheduler and pixel-aware worker scheduler.
- Lower peak memory for resized large images.
- User-controlled cancellation without corrupting completed results.

### Tests and verification

- Unit-test buffer reservation, release, cancellation, and worker-budget transitions.
- Test 12 MP, 26 MP, and 48 MP fixtures with and without resizing.
- Run browser memory and long-task measurements on desktop, iPad, iPhone, and Android.
- Force worker failures and verify recovery without losing unrelated jobs.
- Confirm cancellation removes queued work and does not produce false error rows.
- Run all standard project checks.

### Parallel work

PERF-06 and PERF-07 can run in parallel. PERF-08 can run in parallel after the resize contract
is agreed. PERF-09 can be implemented independently but should integrate with the scheduler
before sprint acceptance.

## Sprint 4 — Output storage and large-batch delivery

**Goal:** prevent completed outputs and ZIP creation from exhausting browser memory.

**Capacity: 28 points**

### TODO

- [ ] **PERF-10 — OPFS-backed output store (13 points)**
  - Add an output-store abstraction that can write completed blobs to OPFS.
  - Retain job metadata and thumbnails in UI state while storing full output bytes separately.
  - Support reading a stored output for individual download.
  - Delete output files when a job is removed or the batch is cleared.
  - Recover or clean abandoned temporary output files on the next session.

- [ ] **PERF-11 — Non-OPFS fallback and backpressure (5 points)**
  - Add a bounded in-memory fallback.
  - Stop or stage processing when output memory exceeds the device budget.
  - Explain the limitation to the user and provide an actionable download/clear path.

- [ ] **PERF-12 — ZIP and folder-save progress (5 points)**
  - Show files processed, current ZIP size, and completion state.
  - Disable conflicting actions while folder saving is active.
  - Surface permission and quota failures inside the app instead of as unhandled errors.

- [ ] **QA-02 — Storage cleanup and recovery tests (5 points)**
  - Test removal, clear-all, cancellation, quota failure, reload, and interrupted delivery.
  - Verify that no stale object URLs or OPFS files remain after cleanup.

### Expected output

- Large completed batches no longer require retaining every output Blob in JavaScript memory.
- ZIP and folder delivery provide visible progress and safe failure handling.
- Storage cleanup is deterministic.

### Tests and verification

- Add OPFS-backed browser tests where supported.
- Test in-memory fallback with an intentionally small quota.
- Process batches whose outputs exceed the configured memory budget.
- Verify individual download, ZIP download, and folder save after output spooling.
- Run all standard project checks.

### Parallel work

PERF-10 and QA-02 can be developed in parallel once the storage interface is agreed. PERF-12
can proceed alongside PERF-10 using a mocked store.

## Sprint 5 — Responsive UI and accessibility

**Goal:** make the product feel polished and efficient at mobile, tablet, and desktop sizes.

**Capacity: 29 points**

### TODO

- [ ] **UX-02 — Desktop and tablet shell (8 points)**
  - Expand the desktop content area to use available space.
  - Add a two-pane layout with sticky settings and a scrollable queue.
  - Support stacked portrait-tablet layout and split landscape-tablet layout.
  - Add a batch summary with progress, estimated size, savings, and output count.

- [ ] **UX-03 — Mobile shell and sticky actions (8 points)**
  - Add a compact mobile header and sticky bottom action bar.
  - Make primary actions full width with 44–48px touch targets.
  - Collapse advanced settings by default.
  - Move row actions into a touch-friendly overflow menu.
  - Add safe-area padding and reduced-motion handling.

- [ ] **UX-04 — Presets and settings presentation (5 points)**
  - Add Fast, Balanced, Smaller, and Maximum Quality presets.
  - Explain which format is best for photos, graphics, transparency, and compatibility.
  - Hide worker diagnostics behind an advanced details area.
  - Make approximate estimates visually distinct from exact output sizes.

- [ ] **A11Y-01 — Accessible progress and interaction states (8 points)**
  - Add semantic progress reporting and live status announcements.
  - Add consistent `:focus-visible` styling to all controls.
  - Add keyboard support for queue actions and virtualized rows.
  - Improve error, disabled, retry, and cancellation states.
  - Verify contrast, reduced motion, and screen-reader output.

### Expected output

- Responsive layouts at 360px, 768px, 1024px, and 1440px.
- A clear mobile action model and a productive desktop batch workflow.
- Accessible progress and queue interaction.

### Tests and verification

- Run browser visual checks at the four target widths.
- Test touch targets on iOS Safari and Android Chrome.
- Test keyboard-only navigation and screen-reader status announcements.
- Test reduced-motion and dark/system theme behavior.
- Verify no layout shift when rows enter or leave the virtualized window.
- Run all standard project checks.

### Parallel work

UX-02, UX-03, and UX-04 can run in parallel after Sprint 1 design tokens are approved.
A11Y-01 should review each UI stream continuously rather than waiting until the end.

## Sprint 6 — HEIC decoding

**Goal:** accept HEIC/HEIF inputs across browsers, using native support where available and
WASM fallback elsewhere.

**Capacity: 29 points**

### TODO

- [ ] **HEIC-02 — Format detection and model support (3 points)**
  - Add `heic` and `heif` input recognition using container brands and magic bytes.
  - Add the extension, MIME, and format labels.
  - Add dimension parsing or safe decoder-backed dimension discovery.
  - Ensure renamed files are still detected correctly.

- [ ] **HEIC-03 — Build and lazy-load the WASM decoder (13 points)**
  - Pin a maintained libheif/libde265 build.
  - Build a worker-compatible ESM/WASM bundle.
  - Load it only when HEIC decoding is required.
  - Avoid initializing the module on the main thread.
  - Configure security limits and bounded dimensions.

- [ ] **HEIC-04 — Integrate HEIC decoding into the worker pipeline (8 points)**
  - Implement `decode(buffer)` in the codec adapter.
  - Decode the primary still image into RGBA pixels.
  - Convert the pixels into the existing `ImageSource` abstraction.
  - Reuse resize, thumbnail, estimate, and output pipelines.
  - Handle orientation consistently.

- [ ] **HEIC-05 — Decoder fixtures and browser tests (5 points)**
  - Test iPhone and Android HEIC fixtures.
  - Test portrait orientation, alpha, large images, malformed files, and multiple-image files.
  - Test native Safari behavior versus WASM fallback behavior.

### Expected output

- HEIC files can be selected, dimensioned, previewed, resized, and converted to existing
  output formats.
- Chrome, Firefox, and other browsers do not depend on native HEIC support.
- HEIC WASM is code-split and worker-only.

### Tests and verification

- Unit-test detection and dimensions.
- Decode fixtures with the WASM adapter and compare dimensions/pixels against trusted output.
- Test malformed files and allocation-limit failures.
- Verify no main-thread WASM initialization or long decode task.
- Test batches of 25, 100, and 500 HEIC files using conservative worker budgets.
- Run all standard project checks.

### Parallel work

HEIC-02 and HEIC-05 can start while HEIC-03 is being built. HEIC-04 depends on the codec
adapter contract but can be implemented with a mocked decoder before the final WASM bundle is
available.

## Sprint 7 — HEIC encoding

**Goal:** produce valid `.heic` output without breaking the privacy, worker, or memory model.

**Capacity: 34 points; split if needed**

### TODO

- [ ] **HEIC-06 — Build the HEIC encoder backend (13 points)**
  - Select and document the HEVC encoder backend.
  - Prefer a minimal libheif build with only the required HEIC components.
  - Confirm Emscripten compatibility, worker execution, and output size.
  - Resolve LGPL/GPL, codec-patent, and distribution requirements before release.
  - Expose a small wrapper for RGBA input, quality, speed, and encoded output.

- [ ] **HEIC-07 — Add the encoder adapter (8 points)**
  - Add a lazy HEIC codec loader to the registry.
  - Convert the existing `ImageSource` canvas into encoder input.
  - Return a correctly typed `image/heic` Blob with a `.heic` extension.
  - Cache the WASM instance per worker.
  - Release WASM buffers after each job.

- [ ] **HEIC-08 — Add quality presets and estimate calibration (8 points)**
  - Add HEIC-specific Fast, Balanced, Smaller, and Maximum Quality settings.
  - Map UI quality to encoder parameters through a documented calibration layer.
  - Measure output size and encode time against representative photos and graphics.
  - Add HEIC estimates without reusing AVIF calibration blindly.

- [ ] **HEIC-09 — Define orientation and metadata policy (5 points)**
  - Bake orientation into pixels or preserve the orientation metadata consistently.
  - Decide whether EXIF, GPS, depth, burst, and auxiliary metadata are preserved.
  - Document any metadata removed during conversion.

### Expected output

- HEIC appears as an optional output format.
- Encoding runs in workers and does not block the UI.
- Output files open successfully in independent HEIC decoders and supported Apple tools.
- The app clearly communicates compatibility and metadata behavior.

### Tests and verification

- Encode JPEG, PNG, WebP, and decoded HEIC sources into HEIC.
- Decode the generated outputs with an independent libheif build.
- Validate outputs in Safari/macOS Preview or equivalent supported tooling.
- Verify dimensions, orientation, color, transparency policy, and quality presets.
- Test worker failure, encoder failure, oversized input, and cancellation.
- Benchmark single-image latency and batches of 25, 100, and 500 images.
- Verify HEIC WASM is not loaded when the user only uses JPEG/WebP/PNG/AVIF.
- Run all standard project checks.

### Parallel work

HEIC-06 can run in parallel with HEIC-08 using mocked encoded outputs. HEIC-09 can run in
parallel with both. HEIC-07 depends on the final encoder wrapper and should be the integration
owner for this sprint.

## Sprint 8 — HEIC production integration and hardening

**Goal:** make HEIC safe, understandable, and reliable in the full application.

**Capacity: 26 points**

### TODO

- [ ] **HEIC-10 — Integrate HEIC with batch storage and delivery (8 points)**
  - Ensure HEIC outputs work with individual downloads, ZIP delivery, folder saving, and OPFS.
  - Include HEIC in output-size summaries and estimates.
  - Ensure thumbnails are generated from decoded source pixels rather than re-decoding output.
  - Apply the HEIC worker and pixel budgets.

- [ ] **HEIC-11 — Cross-browser and device compatibility (8 points)**
  - Test Safari desktop and iOS native paths.
  - Test Chrome and Firefox WASM paths.
  - Test Android devices with conservative worker counts.
  - Test desktop memory-heavy batches and slow-device fallbacks.

- [ ] **SEC-01 — Malformed input and dependency security process (5 points)**
  - Add malformed/crafted HEIC fixtures.
  - Verify libheif security limits are active.
  - Add dependency pinning and update review instructions.
  - Define the response process for libheif and codec advisories.

- [ ] **UX-05 — HEIC error, retry, and support messaging (5 points)**
  - Explain unsupported or corrupt HEIC files.
  - Provide retry or remove actions without losing the rest of the batch.
  - Explain that browser preview support and downloaded-file support are separate concerns.
  - Show when metadata may not be preserved.

### Expected output

- HEIC behaves like a first-class input and output format in the complete workflow.
- Browser-specific behavior is handled transparently.
- Security and dependency risks are documented and testable.

### Tests and verification

- Run the complete browser matrix against all delivery paths.
- Test HEIC batches of 500 files with controlled fixtures.
- Test quota, storage, worker, decoder, and encoder failures.
- Verify that one bad HEIC file does not stop a batch.
- Run dependency and license checks.
- Run all standard project checks.

### Parallel work

HEIC-10, HEIC-11, SEC-01, and UX-05 can proceed in parallel after Sprint 7 produces a stable
codec adapter. QA should begin HEIC-11 during Sprint 7 with candidate builds.

## Sprint 9 — Performance gates, documentation, and release

**Goal:** prove the experience is smooth at scale and prepare a safe release.

**Capacity: 23 points**

### TODO

- [ ] **PERF-13 — Tune and gate 500/1,000-file performance (8 points)**
  - Run the full benchmark corpus on desktop, tablet, iPhone, and Android.
  - Tune virtual-list overscan, summary update frequency, read concurrency, worker counts,
    and output backpressure.
  - Record first result, completion time, scroll frames, long tasks, peak memory, and errors.
  - Establish regression thresholds for CI or release validation.

- [ ] **BUILD-01 — Optimize lazy WASM and bundle loading (5 points)**
  - Confirm codec chunks are loaded only when required.
  - Measure first-use WASM startup and worker initialization.
  - Remove duplicate or unnecessary HEIC/codec assets.
  - Verify caching and version invalidation behavior.

- [ ] **DOC-01 — Publish support and licensing documentation (5 points)**
  - Update the README format table and browser support section.
  - Document HEIC metadata behavior and compatibility limitations.
  - Add required third-party license notices.
  - Update architecture and performance documentation with measured HEIC results.

- [ ] **REL-01 — Release and regression validation (5 points)**
  - Run the complete CI workflow.
  - Test the production deployment rather than only the development server.
  - Validate update-banner behavior and cache invalidation.
  - Run a release-candidate smoke test across the supported browser matrix.
  - Record known limitations and rollback criteria.

### Expected output

- A production-ready performance report for 500 and 1,000 files.
- Documented regression thresholds.
- Updated browser, metadata, license, and support documentation.
- A release candidate that passes the complete validation matrix.

### Tests and verification

- Run `npm run lint`.
- Run `npm run typecheck`.
- Run `npm test`.
- Run `npm run build`.
- Run the benchmark harness against the release build.
- Run production smoke tests on the deployed application.
- Compare results against the Sprint 1 baseline and investigate regressions before release.

### Parallel work

PERF-13, BUILD-01, DOC-01, and REL-01 can run in parallel. REL-01 should remain the final
release gate and must consume the outputs of the other three workstreams.

## HEIC browser-engine support matrix

**Checked:** 2026-09-13. Browser release numbers move frequently; re-run this matrix against the
release candidates before shipping. The table distinguishes native browser behavior from the
application's planned WebAssembly path.

| Rendering engine | Current stable representatives | Native HEIC decoding/display | Native HEIC encoding from web APIs | Application target after HEIC work |
| --- | --- | --- | --- | --- |
| **Blink** | Chrome 153, Edge 152, Chromium-based Opera, Android Chromium/WebView | **No reliable cross-browser baseline.** Treat HEIC as unsupported unless a real decode probe succeeds. Chromium's file picker MIME list may include `image/heic`/`image/heif`, but that is not proof of pixel decoding. | **No reliable portable baseline.** Do not depend on `canvas.toBlob()` or other browser APIs to produce `image/heic`. | Decode and encode through the worker-hosted libheif WASM adapter. |
| **WebKit** | Safari 26.6, Safari View Controller, WKWebView on current Apple OS releases | **Yes for supported Safari/WebKit releases.** Safari 17 added HEIC image support for Safari, Safari View Controller, and WKWebView. Still retain fallback handling for older OS versions and unusual HEIF variants. | **Not a portable web-API guarantee.** Native display/import support must not be interpreted as a deterministic `image/heic` encoder contract. Use the app encoder for consistent output. | Prefer a native decode probe when it is materially faster, with libheif WASM as the compatibility path; use the WASM encoder. |
| **Gecko** | Firefox 155 desktop and Android | **No reliable cross-browser baseline.** Treat HEIC as unsupported unless a real decode probe succeeds. | **No reliable portable baseline.** Use the application encoder. | Decode and encode through the worker-hosted libheif WASM adapter. |

### How to interpret the matrix

- **Native decoding** means that the actual HEIC bytes can be decoded to pixels by the browser's
  image pipeline (`HTMLImageElement`, `createImageBitmap`, or `ImageDecoder` where available). A
  file chooser accepting `.heic` is not sufficient.
- **Native encoding** means that a web API reliably returns a valid HEIC file with the requested
  quality. OS-level photo export or share conversion does not count.
- **Application target** means the planned codec implementation, not a capability that exists in
  the current application. Until HEIC-06 and HEIC-07 are complete, HEIC input and output remain
  unsupported by this project.
- Input selection should explicitly include `.heic`, `.heif`, `image/heic`, and `image/heif`; it
  must not rely only on `accept="image/*"` because picker behavior and decode capability are
  separate concerns.

### Required browser verification

- Test a corpus containing ordinary 8-bit HEIC, 10-bit/HDR HEIC where available, orientation and
  color-profile metadata, thumbnails, and multi-image files.
- Record the exact browser build, OS, device class, and result for native decode, native encode,
  WASM decode, and WASM encode. Do not infer support from the user-agent string.
- Probe native decode with real bytes and verify dimensions and rendered pixels. Probe encoding by
  checking that the returned Blob has the requested MIME type and can be decoded back.
- Run the same corpus through the worker path at 1, 100, 500, and 1,000 files, recording first
  result, completion time, long tasks, peak memory, failures, and cancellation behavior.

### Matrix references

- [WebKit Safari 17 HEIC announcement](https://webkit.org/blog/14445/webkit-features-in-safari-17-0/)
- [Safari 26.6 release context](https://webkit.org/blog/18178/webkit-features-for-safari-26-6/)
- [Chrome 153 stable release notes](https://developer.chrome.com/release-notes/153)
- [Microsoft Edge release schedule](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-release-schedule)
- [Firefox 155 release notes](https://www.firefox.com/en-US/firefox/155.0/releasenotes/)
- [MDN image format guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Image_types)
- [Chromium MIME-picker change for HEIC/HEIF](https://chromium.googlesource.com/chromium/src.git/%2B/8bc39c9f42b2413af14e177f0c29cfeaebd2d6b7)
- [libheif decoder and encoder documentation](https://github.com/strukturag/libheif)

## HEIC decision notes

HEIC decoding and encoding should use the existing codec abstraction and worker pipeline rather
than introducing a second image-processing architecture.

The preferred technical investigation is `libheif` compiled to WebAssembly. Upstream documents
libheif as both a HEIF/AVIF decoder and encoder, with HEIC decoding through libde265 and HEIC
encoding through backends such as x265 or kvazaar. See the [libheif README](https://github.com/strukturag/libheif#readme).

The `libheif-js` package provides a browser-oriented Emscripten distribution and should be
validated during HEIC-01. Its public examples are primarily decoder-oriented, so the project
must verify encoder exports before depending on it. See the [libheif-js README](https://github.com/catdad-experiments/libheif-js/blob/master/README.md).

`heic2any` is not the encoder strategy: its documented browser conversion targets are JPEG,
PNG, and GIF. See the [heic2any repository](https://github.com/alexcorvi/heic2any).

Safari has native HEIC support, but the application should retain a WASM path for browsers that
do not provide equivalent support. See [WebKit's Safari 17 HEIC announcement](https://webkit.org/blog/14445/webkit-features-in-safari-17-0/).

HEIC parsing must be treated as untrusted-input processing. Keep libheif security limits
enabled, pin patched releases, and monitor the [libheif security releases](https://github.com/strukturag/libheif/releases).

## Current status

- [x] Existing worker-pool, native-first codec, bounded-estimate, and lazy-codec foundations
      documented in [Architecture](./ARCHITECTURE.md) and [Performance](./PERFORMANCE.md).
- [x] Current unit-test, typecheck, lint, and production-build baseline passes.
- [ ] Large-batch benchmark harness checked into the repository.
- [ ] True virtualized queue.
- [ ] Output storage/backpressure for very large completed batches.
- [ ] Responsive desktop/tablet/mobile UI implementation.
- [ ] HEIC decoder.
- [ ] HEIC encoder.
- [ ] HEIC licensing and security release gate.
