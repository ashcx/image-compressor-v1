# Preview strategy benchmark

- Input: `/test_pictures/IMG_1792.jpeg`
- Repeats after cold run: 3
- Browser: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/153.0.8010.12 Safari/537.36

| Source | Preparation | Strategy | Path | Cold ms | Median ms | p95 ms | Output | Estimated peak raster | Page heap peak | Max frame gap | >50 ms frames | Decode size |
| --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| jpeg | 0.1 | current-jpeg | native | 213.9 | 172.6 | 174.7 | 3.8 KB | 822.0 KB | 9.54 MB | 16.8 ms | 0 | 256×384 |
| jpeg | 0.1 | small-bitmap-canvas | native | 189.9 | 228.2 | 230.7 | — | 108.0 KB | 9.54 MB | 16.8 ms | 0 | 96×144 |
| jpeg | 0.1 | small-jpeg | native | 202.9 | 174.4 | 181.7 | 3.9 KB | 108.0 KB | 9.54 MB | 16.8 ms | 0 | 96×144 |
| png | 1208.4 | current-jpeg | native | 593.8 | 603.3 | 615.7 | 3.8 KB | 822.0 KB | 9.54 MB | 16.8 ms | 0 | 256×384 |
| png | 1208.4 | small-bitmap-canvas | native | 609.3 | 589.2 | 677.2 | — | 108.0 KB | 9.54 MB | 16.8 ms | 0 | 96×144 |
| png | 1208.4 | small-jpeg | native | 564.3 | 595.1 | 705.2 | 3.9 KB | 108.0 KB | 9.54 MB | 16.8 ms | 0 | 96×144 |
| webp | 2345.1 | current-jpeg | native | 270.9 | 368.1 | 404.0 | 3.8 KB | 822.0 KB | 9.54 MB | 16.8 ms | 0 | 256×384 |
| webp | 2345.1 | small-bitmap-canvas | native | 314.5 | 303.6 | 322.4 | — | 108.0 KB | 9.54 MB | 16.8 ms | 0 | 96×144 |
| webp | 2345.1 | small-jpeg | native | 301.3 | 314.0 | 320.7 | 3.9 KB | 108.0 KB | 9.54 MB | 16.8 ms | 0 | 96×144 |
| avif | 10922.2 | current-jpeg | native | 333.0 | 277.4 | 304.4 | 3.8 KB | 822.0 KB | 9.54 MB | 16.8 ms | 0 | 256×384 |
| avif | 10922.2 | small-bitmap-canvas | native | 335.1 | 306.3 | 413.7 | — | 108.0 KB | 9.54 MB | 16.8 ms | 0 | 96×144 |
| avif | 10922.2 | small-jpeg | native | 300.0 | 269.6 | 282.6 | 3.9 KB | 108.0 KB | 9.54 MB | 16.8 ms | 0 | 96×144 |
| heic | 9428.5 | current-jpeg | codec-fallback | 3822.5 | 3209.8 | 3461.5 | 3.8 KB | 99.24 MB | 9.54 MB | 16.8 ms | 0 | 4160×6240 |
| heic | 9428.5 | small-bitmap-canvas | codec-fallback | 3244.6 | 3313.1 | 3725.4 | — | 99.08 MB | 9.54 MB | 16.8 ms | 0 | 4160×6240 |
| heic | 9428.5 | small-jpeg | codec-fallback | 4281.5 | 3328.0 | 3507.3 | 3.9 KB | 99.08 MB | 9.54 MB | 16.8 ms | 0 | 4160×6240 |

Estimated raster memory is width × height × 4 for tracked RGBA surfaces; it does not include decoder, WASM heap, browser image cache, or GPU overhead. Max frame gap is a synthetic offscreen-scroll animation probe while the worker runs, not a manual interaction test.
