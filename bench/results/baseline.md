# Benchmark baseline

- Commit: `9b4e4df`
- Generated: 2026-09-13T04:34:16.761Z
- Node: v22.23.2 · Chromium: 153.0.8010.12
- Counts: 25, 60, 240

| Scenario | Files | Format | First result (ms) | Complete (ms) | Estimate (ms) | Peak rows | Long tasks | Max frame gap (ms) | Busy/size | Errors |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| jpeg-photo | 25 | jpeg | 1063 | 1341 | 1004 | 12 | 0 (0 ms) | 16.8 | 2.1/3 | 0 |
| jpeg-photo-resize | 25 | jpeg | 1049 | 1317 | 996 | 12 | 0 (0 ms) | 16.8 | 2.1/3 | 0 |
| webp-photo | 25 | webp | 4912 | 6896 | 4688 | 12 | 0 (0 ms) | 16.8 | 2.7/3 | 0 |
| png-screenshot | 25 | png | 999 | 1277 | 939 | 12 | 0 (0 ms) | 33.3 | 1.9/3 | 0 |
| png-screenshot-lossless | 25 | png | 1748 | 3533 | 1525 | 12 | 0 (0 ms) | 16.8 | 2.7/2 | 0 |
| avif-photo | 25 | avif | 3413 | 8128 | 2791 | 12 | 0 (0 ms) | 33.3 | 2.9/2 | 0 |
| jpeg-mixed | 25 | jpeg | 1677 | 2644 | 1611 | 12 | 0 (0 ms) | 16.8 | 2.5/3 | 0 |
| jpeg-photo | 60 | jpeg | 1238 | 2421 | 1183 | 12 | 0 (0 ms) | 16.8 | 2.7/3 | 0 |
| jpeg-photo-resize | 60 | jpeg | 1259 | 2472 | 1204 | 12 | 0 (0 ms) | 16.8 | 2.7/3 | 0 |
| webp-photo | 60 | webp | 2717 | 10477 | 2488 | 12 | 0 (0 ms) | 16.8 | 2.9/3 | 0 |
| png-screenshot | 60 | png | 1048 | 1726 | 989 | 12 | 0 (0 ms) | 16.8 | 2.6/3 | 0 |
| png-screenshot-lossless | 60 | png | 1828 | 6424 | 1666 | 12 | 0 (0 ms) | 16.8 | 2.8/2 | 0 |
| jpeg-mixed | 60 | jpeg | 1746 | 3942 | 1693 | 12 | 0 (0 ms) | 16.8 | 2.8/3 | 0 |
| jpeg-photo | 240 | jpeg | 1402 | 6733 | 1347 | 12 | 0 (0 ms) | 16.8 | 2.9/3 | 0 |
| jpeg-photo-resize | 240 | jpeg | 1401 | 6960 | 1339 | 12 | 0 (0 ms) | 33.3 | 2.9/3 | 0 |
| webp-photo | 240 | webp | 3359 | 26911 | 3094 | 12 | 0 (0 ms) | 33.4 | 2.9/3 | 0 |
| png-screenshot | 240 | png | 1330 | 5772 | 1270 | 12 | 0 (0 ms) | 33.3 | 2.9/3 | 0 |
| png-screenshot-lossless | 240 | png | 2338 | 28349 | 2114 | 12 | 0 (0 ms) | 33.4 | 3/2 | 0 |
| jpeg-mixed | 240 | jpeg | 4240 | 15911 | 4182 | 12 | 1 (60 ms) | 66.6 | 2.9/3 | 0 |

Estimates and first-result figures are wall-clock from file injection. For batches,
compression is triggered after estimation settles, so `estimateMs` separates estimation
from encode throughput. Frame and long-task windows span injection to completion.
