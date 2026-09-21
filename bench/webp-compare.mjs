#!/usr/bin/env node
// Compares warm native WebP encoding with libwebp WASM methods 0-6.
//
// Usage:
//   node bench/webp-compare.mjs /path/to/photo.jpg
//   node bench/webp-compare.mjs /path/to/photo.jpg --quality 75 --repeats 5
//   node bench/webp-compare.mjs --dir ./test_pictures --limit 4 --methods 0,1,2 --quality-metrics
//   node bench/webp-compare.mjs --dir ./test_pictures --files DSCF7103.jpeg,DSCF7104.jpeg,DSCF7122.jpeg --quality 85 --quality-metrics --metric-edge 6240
//
// The benchmark uses the same decoded pixels in separate workers. Native timing
// measures OffscreenCanvas.convertToBlob. WASM timing includes the ImageData
// readback required by the app's WASM path, while also reporting the codec-only
// portion separately.
import { readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const directoryFlag = process.argv.indexOf('--dir')
const directoryPath =
  directoryFlag >= 0 ? process.argv[directoryFlag + 1] : undefined
const inputPath =
  process.argv[2] && !process.argv[2].startsWith('--')
    ? process.argv[2]
    : undefined
if (!inputPath && !directoryPath) {
  throw new Error(
    'Usage: node bench/webp-compare.mjs /path/to/image.jpg [--quality 75] [--repeats 5] or --dir ./test_pictures [--methods 0,1,2]',
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
const limitFlag = process.argv.indexOf('--limit')
const limit =
  limitFlag >= 0
    ? Number(process.argv[limitFlag + 1])
    : Number.POSITIVE_INFINITY
if (!Number.isFinite(limit) && limit !== Number.POSITIVE_INFINITY) {
  throw new Error('--limit requires a number')
}
const methodsFlag = process.argv.indexOf('--methods')
const methods =
  methodsFlag >= 0
    ? process.argv[methodsFlag + 1]
        .split(',')
        .map((value) => Number(value.trim()))
    : [0, 1, 2]
const measureQualityMetrics = process.argv.includes('--quality-metrics')
const metricEdge = option('--metric-edge', 1024)
const filesFlag = process.argv.indexOf('--files')
const requestedNames =
  filesFlag >= 0
    ? process.argv[filesFlag + 1]
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean)
    : null
if (requestedNames && !directoryPath) {
  throw new Error('--files requires --dir')
}

const directoryNames = directoryPath
  ? readdirSync(directoryPath)
      .filter((name) => /\.jpe?g$/i.test(name))
      .sort()
  : []
const selectedNames =
  requestedNames ??
  (Number.isFinite(limit) && limit < directoryNames.length
    ? Array.from(
        { length: limit },
        (_, index) =>
          directoryNames[
            Math.round(
              (index * (directoryNames.length - 1)) / Math.max(1, limit - 1),
            )
          ],
      )
    : directoryNames)
const inputPaths = directoryPath
  ? selectedNames.map((name) => join(directoryPath, name))
  : [inputPath]
const inputs = inputPaths.map((path) => ({
  name: basename(path),
  bytes: readFileSync(path),
}))
const inputByName = new Map(inputs.map((input) => [input.name, input]))

const server = await createServer({
  logLevel: 'error',
  server: { port: 4406, strictPort: false },
  plugins: [
    {
      name: 'webp-compare-input',
      configureServer(vite) {
        vite.middlewares.use('/__input__', (request, response) => {
          const requestPath = request.url?.split('?')[0] ?? ''
          const name = decodeURIComponent(
            requestPath.replace(/^\/__input__\//, '').replace(/^\//, ''),
          )
          const input = name ? inputByName.get(name) : inputs[0]
          if (!input) {
            response.statusCode = 404
            response.end('Not found')
            return
          }
          response.setHeader('Content-Type', 'image/jpeg')
          response.setHeader('Content-Length', input.bytes.length)
          response.end(input.bytes)
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
  args: ['--no-sandbox', '--enable-precise-memory-info'],
})

try {
  const page = await browser.newPage()
  page.on('pageerror', (error) => {
    console.error(`browser page error: ${error.message}`)
  })
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  if (directoryPath) {
    const inputOrigin = new URL(url).origin
    const result = await page.evaluate(
      async ({
        clientUrl,
        quality,
        methods,
        inputs,
        measureQualityMetrics,
        metricEdge,
      }) => {
        const { runBatch } = await import(/* @vite-ignore */ clientUrl)
        return runBatch(
          inputs,
          quality,
          methods,
          measureQualityMetrics,
          metricEdge,
        )
      },
      {
        clientUrl,
        quality,
        methods,
        measureQualityMetrics,
        metricEdge,
        inputs: inputs.map((input) => ({
          name: input.name,
          url: `${inputOrigin}/__input__/${encodeURIComponent(input.name)}`,
        })),
      },
    )
    console.log(
      JSON.stringify({ directory: directoryPath, ...result }, null, 2),
    )
  } else {
    const result = await page.evaluate(
      async ({ clientUrl, quality, repeats }) => {
        const { run } = await import(/* @vite-ignore */ clientUrl)
        return run('/__input__', quality, repeats)
      },
      { clientUrl, quality, repeats },
    )
    console.log(
      JSON.stringify({ file: basename(inputPath), ...result }, null, 2),
    )
  }
} finally {
  await browser.close()
  await server.close()
}
