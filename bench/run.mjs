#!/usr/bin/env node
// PERF-01: repeatable browser benchmark harness.
//
// Drives the production build in headless Chromium and records the metrics the
// performance backlog asks for: time to first result, batch completion time,
// long tasks, frame gaps, worker utilisation, and (where exposed) JS heap.
//
// The harness generates deterministic synthetic fixtures in-page and hands
// them to the real file input, so it exercises the shipped decode/estimate/
// encode path rather than a mock. Run with `npm run benchmark`.
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { preview } from 'vite'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RESULTS_DIR = resolve(ROOT, 'bench/results')

// Scenario matrix. `cohort` lists one or more fixture cohorts to distribute the
// batch across; `maxCount` caps expensive codecs so a large-count run stays sane.
const SCENARIOS = [
  { id: 'jpeg-photo', format: 'jpeg', cohort: ['photo'], quality: 75 },
  {
    id: 'jpeg-photo-resize',
    format: 'jpeg',
    cohort: ['photo'],
    quality: 75,
    maxLongEdge: 1024,
  },
  { id: 'webp-photo', format: 'webp', cohort: ['photo'], quality: 75 },
  { id: 'png-screenshot', format: 'png', cohort: ['screenshot'], mode: 0 },
  {
    id: 'png-screenshot-lossless',
    format: 'png',
    cohort: ['screenshot'],
    mode: 1,
  },
  {
    id: 'avif-photo',
    format: 'avif',
    cohort: ['photo'],
    quality: 50,
    speed: 8,
    maxCount: 25,
  },
  {
    id: 'jpeg-mixed',
    format: 'jpeg',
    cohort: ['photo', 'screenshot', 'transparency', 'noise', 'large'],
    quality: 75,
  },
]

function parseArgs(argv) {
  const options = {
    counts: [25, 60],
    scenarios: SCENARIOS.map((scenario) => scenario.id),
    label: 'baseline',
    port: 4317,
    timeout: 240_000,
    seed: 1,
    headed: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    const value = argv[i + 1]
    if (flag === '--counts' && value) options.counts = parseList(value, Number)
    else if (flag === '--scenarios' && value)
      options.scenarios = value.split(',')
    else if (flag === '--label' && value) options.label = value
    else if (flag === '--port' && value) options.port = Number(value)
    else if (flag === '--timeout' && value) options.timeout = Number(value)
    else if (flag === '--seed' && value) options.seed = Number(value)
    else if (flag === '--headed') options.headed = true
    if (value !== undefined) i += 1
  }
  return options
}

function parseList(value, map) {
  return value
    .split(',')
    .map((entry) => map(entry.trim()))
    .filter((entry) => Number.isFinite(entry) && entry > 0)
}

const sleep = (ms) =>
  new Promise((resolveSleep) => setTimeout(resolveSleep, ms))

function shortCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim()
  } catch {
    return 'unknown'
  }
}

// Installed on every document before app code runs so the measurements cover
// the whole interaction, including worker dispatch.
const INSTRUMENT = () => {
  const bench = {
    longTasks: [],
    frames: [],
    heap: [],
    t0: 0,
  }
  window.__bench = bench

  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        bench.longTasks.push({
          start: entry.startTime,
          duration: entry.duration,
        })
      }
    }).observe({ type: 'longtask', buffered: true })
  } catch {
    // longtask is Chromium/Blink-only; leave the array empty elsewhere.
  }

  const tick = (time) => {
    bench.frames.push(time)
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)

  if (performance.memory) {
    setInterval(() => {
      bench.heap.push({
        t: performance.now(),
        bytes: performance.memory.usedJSHeapSize,
      })
    }, 200)
  }

  bench.reset = () => {
    bench.longTasks.length = 0
    bench.frames.length = 0
    bench.heap.length = 0
    bench.t0 = performance.now()
  }
}

// Generates deterministic fixtures in-page and hands them to the real file
// input. Returns the number of files injected.
async function injectFixtures(page, { count, cohorts, seed }) {
  return page.evaluate(
    async ({ count, cohorts, seed }) => {
      const mulberry32 = (input) => {
        let a = input
        return () => {
          a |= 0
          a = (a + 0x6d2b79f5) | 0
          let t = Math.imul(a ^ (a >>> 15), 1 | a)
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296
        }
      }

      const SPEC = {
        photo: { w: 1600, h: 1200, type: 'image/jpeg', q: 0.9, bases: 8 },
        screenshot: { w: 1440, h: 900, type: 'image/png', bases: 3 },
        transparency: { w: 800, h: 800, type: 'image/png', bases: 3 },
        noise: { w: 1200, h: 1200, type: 'image/jpeg', q: 0.92, bases: 4 },
        large: { w: 4000, h: 3000, type: 'image/jpeg', q: 0.9, bases: 2 },
      }

      const draw = (canvas, cohort, rnd) => {
        const ctx = canvas.getContext('2d')
        const w = canvas.width
        const h = canvas.height
        if (cohort === 'photo') {
          const gradient = ctx.createLinearGradient(0, 0, w, h)
          gradient.addColorStop(0, `hsl(${(rnd() * 360) | 0} 60% 55%)`)
          gradient.addColorStop(1, `hsl(${(rnd() * 360) | 0} 55% 25%)`)
          ctx.fillStyle = gradient
          ctx.fillRect(0, 0, w, h)
          for (let i = 0; i < 40; i += 1) {
            ctx.beginPath()
            ctx.fillStyle = `hsla(${(rnd() * 360) | 0} 70% 60% / ${0.05 + rnd() * 0.15})`
            ctx.arc(
              rnd() * w,
              rnd() * h,
              rnd() * Math.min(w, h) * 0.3,
              0,
              Math.PI * 2,
            )
            ctx.fill()
          }
        } else if (cohort === 'screenshot') {
          ctx.fillStyle = '#f5f6f8'
          ctx.fillRect(0, 0, w, h)
          ctx.fillStyle = '#2d6cdf'
          ctx.fillRect(0, 0, w, 64)
          for (let i = 0; i < 20; i += 1) {
            ctx.fillStyle = `hsl(210 15% ${30 + rnd() * 40}%)`
            ctx.fillRect(24, 96 + i * 36, 200 + rnd() * (w - 300), 10)
          }
          for (let i = 0; i < 8; i += 1) {
            ctx.fillStyle = `hsl(${(rnd() * 360) | 0} 70% 55%)`
            ctx.fillRect(24 + i * (w / 9), h - 140, w / 12, 60)
          }
        } else if (cohort === 'transparency') {
          ctx.clearRect(0, 0, w, h)
          for (let i = 0; i < 25; i += 1) {
            ctx.fillStyle = `hsla(${(rnd() * 360) | 0} 80% 55% / ${0.2 + rnd() * 0.6})`
            ctx.beginPath()
            ctx.arc(rnd() * w, rnd() * h, rnd() * w * 0.25, 0, Math.PI * 2)
            ctx.fill()
          }
        } else if (cohort === 'noise') {
          const image = ctx.createImageData(w, h)
          for (let i = 0; i < image.data.length; i += 4) {
            const value = rnd() * 255
            image.data[i] = value
            image.data[i + 1] = value
            image.data[i + 2] = value
            image.data[i + 3] = 255
          }
          ctx.putImageData(image, 0, 0)
        } else {
          const gradient = ctx.createLinearGradient(0, 0, w, h)
          gradient.addColorStop(0, '#112233')
          gradient.addColorStop(1, '#ffdd88')
          ctx.fillStyle = gradient
          ctx.fillRect(0, 0, w, h)
          for (let i = 0; i < 200; i += 1) {
            ctx.fillStyle = `hsla(${(rnd() * 360) | 0} 70% 60% / 0.2)`
            ctx.fillRect(
              rnd() * w,
              rnd() * h,
              200 + rnd() * 600,
              200 + rnd() * 600,
            )
          }
        }
      }

      const makeBlob = (spec, cohort, index) =>
        new Promise((resolveBlob) => {
          const canvas = document.createElement('canvas')
          canvas.width = spec.w
          canvas.height = spec.h
          draw(canvas, cohort, mulberry32(seed + index * 101 + spec.w))
          canvas.toBlob(
            (blob) => resolveBlob(blob),
            spec.type,
            spec.q ?? undefined,
          )
        })

      const perCohort = cohorts.map((cohort) => ({
        cohort,
        spec: SPEC[cohort],
        total: 0,
        base: 0,
      }))
      for (let i = 0; i < count; i += 1) {
        perCohort[i % perCohort.length].total += 1
      }

      const files = []
      for (const entry of perCohort) {
        if (entry.total === 0) continue
        const unique = Math.min(entry.total, entry.spec.bases)
        const blobs = []
        for (let i = 0; i < unique; i += 1) {
          blobs.push(await makeBlob(entry.spec, entry.cohort, i))
        }
        const extension = entry.spec.type === 'image/jpeg' ? 'jpg' : 'png'
        for (let i = 0; i < entry.total; i += 1) {
          const blob = blobs[i % blobs.length]
          files.push(
            new File([blob], `${entry.cohort}-${i}.${extension}`, {
              type: entry.spec.type,
            }),
          )
        }
      }

      window.__bench?.reset()

      const input = document.querySelector('input[type="file"]')
      const transfer = new DataTransfer()
      for (const file of files) transfer.items.add(file)
      input.files = transfer.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
      return files.length
    },
    { count, cohorts, seed },
  )
}

async function applySettings(page, scenario) {
  const panel = page.locator('.panel').first()
  await panel.locator('select').first().selectOption(scenario.format)

  if (scenario.format === 'jpeg' || scenario.format === 'webp') {
    await page
      .getByLabel('Quality')
      .selectOption(String(scenario.quality ?? 75))
  } else if (scenario.format === 'png') {
    await page
      .getByLabel('Compression')
      .selectOption(String(scenario.mode ?? 0))
  } else if (scenario.format === 'avif') {
    await page.evaluate((quality) => {
      const input = document.querySelector('input[type="range"]')
      input.value = String(quality)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }, scenario.quality ?? 50)
    await page.getByLabel('Speed').selectOption(String(scenario.speed ?? 8))
  }

  if (scenario.maxLongEdge) {
    await page.evaluate((value) => {
      const input = document.querySelector('.field input[type="number"]')
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      ).set
      setter.call(input, String(value))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }, scenario.maxLongEdge)
  }
}

function parseMeter(text) {
  const match = /workers\s+(\d+)\/(\d+)/.exec(text ?? '')
  if (!match) return null
  return { busy: Number(match[1]), size: Number(match[2]) }
}

async function snapshot(page) {
  return page.evaluate(() => {
    const label = document.querySelector('.panel__row .panel__label')
    const meter = document.querySelector('.panel__value')
    const downloads = [
      ...document.querySelectorAll('.job__actions button'),
    ].filter(
      (button) => (button.textContent ?? '').trim() === 'Download',
    ).length
    const errors = document.querySelectorAll('.job__icon--error').length
    const compress = [...document.querySelectorAll('button')].find((button) =>
      (button.textContent ?? '').trim().startsWith('Compress'),
    )
    return {
      label: label?.textContent ?? '',
      meter: meter?.textContent ?? '',
      downloads,
      errors,
      compressEnabled: Boolean(compress) && !compress.disabled,
      estimating: (
        document.querySelector('.panel')?.textContent ?? ''
      ).includes('Calculating'),
    }
  })
}

async function waitAndRun(page, expected, timeout, runStartedAt) {
  const poolSamples = []
  let estimateAt = null
  let firstResultAt = null
  const deadline = Date.now() + timeout

  for (;;) {
    const state = await snapshot(page)
    const meter = parseMeter(state.meter)
    if (meter) {
      poolSamples.push({ t: Date.now() - runStartedAt, ...meter })
    }

    const done = state.downloads + state.errors
    if (firstResultAt === null && done >= 1) {
      firstResultAt = Date.now() - runStartedAt
    }
    if (done >= expected) {
      return { estimateAt, firstResultAt, poolSamples, errors: state.errors }
    }

    // Trigger compression once estimation has settled and the button is live.
    if (
      expected > 1 &&
      estimateAt === null &&
      !state.estimating &&
      state.compressEnabled
    ) {
      await page
        .locator('button', { hasText: /^Compress/ })
        .first()
        .click()
      estimateAt = Date.now() - runStartedAt
    }

    if (Date.now() > deadline) {
      const label = state.label || 'no progress'
      throw new Error(
        `Timed out after ${timeout}ms with ${done}/${expected} results (${label})`,
      )
    }
    await sleep(50)
  }
}

function frameStats(frames, t0, t1) {
  const window = frames.filter((time) => time >= t0 && time <= t1)
  const gaps = []
  for (let i = 1; i < window.length; i += 1) {
    gaps.push(window[i] - window[i - 1])
  }
  gaps.sort((a, b) => a - b)
  const max = gaps.length > 0 ? gaps[gaps.length - 1] : 0
  const p95 = gaps.length > 0 ? gaps[Math.floor(gaps.length * 0.95)] : 0
  return { frames: window.length, maxGapMs: round(max), p95GapMs: round(p95) }
}

function longTaskStats(tasks, t0, t1) {
  const window = tasks.filter((task) => task.start >= t0 && task.start <= t1)
  const total = window.reduce((sum, task) => sum + task.duration, 0)
  return {
    count: window.length,
    totalMs: round(total),
    maxMs: round(window.reduce((max, task) => Math.max(max, task.duration), 0)),
  }
}

function heapStats(heap, t0, t1) {
  const window = heap.filter((sample) => sample.t >= t0 && sample.t <= t1)
  if (window.length === 0) return null
  return {
    peakBytes: Math.max(...window.map((sample) => sample.bytes)),
  }
}

function utilisation(samples) {
  if (samples.length === 0) return null
  let busySum = 0
  let sizeSum = 0
  let peakBusy = 0
  for (const sample of samples) {
    busySum += sample.busy
    sizeSum += sample.size
    peakBusy = Math.max(peakBusy, sample.busy)
  }
  return {
    avgBusy: round(busySum / samples.length),
    avgSize: round(sizeSum / samples.length),
    peakBusy,
    samples: samples.length,
  }
}

function round(value) {
  return Math.round(value * 10) / 10
}

async function runScenario(browser, baseUrl, scenario, count, options) {
  const page = await browser.newPage()
  const consoleErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(String(error)))
  await page.addInitScript(INSTRUMENT)

  try {
    await page.goto(baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('h1')

    if (count < 2) {
      throw new Error('Benchmark scenarios require at least two files')
    }

    const runStartedAt = Date.now()
    await injectFixtures(page, {
      count,
      cohorts: scenario.cohort,
      seed: options.seed,
    })
    // The settings panel only mounts once jobs exist, and format changes are
    // debounced, so apply settings after injection and let re-estimation start.
    await applySettings(page, scenario)
    await sleep(700)

    const outcome = await waitAndRun(page, count, options.timeout, runStartedAt)
    const completeAt = Date.now() - runStartedAt
    const { t0: benchStart } = await page.evaluate(() => ({
      t0: window.__bench.t0,
    }))
    const bench = await page.evaluate(() => ({
      longTasks: window.__bench.longTasks,
      frames: window.__bench.frames,
      heap: window.__bench.heap,
      t1: performance.now(),
    }))

    return {
      scenario: scenario.id,
      count,
      cohorts: scenario.cohort.join('+'),
      format: scenario.format,
      settings: {
        quality: scenario.quality,
        mode: scenario.mode,
        speed: scenario.speed,
        maxLongEdge: scenario.maxLongEdge,
      },
      metrics: {
        estimateMs: outcome.estimateAt,
        firstResultMs: outcome.firstResultAt,
        completeMs: completeAt,
        errors: outcome.errors,
        longTasks: longTaskStats(bench.longTasks, benchStart, bench.t1),
        frames: frameStats(bench.frames, benchStart, bench.t1),
        heap: heapStats(bench.heap, benchStart, bench.t1),
        workers: utilisation(outcome.poolSamples),
      },
      consoleErrors,
    }
  } finally {
    await page.close()
  }
}

function renderMarkdown(report) {
  const lines = [
    '# Benchmark baseline',
    '',
    `- Commit: \`${report.meta.commit}\``,
    `- Generated: ${report.meta.timestamp}`,
    `- Node: ${report.meta.node} · Chromium: ${report.meta.chromium}`,
    `- Counts: ${report.meta.counts.join(', ')}`,
    '',
    '| Scenario | Files | Format | First result (ms) | Complete (ms) | Estimate (ms) | Long tasks | Max frame gap (ms) | Busy/size | Errors |',
    '| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ]
  for (const result of report.results) {
    const metrics = result.metrics
    const workers = metrics.workers
      ? `${metrics.workers.avgBusy}/${metrics.workers.avgSize}`
      : '—'
    const cells = [
      result.scenario,
      result.count,
      result.format,
      metrics.firstResultMs ?? '—',
      metrics.completeMs,
      metrics.estimateMs ?? '—',
      `${metrics.longTasks.count} (${metrics.longTasks.totalMs} ms)`,
      metrics.frames.maxGapMs,
      workers,
      metrics.errors,
    ]
    lines.push(`| ${cells.join(' | ')} |`)
  }
  lines.push(
    '',
    'Estimates and first-result figures are wall-clock from file injection. For batches,',
    'compression is triggered after estimation settles, so `estimateMs` separates estimation',
    'from encode throughput. Frame and long-task windows span injection to completion.',
    '',
  )
  return lines.join('\n')
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const scenarios = SCENARIOS.filter((scenario) =>
    options.scenarios.includes(scenario.id),
  )
  if (scenarios.length === 0) throw new Error('No scenarios selected')

  const jobs = []
  for (const count of options.counts) {
    for (const scenario of scenarios) {
      if (scenario.maxCount && count > scenario.maxCount) continue
      jobs.push({ scenario, count })
    }
  }

  const server = await preview({
    preview: { port: options.port, strictPort: true },
    logLevel: 'warn',
  })
  const baseUrl = server.resolvedUrls?.local?.[0]
  if (!baseUrl) throw new Error('Preview server did not expose a local URL')

  const browser = await chromium.launch({ headless: !options.headed })
  const version = browser.version()
  const results = []
  try {
    for (const job of jobs) {
      process.stdout.write(`bench ${job.scenario.id} x${job.count} ... `)
      const result = await runScenario(
        browser,
        baseUrl,
        job.scenario,
        job.count,
        options,
      )
      results.push(result)
      const metric = result.metrics
      process.stdout.write(
        `first ${metric.firstResultMs ?? '—'}ms complete ${metric.completeMs}ms ` +
          `longTasks ${metric.longTasks.count}\n`,
      )
    }
  } finally {
    await browser.close()
    await server.close()
  }

  const report = {
    meta: {
      commit: shortCommit(),
      timestamp: new Date().toISOString(),
      node: process.version,
      chromium: version,
      counts: options.counts,
      seed: options.seed,
    },
    results,
  }

  await mkdir(RESULTS_DIR, { recursive: true })
  const jsonPath = resolve(RESULTS_DIR, `${options.label}.json`)
  const markdownPath = resolve(RESULTS_DIR, `${options.label}.md`)
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`)
  await writeFile(markdownPath, renderMarkdown(report))
  console.log(`\nWrote ${jsonPath}`)
  console.log(`Wrote ${markdownPath}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
