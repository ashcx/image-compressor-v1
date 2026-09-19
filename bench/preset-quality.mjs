#!/usr/bin/env node
// Measures the shipped quality presets for PSNR and windowed SSIM against the
// decoded source, so the format-specific values in `formats.ts` can be
// recalibrated against a representative image.
//
// Usage: node bench/preset-quality.mjs /path/to/photo.jpg
//
// JPEG and WebP use Chrome's native canvas encoders (the app's path on
// Chromium). HEIC uses the vendored elheif/libheif/kvazaar build at the
// `ultrafast` preset. Prints one JSON object to stdout.
//
// SSIM is 8x8 non-overlapping windows over Rec.601 luma with the standard
// C1 = (0.01 * 255)^2 / C2 = (0.03 * 255)^2 constants.
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { basename, extname } from 'node:path'
import { chromium } from 'playwright'

const inputPath = process.argv[2]
if (!inputPath) {
  throw new Error('Usage: node bench/preset-quality.mjs /path/to/image.jpg')
}

const PRESETS = {
  jpeg: [50, 75, 85, 94],
  // WebP values are the app's WebP-specific presets, not the JPEG numbers.
  webp: [70, 85, 92, 96],
  // HEIC values are the app's HEIC-specific presets (libheif quality -> QP).
  heic: [43, 51, 58, 80],
}

const inputBytes = readFileSync(inputPath)
const contentType =
  extname(inputPath).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg'
const wasmPath = new URL('../vendor/elheif/pkg/elheif-wasm.js', import.meta.url)
const headed = process.env.HEADED === '1'

const server = createServer((request, response) => {
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')

  if (request.url === '/') {
    response.setHeader('Content-Type', 'text/html')
    response.end('<!doctype html><title>preset quality</title>')
    return
  }
  if (request.url === '/input') {
    response.setHeader('Content-Type', contentType)
    response.setHeader('Content-Length', inputBytes.length)
    response.end(inputBytes)
    return
  }
  if (request.url === '/elheif-wasm.js') {
    response.setHeader('Content-Type', 'text/javascript')
    response.end(readFileSync(wasmPath))
    return
  }
  response.statusCode = 404
  response.end('not found')
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port

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
  await page.goto(`http://127.0.0.1:${port}/`)
  await page.evaluate(() => {
    globalThis.Module = {}
  })
  await page.addScriptTag({ url: `http://127.0.0.1:${port}/elheif-wasm.js` })
  await page.evaluate(() => globalThis.__init__ELHEIF_MODULE(globalThis.Module))
  await page.waitForFunction(
    () => typeof globalThis.Module?.jsEncodeImage === 'function',
  )

  const result = await page.evaluate(async (presets) => {
    const bitmap = await createImageBitmap(
      await fetch('/input').then((response) => response.blob()),
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
      const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height)
      const context = canvas.getContext('2d')
      context.drawImage(imageBitmap, 0, 0)
      return context.getImageData(0, 0, imageBitmap.width, imageBitmap.height)
    }

    async function encodeCanvas(type, quality) {
      const blob = await sourceCanvas.convertToBlob({
        type,
        quality: quality / 100,
      })
      const decodedBitmap = await createImageBitmap(blob)
      const decoded = toImageData(decodedBitmap)
      decodedBitmap.close()
      return {
        quality,
        bytes: blob.size,
        ...metrics(decoded.data),
      }
    }

    const rows = { jpeg: [], webp: [], heic: [] }
    for (const quality of presets.jpeg) {
      rows.jpeg.push(await encodeCanvas('image/jpeg', quality))
    }
    for (const quality of presets.webp) {
      rows.webp.push(await encodeCanvas('image/webp', quality))
    }
    for (const quality of presets.heic) {
      const encoded = globalThis.Module.jsEncodeImage(
        new Uint8Array(source.data.buffer.slice(0)),
        width,
        height,
        quality,
        'ultrafast',
      )
      if (encoded.err) throw new Error(`HEIC encode: ${encoded.err}`)
      const decoded = globalThis.Module.jsDecodeImage(
        new Uint8Array(encoded.data),
      )
      if (decoded.err) throw new Error(`HEIC decode: ${decoded.err}`)
      const planeBitmap = decoded.data[0]
      if (!planeBitmap) throw new Error('HEIC decode returned no image')
      const plane = planeBitmap.data.slice(0, width * height * 4)
      rows.heic.push({
        quality,
        bytes: encoded.data.length,
        ...metrics(plane),
      })
    }

    return { width, height, megapixels: (width * height) / 1e6, rows }
  }, PRESETS)

  console.log(JSON.stringify({ file: basename(inputPath), ...result }, null, 2))
} finally {
  await browser.close()
  server.close()
}
