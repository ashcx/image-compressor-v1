#!/usr/bin/env node
// Measures the shipped quality presets for PSNR and windowed SSIM against the
// decoded source, so the format-specific values in `formats.ts` can be
// recalibrated against a representative image.
//
// Usage: node bench/preset-quality.mjs /path/to/photo.jpg
//
// The scripts runs against the Vite dev server and imports the app's own codec
// registry, so JPEG/WebP use the browser's native encoders and AVIF/HEIC use
// the same WASM codecs the app ships. Prints one JSON object to stdout.
//
// SSIM is 8x8 non-overlapping windows over Rec.601 luma with the standard
// C1 = (0.01 * 255)^2 / C2 = (0.03 * 255)^2 constants.
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const inputPath = process.argv[2]
if (!inputPath) {
  throw new Error('Usage: node bench/preset-quality.mjs /path/to/image.jpg')
}

// Quality values are the app's per-format presets (see `formats.ts`), not a
// shared scale. AVIF and HEIC additionally run at the app's default speed.
const PRESETS = {
  jpeg: [50, 75, 85, 94],
  webp: [70, 85, 92, 96],
  avif: [58, 75, 85, 95],
  heic: [43, 51, 58, 80],
}

const inputBytes = readFileSync(inputPath)
const contentType = inputPath.toLowerCase().endsWith('.png')
  ? 'image/png'
  : 'image/jpeg'
const headed = process.env.HEADED === '1'

const server = await createServer({
  server: { port: 4405, strictPort: false },
  plugins: [
    {
      name: 'bench-input',
      configureServer(vite) {
        vite.middlewares.use('/__input__', (_request, response) => {
          response.setHeader('Content-Type', contentType)
          response.setHeader('Content-Length', inputBytes.length)
          response.end(inputBytes)
        })
      },
    },
  ],
})
await server.listen()
const url = server.resolvedUrls.local[0]
const registryUrl = String(new URL('src/lib/codecs/registry.ts', url))

const browser = await chromium.launch({
  headless: !headed,
  executablePath: process.env.CHROME_BIN || undefined,
  args: ['--no-sandbox'],
})
try {
  const page = await browser.newPage()
  page.on('pageerror', (error) =>
    console.error(`browser page error: ${error.message}`),
  )
  await page.goto(url, { waitUntil: 'domcontentloaded' })

  const result = await page.evaluate(
    async ({ registryUrl, presets }) => {
      const { getCodec } = await import(/* @vite-ignore */ registryUrl)

      const bitmap = await createImageBitmap(
        await fetch('/__input__').then((response) => response.blob()),
      )
      const width = bitmap.width
      const height = bitmap.height
      const sourceCanvas = new OffscreenCanvas(width, height)
      const sourceContext = sourceCanvas.getContext('2d', {
        willReadFrequently: true,
      })
      sourceContext.drawImage(bitmap, 0, 0)
      bitmap.close()
      const source = sourceContext.getImageData(0, 0, width, height)
      const imageSource = { width, height, canvas: sourceCanvas }

      const luma = (data) => {
        const out = new Float64Array(width * height)
        for (let i = 0, j = 0; i < data.length; i += 4, j += 1) {
          out[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
        }
        return out
      }
      const referenceY = luma(source.data)
      const C1 = (0.01 * 255) ** 2
      const C2 = (0.03 * 255) ** 2
      const WINDOW = 8

      function metrics(decoded) {
        let squaredError = 0
        for (let i = 0; i < source.data.length; i += 4) {
          for (let channel = 0; channel < 3; channel += 1) {
            const difference = source.data[i + channel] - decoded[i + channel]
            squaredError += difference * difference
          }
        }
        const mse = squaredError / ((source.data.length / 4) * 3)
        const psnr = mse === 0 ? Infinity : 10 * Math.log10(65025 / mse)

        const comparisonY = luma(decoded)
        let ssimSum = 0
        let windows = 0
        for (let y0 = 0; y0 + WINDOW <= height; y0 += WINDOW) {
          for (let x0 = 0; x0 + WINDOW <= width; x0 += WINDOW) {
            let sumRef = 0
            let sumCmp = 0
            for (let y = y0; y < y0 + WINDOW; y += 1) {
              const row = y * width
              for (let x = x0; x < x0 + WINDOW; x += 1) {
                sumRef += referenceY[row + x]
                sumCmp += comparisonY[row + x]
              }
            }
            const count = WINDOW * WINDOW
            const meanRef = sumRef / count
            const meanCmp = sumCmp / count
            let varRef = 0
            let varCmp = 0
            let covariance = 0
            for (let y = y0; y < y0 + WINDOW; y += 1) {
              const row = y * width
              for (let x = x0; x < x0 + WINDOW; x += 1) {
                const index = row + x
                const a = referenceY[index] - meanRef
                const b = comparisonY[index] - meanCmp
                varRef += a * a
                varCmp += b * b
                covariance += a * b
              }
            }
            varRef /= count - 1
            varCmp /= count - 1
            covariance /= count - 1
            ssimSum +=
              ((2 * meanRef * meanCmp + C1) * (2 * covariance + C2)) /
              ((meanRef * meanRef + meanCmp * meanCmp + C1) *
                (varRef + varCmp + C2))
            windows += 1
          }
        }
        return {
          psnr: Number.isFinite(psnr) ? Math.round(psnr * 100) / 100 : null,
          ssim: Math.round((ssimSum / windows) * 10000) / 10000,
        }
      }

      const toImageData = (imageBitmap) => {
        const canvas = new OffscreenCanvas(
          imageBitmap.width,
          imageBitmap.height,
        )
        const context = canvas.getContext('2d')
        context.drawImage(imageBitmap, 0, 0)
        return context.getImageData(0, 0, imageBitmap.width, imageBitmap.height)
      }

      // HEIC has no native Chromium decoder, so use the WASM fallback there;
      // JPEG/WebP/AVIF decode losslessly through the browser.
      async function decodedPixels(codec, blob) {
        if (codec.format === 'heic') {
          return (await codec.decode(await blob.arrayBuffer())).data
        }
        const imageBitmap = await createImageBitmap(blob)
        const data = toImageData(imageBitmap)
        imageBitmap.close()
        return data.data
      }

      const rows = { jpeg: [], webp: [], avif: [], heic: [] }
      for (const format of ['jpeg', 'webp', 'avif', 'heic']) {
        const codec = await getCodec(format)
        for (const quality of presets[format]) {
          const options = { quality }
          if (format === 'avif') options.speed = 10
          if (format === 'heic') options.speed = 0
          const blob = await codec.encode(imageSource, options)
          rows[format].push({
            quality,
            bytes: blob.size,
            ...metrics(await decodedPixels(codec, blob)),
          })
        }
      }

      return { width, height, megapixels: (width * height) / 1e6, rows }
    },
    { registryUrl, presets: PRESETS },
  )

  console.log(JSON.stringify({ file: basename(inputPath), ...result }, null, 2))
} finally {
  await browser.close()
  await server.close()
}
