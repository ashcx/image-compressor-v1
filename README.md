# Client-Side Parallel Image Compressor

Browser-based batch image compression/conversion — JPEG, PNG, WebP, AVIF, JPEG XL —
entirely client-side (no server, no upload). See [DESIGN.md](./DESIGN.md) for the design and
[EXECUTION_PLAN.md](./EXECUTION_PLAN.md) for the delivery plan.

## Preview

https://ashcx.github.io/image-compressor-v1/

> Status: early development. Currently supports single-image conversion to WebP on the main
> thread; worker-pool batch processing and the remaining formats are in progress.
