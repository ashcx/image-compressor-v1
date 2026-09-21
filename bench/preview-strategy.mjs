#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises'
import process from 'node:process'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const DEFAULT_FORMATS = ['jpeg', 'png', 'webp', 'avif', 'heic']

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}

const formats = (option('formats', DEFAULT_FORMATS.join(',')) ?? '')
  .split(',')
  .map((format) => format.trim())
  .filter(Boolean)
const repeats = Number(option('repeats', '3'))
const input = option('input', '/test_pictures/IMG_1792.jpeg')
const label = option('label', 'preview-strategy')
const headed = process.argv.includes('--headed')

const server = await createServer({
  root: process.cwd(),
  server: { port: 0 },
  logLevel: 'error',
})
await server.listen()
const baseUrl = server.resolvedUrls.local[0]
const inputUrl = /^https?:\/\//.test(input)
  ? input
  : new URL(input.replace(/^\/+/, ''), baseUrl).toString()
const browser = await chromium.launch({ headless: !headed })

try {
  const page = await browser.newPage()
  page.setDefaultTimeout(600_000)
  await page.goto(`${baseUrl}/bench/preview-strategy.html`, {
    waitUntil: 'load',
  })
  const report = await page.evaluate(
    ({ inputPath, formats: requestedFormats, repeats: requestedRepeats }) =>
      globalThis.__previewBenchRun({
        inputPath,
        formats: requestedFormats,
        repeats: requestedRepeats,
      }),
    { inputPath: inputUrl, formats, repeats },
  )

  const output = {
    generatedAt: new Date().toISOString(),
    input,
    inputUrl,
    repeats,
    ...report,
  }
  await mkdir('bench/results', { recursive: true })
  await writeFile(
    `bench/results/${label}.json`,
    `${JSON.stringify(output, null, 2)}\n`,
  )
  await writeFile(`bench/results/${label}.md`, renderMarkdown(output))
  console.log(renderMarkdown(output))
} finally {
  await browser.close()
  await server.close()
}

function formatBytes(value) {
  if (!value) return '—'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(2)} MB`
}

function renderMarkdown(report) {
  const lines = [
    '# Preview strategy benchmark',
    '',
    `- Input: \`${report.input}\``,
    `- Repeats after cold run: ${report.repeats}`,
    `- Browser: ${report.browser}`,
    '',
    '| Source | Preparation | Strategy | Path | Cold ms | Median ms | p95 ms | Output | Estimated peak raster | Page heap peak | Max frame gap | >50 ms frames | Decode size |',
    '| --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
  ]
  for (const source of report.results) {
    if (source.error) {
      lines.push(
        `| ${source.format} | ${source.preparationMs.toFixed(1)} | — | — | — | — | — | ERROR | — | — | — | — | ${source.error} |`,
      )
      continue
    }
    for (const result of source.results) {
      lines.push(
        `| ${source.format} | ${source.preparationMs.toFixed(1)} | ${result.strategy} | ${result.path} | ${result.coldMs.toFixed(1)} | ${result.medianMs.toFixed(1)} | ${result.p95Ms.toFixed(1)} | ${formatBytes(result.outputBytes)} | ${formatBytes(result.estimatedPeakRasterBytes)} | ${formatBytes(source.pageHeapPeakBytes)} | ${source.maxFrameGapMs.toFixed(1)} ms | ${source.framesOver50Ms} | ${result.decodedWidth}×${result.decodedHeight} |`,
      )
    }
  }
  lines.push(
    '',
    'Estimated raster memory is width × height × 4 for tracked RGBA surfaces; it does not include decoder, WASM heap, browser image cache, or GPU overhead. Max frame gap is a synthetic offscreen-scroll animation probe while the worker runs, not a manual interaction test.',
  )
  return `${lines.join('\n')}\n`
}
