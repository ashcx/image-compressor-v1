#!/usr/bin/env node
// Diagnostic: run several batches in one tab and track heap across runs, with
// forced GC, optionally clearing the queue between runs. Use to tell a real
// leak from retained (but releasable) job memory.
import { chromium } from 'playwright'
import { preview } from 'vite'

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index !== -1 && process.argv[index + 1]
    ? process.argv[index + 1]
    : fallback
}

const iterations = Number(arg('iterations', '6'))
const count = Number(arg('count', '150'))
const clear = process.argv.includes('--clear')
const label = clear ? 'clear' : 'retain'

const server = await preview({
  preview: { port: 4322, strictPort: true },
  logLevel: 'warn',
})
const baseUrl = server.resolvedUrls?.local?.[0]
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const client = await page.context().newCDPSession(page)
  await client.send('Performance.enable')
  await client.send('HeapProfiler.enable')
  await page.goto(baseUrl, { waitUntil: 'load' })
  await page.waitForSelector('h1')

  async function addBatch() {
    await page.evaluate(async (n) => {
      const canvas = document.createElement('canvas')
      canvas.width = 1200
      canvas.height = 900
      const ctx = canvas.getContext('2d')
      const gradient = ctx.createLinearGradient(0, 0, 1200, 900)
      gradient.addColorStop(0, '#135')
      gradient.addColorStop(1, '#fc8')
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, 1200, 900)
      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', 0.85),
      )
      const transfer = new DataTransfer()
      for (let i = 0; i < n; i += 1) {
        transfer.items.add(
          new File([blob], `run-${i}.jpg`, { type: 'image/jpeg' }),
        )
      }
      const input = document.querySelector('input[type="file"]')
      input.files = transfer.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }, count)
  }

  async function waitDone(expectedTotal) {
    await page.waitForFunction(
      (total) => {
        const text = [...document.querySelectorAll('.panel__label')]
          .map((element) => element.textContent ?? '')
          .join(' ')
        return new RegExp(`${total} / ${total} compressed`).test(text)
      },
      expectedTotal,
      { timeout: 180_000 },
    )
  }

  async function press(text) {
    await page
      .locator('button', { hasText: new RegExp(`^${text}`) })
      .first()
      .click()
  }

  async function compressWhenReady() {
    await page.waitForFunction(
      () => {
        const button = [...document.querySelectorAll('button')].find(
          (candidate) =>
            (candidate.textContent ?? '').trim().startsWith('Compress'),
        )
        const calculating = (
          document.querySelector('.panel')?.textContent ?? ''
        ).includes('Calculating')
        return button && !button.disabled && !calculating
      },
      undefined,
      { timeout: 180_000 },
    )
    await press('Compress')
  }

  async function measure() {
    await client.send('HeapProfiler.collectGarbage')
    const heap = await client.send('Runtime.getHeapUsage')
    const { metrics } = await client.send('Performance.getMetrics')
    const dom = await client.send('Memory.getDOMCounters')
    const pick = (name) =>
      metrics.find((metric) => metric.name === name)?.value ?? 0
    return {
      usedMB: +(heap.usedSize / 1048576).toFixed(1),
      embedderMB: +(heap.embedderHeapUsedSize / 1048576).toFixed(1),
      backingMB: +(heap.backingStorageSize / 1048576).toFixed(1),
      jsHeapMB: +(pick('JSHeapUsedSize') / 1048576).toFixed(1),
      nodes: dom.nodes,
      listeners: dom.jsEventListeners,
    }
  }

  console.log(
    `repeat-check mode=${label} iterations=${iterations} files=${count}`,
  )
  const baseline = await measure()
  console.log('baseline', JSON.stringify(baseline))

  for (let i = 1; i <= iterations; i += 1) {
    const started = Date.now()
    await addBatch()
    await compressWhenReady()
    await waitDone(clear ? count : count * i)
    const elapsed = Date.now() - started
    if (clear) {
      await press('Clear all')
      await page.waitForFunction(
        () => document.querySelectorAll('.job').length === 0,
        undefined,
        { timeout: 30_000 },
      )
    }
    const sample = await measure()
    console.log(
      `run ${i}`,
      JSON.stringify({ ...sample, elapsedMs: elapsed }),
      clear ? '(cleared)' : `(jobs=${count * i})`,
    )
  }
} finally {
  await browser.close()
  await server.close()
}
