#!/usr/bin/env node
// Browser regression check for the virtualized queue (PERF-04).
//
// Drives the production build in headless Chromium, injects 1,000 files, and
// asserts that only a small window of rows is mounted — including after
// scrolling. Run with `npm run test:browser`.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { preview } from 'vite'

const COUNT = 1000
// Visible rows + 4 overscan on each side, with generous headroom.
const MAX_MOUNTED = 40

const server = await preview({
  preview: { port: 4321, strictPort: true },
  logLevel: 'warn',
})
const baseUrl = server.resolvedUrls?.local?.[0]
if (!baseUrl) throw new Error('Preview server did not expose a local URL')

const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const errors = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(String(error)))
  await page.goto(baseUrl, { waitUntil: 'load' })
  await page.waitForSelector('h1')

  // One small image reused for every file keeps injection fast; the test is
  // about row mounting, not codec throughput.
  await page.evaluate(async (count) => {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    canvas.getContext('2d').fillRect(0, 0, 64, 64)
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, 'image/png'),
    )
    const transfer = new DataTransfer()
    for (let i = 0; i < count; i += 1) {
      transfer.items.add(
        new File([blob], `img-${i}.png`, { type: 'image/png' }),
      )
    }
    const input = document.querySelector('input[type="file"]')
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, COUNT)

  // Wait until the queue has registered every file (the panel summary shows
  // the total) and at least one row is mounted.
  await page.waitForFunction(
    () => {
      const summary = [...document.querySelectorAll('.panel__label')]
        .map((element) => element.textContent ?? '')
        .join(' ')
      return (
        document.querySelectorAll('.job').length > 0 &&
        /\b1000 files\b/.test(summary)
      )
    },
    undefined,
    { timeout: 60_000 },
  )

  async function mounted() {
    return page.evaluate(() => ({
      rows: document.querySelectorAll('.job').length,
      firstPos: document.querySelector('.job')?.getAttribute('aria-posinset'),
      setSize: document.querySelector('.job')?.getAttribute('aria-setsize'),
    }))
  }

  const top = await mounted()
  assert.ok(top.rows > 0, 'no rows mounted')
  assert.ok(
    top.rows <= MAX_MOUNTED,
    `top mounted ${top.rows} rows (max ${MAX_MOUNTED})`,
  )
  assert.equal(top.setSize, String(COUNT), 'aria-setsize mismatch')

  await page.locator('.queue').evaluate((element) => {
    element.scrollTop = element.scrollHeight / 2
  })
  await page.waitForTimeout(250)
  const middle = await mounted()
  assert.ok(
    middle.rows <= MAX_MOUNTED,
    `middle mounted ${middle.rows} rows (max ${MAX_MOUNTED})`,
  )
  assert.notEqual(
    middle.firstPos,
    top.firstPos,
    'window did not move when scrolling',
  )

  await page.locator('.queue').evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  await page.waitForTimeout(250)
  const bottom = await mounted()
  assert.ok(
    bottom.rows <= MAX_MOUNTED,
    `bottom mounted ${bottom.rows} rows (max ${MAX_MOUNTED})`,
  )

  assert.deepEqual(errors, [], `console errors: ${errors.join('; ')}`)

  console.log(
    `virtualization ok: ${COUNT} files, mounted rows top=${top.rows} middle=${middle.rows} bottom=${bottom.rows}`,
  )
} finally {
  await browser.close()
  await server.close()
}
