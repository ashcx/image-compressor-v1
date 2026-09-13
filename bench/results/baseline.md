# Benchmark baseline

- Commit: `a7f5a27`
- Generated: 2026-09-13T04:56:33.901Z
- Node: v22.23.2 · Chromium: 153.0.8010.12
- Counts: 25, 60, 240

| Scenario | Files | Format | First result (ms) | Complete (ms) | Estimate (ms) | Peak rows | Long tasks | Max frame gap (ms) | Busy/size | Errors |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| jpeg-photo | 25 | jpeg | 1051 | 1268 | 996 | 12 | 0 (0 ms) | 16.8 | 2/3 | 0 |
| jpeg-photo-resize | 25 | jpeg | 1054 | 1268 | 998 | 12 | 0 (0 ms) | 16.8 | 2/3 | 0 |
| webp-photo | 25 | webp | 1345 | 2263 | 1231 | 12 | 0 (0 ms) | 16.8 | 2.3/3 | 0 |
| png-screenshot | 25 | png | 945 | 1106 | 886 | 12 | 0 (0 ms) | 16.8 | 1.8/3 | 0 |
| png-screenshot-lossless | 25 | png | 999 | 2068 | 892 | 12 | 0 (0 ms) | 16.8 | 2.5/2 | 0 |
| avif-photo | 25 | avif | 2870 | 7381 | 2435 | 12 | 0 (0 ms) | 16.8 | 2.8/2 | 0 |
| jpeg-mixed | 25 | jpeg | 3662 | 4428 | 3603 | 12 | 0 (0 ms) | 16.8 | 2.3/3 | 0 |
| jpeg-photo | 60 | jpeg | 1224 | 2357 | 1161 | 12 | 0 (0 ms) | 16.8 | 2.7/3 | 0 |
| jpeg-photo-resize | 60 | jpeg | 1228 | 2226 | 1172 | 12 | 0 (0 ms) | 16.8 | 2.6/3 | 0 |
| webp-photo | 60 | webp | 2588 | 7452 | 2426 | 12 | 0 (0 ms) | 16.8 | 2.8/3 | 0 |
| png-screenshot | 60 | png | 1017 | 1783 | 956 | 12 | 0 (0 ms) | 16.8 | 2.6/3 | 0 |
| png-screenshot-lossless | 60 | png | 1820 | 6862 | 1662 | 12 | 0 (0 ms) | 33.3 | 2.8/2 | 0 |
| jpeg-mixed | 60 | jpeg | 2672 | 5488 | 2619 | 12 | 0 (0 ms) | 33.4 | 2.7/3 | 0 |
| jpeg-photo | 240 | jpeg | 3460 | 9279 | 3405 | 12 | 0 (0 ms) | 33.3 | 2.9/3 | 0 |
| jpeg-photo-resize | 240 | jpeg | 1541 | 6543 | 1475 | 12 | 0 (0 ms) | 33.4 | 2.9/3 | 0 |
| webp-photo | 240 | webp | 2556 | 24720 | 2385 | 12 | 0 (0 ms) | 16.8 | 2.9/3 | 0 |
| png-screenshot | 240 | png | 1239 | 5093 | 1178 | 12 | 0 (0 ms) | 16.8 | 2.9/3 | 0 |
| png-screenshot-lossless | 240 | png | 2340 | 25283 | 2010 | 12 | 0 (0 ms) | 33.3 | 3/2 | 0 |
| jpeg-mixed | 240 | jpeg | 2859 | 13206 | 2804 | 12 | 0 (0 ms) | 33.4 | 2.9/3 | 0 |

Estimates and first-result figures are wall-clock from file injection. For batches,
compression is triggered after estimation settles, so `estimateMs` separates estimation
from encode throughput. Frame and long-task windows span injection to completion.
