import { getCodec } from '../src/lib/codecs/registry.ts'

let worker
let requestId = 0

function getWorker() {
  if (worker) return worker
  worker = new Worker(
    new URL('./preview-strategy.worker.js', import.meta.url),
    { type: 'module' },
  )
  return worker
}

function runWorker(payload) {
  const id = ++requestId
  return new Promise((resolve, reject) => {
    const active = getWorker()
    const onMessage = (event) => {
      if (event.data.id !== id) return
      active.removeEventListener('message', onMessage)
      active.removeEventListener('error', onError)
      if (event.data.error) reject(new Error(event.data.error))
      else resolve(event.data.result)
    }
    const onError = (event) => {
      active.removeEventListener('message', onMessage)
      active.removeEventListener('error', onError)
      reject(event.error ?? new Error(event.message))
    }
    active.addEventListener('message', onMessage)
    active.addEventListener('error', onError)
    active.postMessage({ id, ...payload }, [payload.buffer])
  })
}

function startScrollProbe() {
  const scroller = document.createElement('div')
  scroller.style.cssText =
    'position:fixed;left:-10000px;top:0;width:320px;height:480px;overflow:auto;contain:strict;'
  scroller.innerHTML = Array.from(
    { length: 1000 },
    (_, index) =>
      `<div style="height:72px;border-bottom:1px solid #ddd">Preview row ${index}</div>`,
  ).join('')
  document.body.append(scroller)

  let active = true
  let direction = 1
  let lastFrame = 0
  let maxFrameGapMs = 0
  let framesOver50Ms = 0
  let frames = 0
  let animationFrame
  let pageHeapPeakBytes = performance.memory?.usedJSHeapSize ?? null
  const sampleHeap = () => {
    const current = performance.memory?.usedJSHeapSize
    if (typeof current === 'number') {
      pageHeapPeakBytes = Math.max(pageHeapPeakBytes ?? 0, current)
    }
  }
  const heapTimer = setInterval(sampleHeap, 25)
  const tick = (time) => {
    if (!active) return
    if (lastFrame) {
      const gap = time - lastFrame
      maxFrameGapMs = Math.max(maxFrameGapMs, gap)
      if (gap > 50) framesOver50Ms += 1
    }
    lastFrame = time
    frames += 1
    if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight) {
      direction = -1
    } else if (scroller.scrollTop <= 0) {
      direction = 1
    }
    scroller.scrollTop += direction * 40
    animationFrame = requestAnimationFrame(tick)
  }
  animationFrame = requestAnimationFrame(tick)

  return () => {
    active = false
    cancelAnimationFrame(animationFrame)
    clearInterval(heapTimer)
    sampleHeap()
    scroller.remove()
    return {
      maxFrameGapMs,
      framesOver50Ms,
      frames,
      pageHeapPeakBytes,
    }
  }
}

async function runSourceVariants(inputPath, formats, onVariant) {
  const original = await fetch(inputPath).then((response) => {
    if (!response.ok) throw new Error(`Could not read ${inputPath}`)
    return response.blob()
  })
  const baseBitmap = await createImageBitmap(original)
  const baseCanvas = new OffscreenCanvas(baseBitmap.width, baseBitmap.height)
  const baseContext = baseCanvas.getContext('2d')
  baseContext.drawImage(baseBitmap, 0, 0)
  baseBitmap.close()

  for (const format of formats) {
    const started = performance.now()
    try {
      let blob = original
      if (format !== 'jpeg') {
        const codec = await getCodec(format)
        blob = await codec.encode(
          {
            width: baseCanvas.width,
            height: baseCanvas.height,
            canvas: baseCanvas,
          },
          { quality: format === 'avif' ? 50 : 75, speed: 8, mode: 0 },
        )
      }
      await onVariant({
        format,
        width: baseCanvas.width,
        height: baseCanvas.height,
        bytes: blob.size,
        preparationMs: performance.now() - started,
        buffer: await blob.arrayBuffer(),
      })
    } catch (error) {
      await onVariant({
        format,
        width: baseCanvas.width,
        height: baseCanvas.height,
        bytes: 0,
        preparationMs: performance.now() - started,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  baseCanvas.width = 1
  baseCanvas.height = 1
}

globalThis.__previewBenchRun = async ({ inputPath, formats, repeats }) => {
  const results = []
  await runSourceVariants(inputPath, formats, async (variant) => {
    if (!variant.buffer) {
      results.push(variant)
      return
    }
    const stopProbe = startScrollProbe()
    let result
    try {
      result = await runWorker({
        format: variant.format,
        width: variant.width,
        height: variant.height,
        repeats,
        buffer: variant.buffer.slice(0),
      })
    } finally {
      const probe = stopProbe()
      result = result ? { ...result, ...probe } : result
    }
    const { buffer, ...source } = variant
    results.push({ ...source, ...result })
  })
  return {
    inputPath,
    formats,
    repeats,
    results,
    browser: navigator.userAgent,
  }
}
