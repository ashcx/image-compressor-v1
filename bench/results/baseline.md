# Benchmark baseline

- Commit: `3276daa`
- Generated: 2026-09-13T04:14:24.205Z
- Node: v22.23.2 · Chromium: 153.0.8010.12
- Counts: 25, 60, 240

| Scenario | Files | Format | First result (ms) | Complete (ms) | Estimate (ms) | Long tasks | Max frame gap (ms) | Busy/size | Errors |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| jpeg-photo | 25 | jpeg | 1047 | 1329 | 992 | 0 (0 ms) | 16.8 | 1.9/3 | 0 |
| jpeg-photo-resize | 25 | jpeg | 1037 | 1255 | 977 | 0 (0 ms) | 16.8 | 2/3 | 0 |
| webp-photo | 25 | webp | 4653 | 5630 | 4530 | 0 (0 ms) | 16.8 | 2.4/3 | 0 |
| png-screenshot | 25 | png | 1009 | 1238 | 947 | 0 (0 ms) | 16.8 | 2/3 | 0 |
| png-screenshot-lossless | 25 | png | 1822 | 3753 | 1664 | 0 (0 ms) | 33.4 | 2.7/2 | 0 |
| avif-photo | 25 | avif | 3061 | 7486 | 2509 | 0 (0 ms) | 16.8 | 2.8/2 | 0 |
| jpeg-mixed | 25 | jpeg | 1915 | 2930 | 1853 | 0 (0 ms) | 16.8 | 2.3/3 | 0 |
| jpeg-photo | 60 | jpeg | 1203 | 2336 | 1146 | 0 (0 ms) | 33.3 | 2.6/3 | 0 |
| jpeg-photo-resize | 60 | jpeg | 1196 | 2407 | 1142 | 0 (0 ms) | 16.8 | 2.7/3 | 0 |
| webp-photo | 60 | webp | 2599 | 7323 | 2436 | 0 (0 ms) | 16.8 | 2.8/3 | 0 |
| png-screenshot | 60 | png | 1028 | 3895 | 975 | 0 (0 ms) | 33.3 | 2.5/3 | 0 |
| png-screenshot-lossless | 60 | png | 1745 | 6286 | 1533 | 0 (0 ms) | 16.8 | 2.8/2 | 0 |
| jpeg-mixed | 60 | jpeg | 1762 | 3853 | 1705 | 0 (0 ms) | 33.3 | 2.8/3 | 0 |
| jpeg-photo | 240 | jpeg | 1359 | 6705 | 1303 | 0 (0 ms) | 83.3 | 2.9/3 | 0 |
| jpeg-photo-resize | 240 | jpeg | 1331 | 6730 | 1274 | 1 (65 ms) | 83.4 | 2.9/3 | 0 |
| webp-photo | 240 | webp | 2920 | 26073 | 2700 | 1 (50 ms) | 50 | 3/3 | 0 |
| png-screenshot | 240 | png | 1071 | 4821 | 1012 | 0 (0 ms) | 100 | 2.9/3 | 0 |
| png-screenshot-lossless | 240 | png | 1953 | 24502 | 1794 | 1 (58 ms) | 50 | 2.9/2 | 0 |
| jpeg-mixed | 240 | jpeg | 2156 | 11981 | 2104 | 0 (0 ms) | 100.1 | 2.9/3 | 0 |

Estimates and first-result figures are wall-clock from file injection. For batches,
compression is triggered after estimation settles, so `estimateMs` separates estimation
from encode throughput. Frame and long-task windows span injection to completion.
