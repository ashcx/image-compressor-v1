# Focused Test Plan

## Purpose

This plan focuses on the highest-risk behaviors of the client-side image compressor rather than requiring every possible test on every deployment.

The primary risks are:

- GitHub Pages asset and base-path failures.
- Incorrect worker or WASM loading.
- Jobs being lost, duplicated, or assigned to the wrong file.
- One invalid file stopping an entire batch.
- Stale asynchronous results overwriting newer settings.
- Memory leaks from workers, buffers, and object URLs.
- Browser-specific failures in image decoding or downloading.
- Accidentally sending image data over the network.

The current implementation supports WebP output and already has unit coverage for formatting, estimation, codec registry behavior, and several worker-pool behaviors. The tests below should extend that coverage toward the real worker, UI, deployment, and browser boundaries.

## Test fixtures

Use a small, stable fixture set:

- `photo.jpg`: ordinary 512×384 photograph.
- `transparent.png`: image containing transparent and opaque regions.
- `wide.jpg`: 1200×200 image.
- `tall.jpg`: 200×1200 image.
- `large.jpg`: approximately 4000×3000 image.
- `corrupt.jpg`: truncated JPEG data.
- `empty.bin`: zero-byte file.
- Six valid images with distinct filenames and visible content.

Encoded outputs should not be compared byte-for-byte. Lossy codec versions and browser implementations can produce different bytes while remaining correct. Tests should verify that an output is decodable, has the expected dimensions and metadata, and behaves correctly in the UI.

## Release-gate tests

These are the tests I would run for normal pull requests and deployments.

### DEP-01 — Production deployment smoke test

**Test type:** Playwright browser test against the production build or deployed preview.

**Steps:**

1. Run the production build.
2. Start the production preview server or open the deployed GitHub Pages URL.
3. Navigate to `/image-compressor-v1/`.
4. Record console errors and failed network requests.
5. Check that the application heading and upload area are visible.

**Pass criteria:**

- The page loads successfully under the GitHub Pages base path.
- The heading `Image Compressor` is visible.
- No uncaught console errors or unhandled promise rejections occur.
- JavaScript, CSS, favicon, worker, and WASM assets do not return 404 responses.
- The application is usable after a hard refresh.

This catches incorrect Vite `base` configuration and broken worker/WASM asset paths.

### CONV-01 — Single-image conversion

**Test type:** Playwright browser test.

**Steps:**

1. Load the application.
2. Select `photo.jpg` through the file input.
3. Wait for processing to finish.
4. Locate the download link.
5. Read the linked Blob inside the browser.
6. Decode the Blob as an image.

**Pass criteria:**

- Exactly one job appears.
- The job reaches a completed state.
- A download link appears.
- The filename is `photo.webp`.
- The output MIME type is `image/webp`.
- The output can be decoded successfully.
- Output dimensions are 512×384.
- No error text appears.

The test should not require the output to be smaller than the input because some images can legitimately grow after conversion.

### BATCH-01 — Batch processing

**Test type:** Playwright browser test, with concurrency verified separately by a WorkerPool unit test.

**Steps:**

1. Open the app with `?workers=2`.
2. Select six valid fixture images.
3. Wait for batch estimates to appear.
4. Click the batch compression button.
5. Wait until all jobs finish.

**Pass criteria:**

- Six jobs appear.
- Every valid input receives exactly one result.
- Each result retains the correct source filename.
- No valid job reports an error.
- Progress reaches `6 / 6 compressed`.
- The interface does not remain stuck in a processing state.
- No result is duplicated or associated with the wrong input.

### ERR-01 — Invalid-file isolation

**Test type:** Playwright browser test.

**Steps:**

1. Select `photo.jpg`, `corrupt.jpg`, and another valid image.
2. Allow estimation and compression to finish.
3. Inspect each job independently.

**Pass criteria:**

- The valid images complete successfully.
- The corrupt image enters an error state.
- The error identifies the affected file.
- The batch continues after the corrupt file fails.
- Progress reaches 100%.
- The application remains usable afterward.

Repeat with `empty.bin` and a file whose extension does not match its contents.

### WORKER-01 — Worker crash recovery

**Test type:** Vitest with fake workers, plus an eventual browser-level smoke test.

**Steps:**

1. Create a pool with one worker.
2. Submit job `a`.
3. Make the worker emit an error or crash.
4. Submit job `b`.
5. Configure the replacement worker to complete `b`.

**Pass criteria:**

- Job `a` rejects with a useful error.
- The crashed worker is terminated.
- A replacement worker is created.
- Job `b` completes successfully.
- The queue does not stall.
- No unhandled rejection is produced.

Also test a two-worker pool to verify that a crash in one worker does not affect a job already running in another worker.

### RACE-01 — Quality-change race condition

**Test type:** deterministic UI/integration test with a delayed fake worker.

**Steps:**

1. Start processing an image at quality 75.
2. Before it finishes, change the quality to 25.
3. Start the new processing request.
4. Make the quality-75 response arrive after the quality-25 response.
5. Inspect the final job state.

**Pass criteria:**

- The final result is marked as quality 25.
- The older quality-75 response cannot overwrite it.
- The download link corresponds to the newest result.
- The UI does not display the older size or quality.
- No stale processing state remains.

### CLEAN-01 — Removing and clearing jobs

**Test type:** browser test with a controllable fake worker.

**Steps:**

1. Add an image and hold its worker response.
2. Remove the job before the response arrives.
3. Release the worker response.
4. Repeat using `Clear all`.
5. Complete a job, clear it, and add another image.

**Pass criteria:**

- Removed jobs do not reappear when late responses arrive.
- Cleared jobs do not update the UI afterward.
- Previous object URLs are revoked.
- New jobs work normally after clearing.
- No uncaught errors occur.

The test should spy on `URL.revokeObjectURL` to verify cleanup.

### PRIV-01 — No-upload guarantee

**Test type:** Playwright network-interception test.

**Steps:**

1. Intercept all requests after the application loads.
2. Select and process an image.
3. Record request methods, URLs, and bodies.

**Pass criteria:**

- No POST or PUT request contains image data.
- No request is made to an external upload service.
- Requests are limited to static application assets and local lazy-loaded codec assets.
- The image is processed successfully without a backend.

## Supporting unit and integration tests

### POOL-01 — Worker-pool ordering and concurrency

**Test type:** Vitest with fake workers.

**Steps:**

1. Create a pool of size two.
2. Submit five jobs: `a`, `b`, `c`, `d`, and `e`.
3. Hold all worker responses initially.
4. Confirm that only `a` and `b` are dispatched.
5. Complete `b` before `a`.
6. Confirm that the newly available worker receives `c`.
7. Complete the remaining jobs in a different order.

**Pass criteria:**

- No more than two jobs are active at once.
- Initial dispatch is FIFO.
- A completed worker receives the next queued job.
- Each promise resolves with the correct job ID.
- Out-of-order completion does not mix up results.
- All five jobs complete.

The existing worker-pool tests cover several related behaviors; this test adds explicit out-of-order completion coverage.

### PROTO-01 — Worker protocol and transfer behavior

**Test type:** direct integration test against the actual module worker.

**Steps:**

1. Create an `ArrayBuffer`.
2. Post a valid processing request to the actual worker using the buffer as a transferable.
3. Confirm the sender’s buffer is detached after posting.
4. Wait for the worker response.
5. Decode the returned output buffer.

**Pass criteria:**

- The request contains the correct job ID and target format.
- The input buffer is transferred rather than copied.
- The response contains the same job ID.
- The output buffer is non-empty.
- The output decodes successfully.
- Estimate-only requests return samples and no output buffer.
- Invalid input produces a structured error response.

### DECODE-01 — Image decoding and dimensions

**Test type:** browser conversion test.

Run the conversion flow for `photo.jpg`, `transparent.png`, `wide.jpg`, `tall.jpg`, and `large.jpg`.

**Pass criteria:**

- Every valid image produces a decodable output.
- Dimensions are preserved when resizing is disabled.
- Wide and tall images retain their aspect ratio.
- Transparent regions remain transparent for formats that support alpha.
- Large images either complete or show a clear per-file error.
- Large images do not silently produce blank output or freeze the page.

EXIF orientation requires an explicit product decision first. The test should then verify that chosen behavior consistently.

## Periodic release tests

These tests should run before major releases or on a scheduled basis rather than on every deployment:

- Large batches of 20–100 images.
- Large-resolution image processing.
- Memory usage and object URL cleanup.
- Full format conversion matrix after additional codecs are implemented.
- Performance comparison between one worker and multiple workers.
- Safari and Firefox ZIP download behavior.
- Accessibility keyboard and screen-reader checks.
- Real Android and iOS device testing.

## Test implementation guidance

Use Vitest for pure logic, worker-pool behavior, protocol helpers, and deterministic race conditions. Use Playwright for deployment, UI, real worker, download, privacy, and browser smoke tests.

Prefer accessible roles and labels for selectors. Add stable test IDs only for elements whose state cannot be identified reliably through accessible text.

For browser tests involving timing, use an injectable fake worker or a test-only worker factory so that responses can be delayed and reordered deterministically. Do not rely on real encoding speed to prove race-condition behavior.

The normal deployment gate should run:

1. Build, typecheck, lint, and unit tests.
2. `DEP-01`.
3. `CONV-01`.
4. `BATCH-01`.
5. `ERR-01`.
6. `WORKER-01`.
7. `RACE-01`.
8. `CLEAN-01`.
9. `PRIV-01`.

This set is small enough to run regularly while covering the most likely product failures.
