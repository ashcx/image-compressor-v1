import assert from 'node:assert/strict'
import { stat } from 'node:fs/promises'
import { chromium } from 'playwright'
import { preview } from 'vite'

const server = await preview({
  preview: { port: 4323, strictPort: true },
  logLevel: 'warn',
})
const url = server.resolvedUrls.local[0]
const browser = await chromium.launch()
try {
  const context = await browser.newContext({ acceptDownloads: true })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  await page.goto(url, { waitUntil: 'load' })
  await page.waitForSelector('h1')

  const hasOpfs = await page.evaluate(
    () => typeof navigator.storage?.getDirectory === 'function',
  )

  async function inject(count) {
    await page.evaluate(async (n) => {
      const canvas = document.createElement('canvas')
      canvas.width = 400
      canvas.height = 300
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#2a6'
      ctx.fillRect(0, 0, 400, 300)
      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', 0.9),
      )
      const transfer = new DataTransfer()
      for (let i = 0; i < n; i += 1) {
        transfer.items.add(
          new File([blob], `shot-${i}.jpg`, { type: 'image/jpeg' }),
        )
      }
      const input = document.querySelector('input[type="file"]')
      input.files = transfer.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }, count)
  }

  async function waitTotal(total) {
    await page.waitForFunction(
      (n) => {
        const text = [...document.querySelectorAll('.panel__label')]
          .map((el) => el.textContent ?? '')
          .join(' ')
        return new RegExp(`${n} / ${n} compressed`).test(text)
      },
      total,
      { timeout: 60_000 },
    )
  }

  // Single-file auto-compress → row download must produce a non-empty file.
  await inject(1)
  await waitTotal(1)
  const rowDownload = page.waitForEvent('download')
  await page
    .locator('.job__actions button', { hasText: 'Download' })
    .first()
    .click()
  const single = await rowDownload
  const singlePath = await single.path()
  const singleSize = singlePath ? (await stat(singlePath)).size : 0
  assert.ok(singleSize > 0, 'single download was empty')

  // Add a second file, re-compress, then download-all as a zip.
  await inject(1)
  await page
    .locator('button', { hasText: /^Compress/ })
    .first()
    .click()
  await page.waitForFunction(
    () => {
      const label = [...document.querySelectorAll('.panel__label')]
        .map((el) => el.textContent ?? '')
        .join(' ')
      return /2 \/ 2 compressed/.test(label)
    },
    undefined,
    { timeout: 60_000 },
  )
  const zipDownload = page.waitForEvent('download')
  await page
    .locator('button', { hasText: /Download all/ })
    .first()
    .click()
  const zip = await zipDownload
  const zipPath = await zip.path()
  const zipSize = zipPath ? (await stat(zipPath)).size : 0
  assert.ok(zipSize > 0, 'zip download was empty')

  assert.deepEqual(errors, [], `page errors: ${errors.join('; ')}`)
  console.log(
    JSON.stringify({
      opfs: hasOpfs,
      singleBytes: singleSize,
      singleName: single.suggestedFilename(),
      zipBytes: zipSize,
      zipName: zip.suggestedFilename(),
    }),
  )
} finally {
  await browser.close()
  await server.close()
}
