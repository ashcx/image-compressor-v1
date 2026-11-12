import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { preview } from 'vite'

/**
 * Measures a HEIC to JPEG batch in real Chrome: wall time per phase and the
 * resident memory of the whole browser process tree (renderer, workers, GPU).
 *
 *   npm run build && node bench/heic-batch.mjs --dir <folder of .heic files>
 *
 * Options: --label <name>  --runs <n> (median reported)  --target <format>
 */
const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? fallback : args[index + 1]
}
const dir = resolve(option('dir', 'bench/fixtures'))
const label = option('label', 'run')
const runs = Number(option('runs', 3))
const target = option('target', 'jpeg')
const files = readdirSync(dir)
  .filter((name) => /\.hei[cf]$/i.test(name))
  .sort()
  .map((name) => join(dir, name))
if (files.length === 0) throw new Error(`No .heic files in ${dir}`)

function findBrowserPid(profileDir) {
  const rows = execFileSync('ps', ['-axo', 'pid=,command='], {
    encoding: 'utf8',
  }).split('\n')
  for (const row of rows) {
    if (row.includes(`--user-data-dir=${profileDir}`) && !row.includes('--type=')) {
      return Number(row.trim().split(/\s+/)[0])
    }
  }
  throw new Error('Browser process not found')
}

function treeRssMb(rootPid) {
  const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,rss='], {
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .map((line) => line.trim().split(/\s+/).map(Number))
  const children = new Map()
  for (const [pid, ppid, rss] of rows) {
    if (!children.has(ppid)) children.set(ppid, [])
    children.get(ppid).push({ pid, rss })
  }
  let total = 0
  const stack = [rootPid]
  while (stack.length > 0) {
    const pid = stack.pop()
    const self = rows.find((row) => row[0] === pid)
    if (self) total += self[2]
    for (const child of children.get(pid) ?? []) stack.push(child.pid)
  }
  return total / 1024
}

const server = await preview({
  preview: { port: 4331, strictPort: true },
  logLevel: 'warn',
})
const url = server.resolvedUrls.local[0]

async function once() {
  const profileDir = mkdtempSync(join(tmpdir(), 'heic-batch-'))
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chrome',
  })
  const pid = findBrowserPid(profileDir)
  const samples = []
  let phase = 'load'
  const peaks = {}
  const timer = setInterval(() => {
    const mb = treeRssMb(pid)
    samples.push(mb)
    peaks[phase] = Math.max(peaks[phase] ?? 0, mb)
  }, 100)
  const errors = []
  try {
    const page = context.pages()[0] ?? (await context.newPage())
    page.on('pageerror', (error) => errors.push(String(error)))
    await page.goto(url, { waitUntil: 'load' })
    await page.waitForSelector('h1')
    if (target !== 'jpeg') {
      await page.waitForSelector('select.select')
      await page.selectOption('select.select', target)
    }
    const baseline = treeRssMb(pid)

    phase = 'estimate'
    const t0 = performance.now()
    await page.setInputFiles('input[type="file"]', files)
    // Estimates start a moment after intake; wait for them to begin and end.
    await page
      .waitForFunction(
        () =>
          document
            .querySelector('.summary-card__status')
            ?.getAttribute('data-estimating') === 'true',
        undefined,
        { timeout: 3000 },
      )
      .catch(() => undefined)
    await page.waitForFunction(
      () =>
        document
          .querySelector('.summary-card__status')
          ?.getAttribute('data-estimating') !== 'true' &&
        [...document.querySelectorAll('button')].some(
          (button) =>
            /^Compress/.test(button.textContent ?? '') && !button.disabled,
        ),
      undefined,
      { timeout: 300_000 },
    )
    const estimateMs = performance.now() - t0

    phase = 'compress'
    const t1 = performance.now()
    await page.locator('button', { hasText: /^Compress/ }).first().click()
    const total = files.length
    await page.waitForFunction(
      (n) => {
        const count =
          document.querySelector('.summary-card__count')?.textContent ?? ''
        const status =
          document.querySelector('.summary-card__status')?.textContent ?? ''
        return new RegExp(`${n} / ${n}`).test(count) && /Complete/.test(status)
      },
      total,
      { timeout: 300_000 },
    )
    const compressMs = performance.now() - t1

    phase = 'idle'
    await page.waitForTimeout(6000)
    const settled = treeRssMb(pid)
    return {
      baseline,
      estimateMs,
      compressMs,
      peakEstimate: peaks.estimate,
      peakCompress: peaks.compress,
      peakAll: Math.max(...samples),
      settled,
      errors,
    }
  } finally {
    clearInterval(timer)
    await context.close()
  }
}

const median = (values) => [...values].sort((a, b) => a - b)[values.length >> 1]
const results = []
try {
  for (let run = 0; run < runs; run += 1) results.push(await once())
} finally {
  await server.close()
}
const pick = (key) => Math.round(median(results.map((result) => result[key])))
console.log(
  JSON.stringify({
    label,
    files: files.length,
    target,
    runs,
    baselineMb: pick('baseline'),
    estimateMs: pick('estimateMs'),
    compressMs: pick('compressMs'),
    peakEstimateMb: pick('peakEstimate'),
    peakCompressMb: pick('peakCompress'),
    peakAllMb: pick('peakAll'),
    settledMb: pick('settled'),
    errors: results.flatMap((result) => result.errors),
  }),
)
