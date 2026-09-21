#!/usr/bin/env node
// Compares warm native WebP encoding with libwebp WASM methods 0-6.
//
// Usage:
//   node bench/webp-compare.mjs /path/to/photo.jpg
//   node bench/webp-compare.mjs /path/to/photo.jpg --quality 75 --repeats 5
//
// The benchmark uses the same decoded pixels in separate workers. Native timing
// measures OffscreenCanvas.convertToBlob. WASM timing includes the ImageData
// readback required by the app's WASM path, while also reporting the codec-only
// portion separately.
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const inputPath = process.argv[2]
if (!inputPath) {
  throw new Error(
    'Usage: node bench/webp-compare.mjs /path/to/image.jpg [--quality 75] [--repeats 5]',
  )
}

function option(name, fallback) {
  const index = process.argv.indexOf(name)
  const value = index >= 0 ? Number(process.argv[index + 1]) : fallback
  if (!Number.isFinite(value)) throw new Error(`${name} requires a number`)
  return value
}

const quality = option('--quality', 75)
const repeats = option('--repeats', 5)
const inputBytes = readFileSync(inputPath)
const contentType = inputPath.toLowerCase().endsWith('.png')
  ? 'image/png'
  : 'image/jpeg'

const server = await createServer({
  logLevel: 'error',
  server: { port: 4406, strictPort: false },
  plugins: [
    {
      name: 'webp-compare-input',
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
const clientUrl = String(new URL('bench/webp-compare-client.ts', url))
const browser = await chromium.launch({
  headless: process.env.HEADED !== '1',
  executablePath: process.env.CHROME_BIN || undefined,
  args: ['--no-sandbox'],
})

try {
  const page = await browser.newPage()
  page.on('pageerror', (error) => {
    console.error(`browser page error: ${error.message}`)
  })
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  const result = await page.evaluate(
    async ({ clientUrl, quality, repeats }) => {
      const { run } = await import(/* @vite-ignore */ clientUrl)
      return run('/__input__', quality, repeats)
    },
    { clientUrl, quality, repeats },
  )
  console.log(JSON.stringify({ file: basename(inputPath), ...result }, null, 2))
} finally {
  await browser.close()
  await server.close()
}
