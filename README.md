# Image Compressor

Image Compressor is a browser app for converting and resizing images in batches. It is
built around one goal: make image processing fast, private, and useful on the device you
already have.

[Open the live app](https://ashcx.github.io/image-compressor-v1/)

## Why use it?

- **Speed-first processing.** Common formats prefer native browser encoding, while separate
  images are processed in parallel background workers that adapt to the device's hardware.
- **No upload required.** Image bytes stay on your device. There is no upload step, server
  queue, or network transfer of the images.
- **Control over the result.** Choose the output format, quality, compression mode, and
  maximum image size.
- **Built for batches.** Add several images, see per-image estimates and progress, then
  download results individually, as a ZIP, or into a folder where supported.

The application is designed to be one of the fastest image-processing tools available in a
browser. The architecture supports that goal, but the absolute fastest-tool claim will be
confirmed with real-world benchmarks across browsers and devices.

## How to use it

1. Open the app and choose **Select images**, or drop images onto the drop area.
2. Choose the output format and adjust its options.
3. Review the estimated sizes. For several files, select **Compress all**.
4. Download individual results, download the batch as a ZIP, or use **Save to folder** where
   the browser supports it.

Estimates are guidance, not a guarantee. The final size depends on image content, dimensions,
selected settings, and the browser codec.

## Output formats

| Format | Best for | Important details |
| --- | --- | --- |
| JPEG | Photographs and broad compatibility | Lossy; does not preserve transparency |
| PNG | Screenshots, graphics, and transparency | Native lossless mode by default; slower lossless and lossy modes are available |
| WebP | A strong general-purpose web format | Usually smaller than JPEG at similar visual quality |
| AVIF | Very small modern web images | Can produce excellent sizes, but encoding is slower and browser support is newer |

If an output is larger than the original, that is expected for some images and settings.
Compression is not always a size reduction.

## Privacy and browser support

The conversion pipeline runs in the browser using Web Workers and WebAssembly or native
browser image encoders. The application does not send selected image bytes to a server; the
hosting service only delivers the app's static files.

The core workflow is intended for recent desktop and mobile versions of Chrome, Firefox, and
Safari. Browser capabilities differ, especially for AVIF, large batches, folder saving, and
available memory. ZIP download is the compatibility fallback when folder saving is not
available.

The app does not edit, crop, watermark, catalogue, or store an image history. HEIC, animated
GIF, TIFF, and SVG are not current output targets.

## For developers

Requirements: a current Node.js release and npm.

```sh
npm ci
npm run dev       # start local development
npm test          # run unit tests
npm run lint      # check formatting and static rules
npm run typecheck # check TypeScript
npm run build     # typecheck and create the production build
npm run preview   # serve the production build locally
```

The project is a Vite + TypeScript + Preact application. GitHub Pages deploys the build from
`main` through `.github/workflows/pages.yml`.

The main source areas are:

- `src/App.tsx` — application state and user interface
- `src/lib/` — format detection, estimates, device limits, downloads, and ZIP handling
- `src/lib/codecs/` — native and WebAssembly codec selection
- `src/workers/` — decode, resize, estimate, and encode work away from the UI thread
- `src/lib/*.test.ts` — unit tests for the non-UI modules

## Further documentation

- [Architecture](./docs/ARCHITECTURE.md) — the processing pipeline, design choices, and
  trade-offs.
- [Performance](./docs/PERFORMANCE.md) — measured encode times, output sizes, memory model,
  worker scaling, estimate accuracy, and remaining measurement gaps.
- [Scrum TODO roadmap](./docs/TODO.md) — sprint backlog, story points, acceptance criteria,
  tests, parallel work, and the HEIC delivery plan.

## Current validation status

The automated unit-test, typecheck, lint, and production-build commands are the local quality
baseline. Browser-specific release confidence still requires checking codec support,
large-memory behavior, folder saving, and cross-device differences on the actual release
build.

## Known limitations

- Browser memory limits constrain very large images and batches.
- AVIF and some PNG modes can be substantially slower than JPEG or WebP.
- Folder saving requires a browser File System Access API; otherwise use the ZIP download.
- A ZIP stores image bytes without attempting to recompress them, so its size is close to the
  combined output files plus ZIP metadata.
