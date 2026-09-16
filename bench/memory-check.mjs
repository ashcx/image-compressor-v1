import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { preview } from 'vite'

/**
 * Layer 4 browser check for the decoded-memory ceilings: a batch of large
 * images must complete without a page error / renderer crash on the default
 * JPEG path, and an AVIF batch must serialize heavy work instead of killing the
 * tab. Exits non-zero and prints page errors on failure.
 */
const server = await preview({
  preview: { port: 4324, strictPort: true },
  logLevel: 'warn',
})
const url = server.resolvedUrls.local[0]
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('crash', () => errors.push('page crashed'))
  await page.goto(url, { waitUntil: 'load' })
  await page.waitForSelector('h1')

  async function inject(count, width, height) {
    await page.evaluate(
      async ({ count: n, width: w, height: h }) => {
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        const gradient = ctx.createLinearGradient(0, 0, w, h)
        gradient.addColorStop(0, '#2a6')
        gradient.addColorStop(0.5, '#a37')
        gradient.addColorStop(1, '#06c')
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, w, h)
        const blob = await new Promise((resolve) =>
          canvas.toBlob(resolve, 'image/jpeg', 0.9),
        )
        const transfer = new DataTransfer()
        for (let i = 0; i < n; i += 1) {
          transfer.items.add(
            new File([blob], `big-${i}.jpg`, { type: 'image/jpeg' }),
          )
        }
        const input = document.querySelector('input[type="file"]')
        input.files = transfer.files
        input.dispatchEvent(new Event('change', { bubbles: true }))
      },
      { count, width, height },
    )
  }

  async function waitTotal(total) {
    await page.waitForFunction(
      (n) => {
        const text =
          document.querySelector('.summary-card__details')?.textContent ?? ''
        return new RegExp(`${n} / ${n} compressed`).test(text)
      },
      total,
      { timeout: 180_000 },
    )
  }

  async function compressAll() {
    // Estimates (especially AVIF) disable the button until they finish.
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('button')].some(
          (button) =>
            /^Compress/.test(button.textContent ?? '') && !button.disabled,
        ),
      undefined,
      { timeout: 180_000 },
    )
    await page
      .locator('button', { hasText: /^Compress/ })
      .first()
      .click()
  }

  // Large JPEG batch on the default (native) path.
  await inject(6, 5000, 3333)
  await compressAll()
  await waitTotal(6)

  // AVIF batch: heavy workers must be gated by the memory budget.
  await page.reload({ waitUntil: 'load' })
  await page.waitForSelector('h1')
  await inject(4, 2000, 1500)
  await page.waitForSelector('select.select')
  await page.selectOption('select.select', 'avif')
  // Let the debounced AVIF re-estimate start before waiting for a settled,
  // enabled Compress button; otherwise the click races the stale estimate.
  await page.waitForTimeout(1000)
  await compressAll()
  await waitTotal(4)

  assert.deepEqual(errors, [], `page errors: ${errors.join('; ')}`)
  console.log(JSON.stringify({ jpeg: 6, avif: 4, errors: errors.length }))
} finally {
  await browser.close()
  await server.close()
}
