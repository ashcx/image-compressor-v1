import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { preview } from 'vite'

/**
 * Times the HEIC row preview path in real Chrome: from adding files to every
 * row settling, and what each row ends up showing. Apple HEICs carry no JPEG
 * thumbnail, so every row is expected to show "No preview".
 *
 *   npm run build && node bench/heic-thumbnail.mjs --dir <folder of .heic files>
 */
const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? fallback : args[index + 1]
}
const dir = resolve(option('dir', 'bench/fixtures'))
const label = option('label', 'run')
const runs = Number(option('runs', 5))
const files = readdirSync(dir)
  .filter((name) => /\.hei[cf]$/i.test(name))
  .sort()
  .map((name) => join(dir, name))
if (files.length === 0) throw new Error(`No .heic files in ${dir}`)

const server = await preview({
  preview: { port: 4332, strictPort: true },
  logLevel: 'warn',
})
const url = server.resolvedUrls.local[0]

async function once() {
  const context = await chromium.launchPersistentContext(
    mkdtempSync(join(tmpdir(), 'heic-thumb-')),
    { channel: 'chrome' },
  )
  try {
    const page = context.pages()[0] ?? (await context.newPage())
    await page.goto(url, { waitUntil: 'load' })
    await page.waitForSelector('h1')
    await page.setInputFiles('input[type="file"]', files)
    // Behaviour: every row ends up on the placeholder (no embedded JPEG).
    await page.waitForFunction(
      (n) =>
        document.querySelectorAll('.job__preview-unavailable, .job__thumb img')
          .length >= n,
      Math.min(files.length, 4),
      { timeout: 120_000 },
    )
    const unavailable = await page.locator('.job__preview-unavailable').count()
    // Speed: drive the app's own metadata worker directly, one file at a time,
    // so the numbers are the preview lookup alone and not the estimate queue.
    const payload = files.map((file) => readFileSync(file).toString('base64'))
    const timing = await page.evaluate(async (encoded) => {
      const entry = performance
        .getEntriesByType('resource')
        .find((resource) => /metadata-worker/.test(resource.name))
      const worker = new Worker(entry.name, { type: 'module' })
      const times = []
      let usable = 0
      for (const text of encoded) {
        const bytes = Uint8Array.from(atob(text), (char) => char.charCodeAt(0))
        const file = new File([bytes], 'photo.heic', { type: 'image/heic' })
        const started = performance.now()
        const result = await new Promise((resolve) => {
          worker.onmessage = (event) => resolve(event.data)
          worker.postMessage({ type: 'thumbnail', jobId: 't', file })
        })
        times.push(performance.now() - started)
        if (result.thumbnailBlob) usable += 1
      }
      worker.terminate()
      return { times, usable }
    }, payload)
    const sorted = [...timing.times].sort((a, b) => a - b)
    return {
      perFileMs: sorted[sorted.length >> 1],
      totalMs: timing.times.reduce((sum, value) => sum + value, 0),
      unavailable,
      usable: timing.usable,
    }
  } finally {
    await context.close()
  }
}

const results = []
try {
  for (let run = 0; run < runs; run += 1) results.push(await once())
} finally {
  await server.close()
}
const median = (values) => [...values].sort((a, b) => a - b)[values.length >> 1]
console.log(
  JSON.stringify({
    label,
    files: files.length,
    runs,
    perFileMs: Number(median(results.map((r) => r.perFileMs)).toFixed(1)),
    totalMs: Math.round(median(results.map((r) => r.totalMs))),
    noPreviewRows: results.map((result) => result.unavailable),
    rowsWithThumbnail: results.map((result) => result.usable),
  }),
)
