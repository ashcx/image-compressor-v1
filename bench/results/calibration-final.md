# Benchmark baseline

- Commit: `76e7738`
- Generated: 2026-09-16T10:58:11.951Z
- Node: v22.23.2 · Chromium: 153.0.8010.12
- Counts: 2

| Scenario | Files | Format | Estimate (MB) | Actual (MB) | Actual / estimate | First result (ms) | Complete (ms) | Estimate (ms) | Peak rows | Long tasks | Max frame gap (ms) | Busy/size | Errors |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| jpeg-photo | 2 | jpeg | 0.1 | 0.1 | 1.1 | 917 | 918 | 865 | 2 | 0 (0 ms) | 16.8 | 0/3 | 0 |
| webp-photo | 2 | webp | 0 | 0 | 1.1 | 997 | 997 | 840 | 2 | 0 (0 ms) | 16.8 | 0.5/3 | 0 |
| jpeg-large | 2 | jpeg | 1.2 | 1.2 | 1 | 1627 | 1679 | 1367 | 2 | 0 (0 ms) | 16.8 | 1.3/3 | 0 |
| webp-large | 2 | webp | 0.4 | 0.4 | 1.2 | 2733 | 2733 | 1388 | 2 | 0 (0 ms) | 16.8 | 1.8/3 | 0 |
| jpeg-large-noise | 2 | jpeg | 27.9 | 26.8 | 1 | 2541 | 2541 | 1912 | 2 | 0 (0 ms) | 16.8 | 1.5/3 | 0 |
| webp-large-noise | 2 | webp | 30.6 | 26.8 | 0.9 | 6428 | 6428 | 2541 | 2 | 0 (0 ms) | 33.3 | 1.9/3 | 0 |
| avif-photo | 2 | avif | 0 | 0 | 0.9 | 4040 | 4040 | 851 | 2 | 0 (0 ms) | 16.7 | 1.3/2 | 0 |
| avif-large | 2 | avif | 0.2 | 0.2 | 0.9 | 4370 | 4420 | 1399 | 2 | 0 (0 ms) | 16.8 | 1.9/2 | 0 |
| avif-large-noise | 2 | avif | 53.2 | 24.3 | 0.5 | 20206 | 20310 | 2416 | 2 | 0 (0 ms) | 16.8 | 2/2 | 0 |

Estimates and first-result figures are wall-clock from file injection. For batches,
compression is triggered after estimation settles, so `estimateMs` separates estimation
from encode throughput. Frame and long-task windows span injection to completion.
