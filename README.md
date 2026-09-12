# Image Compressor

Image Compressor is a browser app for converting and resizing images in batches.
It runs locally in your browser: image files are processed on your device and are
not uploaded to an application server.

[Open the live app](https://ashcx.github.io/image-compressor-v1/)

## What it does

- Accepts common image files selected from your device or dropped onto the page.
- Converts images to JPEG, PNG, WebP, or AVIF.
- Lets you choose format-specific quality or compression settings.
- Can resize images by setting a maximum long edge.
- Processes batches using background workers so the page stays responsive.
- Shows an estimated output size before processing and the actual size afterwards.
- Downloads one result at a time, downloads the batch as a ZIP, or saves a batch to a folder when the browser supports that feature.

The app does not edit, crop, watermark, catalogue, or store an image history. HEIC,
GIF animation, TIFF, and SVG are not current output targets.

## Quick start

1. Open the app and choose **Select images**, or drop images onto the drop area.
2. Choose the output format and adjust its options if needed.
3. Review the estimates. For several files, select **Compress all**.
4. Download individual results, download a ZIP, or use **Save to folder** where available.

The estimates are guidance, not a guarantee. The final size depends on the image content,
dimensions, selected format, and browser codec.

## Choosing a format

| Format | Good for | Notes |
| --- | --- | --- |
| JPEG | Photographs and broad compatibility | Lossy; does not preserve transparency |
| PNG | Screenshots, graphics, and transparency | Lossless by default; a lossy palette mode is also available |
| WebP | A strong general-purpose web format | Usually smaller than JPEG at similar visual quality |
| AVIF | Very small modern web images | Often gives excellent size, but encoding is slower and browser support is newer |

If an output is larger than the original, that is expected for some images and settings.
Compression is not always a size reduction.

## Privacy and browser support

The conversion pipeline runs in the browser using Web Workers and WebAssembly or native
browser image encoders. The application does not send selected image bytes to a server.
The hosting service only delivers the app's static files.

The core workflow is intended for recent desktop and mobile versions of Chrome, Firefox,
and Safari. Browser capabilities differ, especially for AVIF, large batches, folder saving,
and available memory. The ZIP download is the compatibility fallback when folder saving is
not available.

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

The project is a Vite + TypeScript + Preact application. GitHub Pages deploys the build
from `main` through the workflow in `.github/workflows/pages.yml`.

The main source areas are:

- `src/App.tsx` — application state and user interface
- `src/lib/` — format detection, estimates, device limits, downloads, and ZIP handling
- `src/lib/codecs/` — native and WebAssembly codec selection
- `src/workers/` — decode, resize, estimate, and encode work away from the UI thread
- `src/lib/*.test.ts` — unit tests for the non-UI modules

The detailed pipeline and the reasons behind the main architecture decisions are in
[Architecture](./docs/ARCHITECTURE.md).

## Current validation status

The automated unit-test, typecheck, lint, and production-build commands are maintained as
the local quality baseline. The most important browser-specific risks are codec support,
large-memory behavior, folder saving, and cross-device differences; these need to be
checked against the actual release build when making a release claim.

## Known limitations

- Browser memory limits still constrain very large images and batches.
- AVIF and some PNG modes can be substantially slower than JPEG or WebP.
- Folder saving requires a browser File System Access API; otherwise use the ZIP download.
- A ZIP stores image bytes without attempting to recompress them, so its size is close to the combined output files plus ZIP metadata.
