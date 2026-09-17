import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { basename } from 'node:path'
import { chromium } from 'playwright'

const inputPath = process.argv[2]
if (!inputPath) {
  throw new Error('Usage: node bench/heic-three-way.mjs /path/to/image.jpg')
}

const inputBytes = readFileSync(inputPath)
const wasmPath = new URL('../vendor/elheif/pkg/elheif-wasm.js', import.meta.url)
const chromePath = process.env.CHROME_BIN || '/usr/bin/google-chrome'
const headless = process.env.HEADLESS === '1'

const server = createServer((request, response) => {
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')

  if (request.url === '/') {
    response.setHeader('Content-Type', 'text/html')
    response.end('<!doctype html><title>HEIC codec comparison</title>')
    return
  }

  if (request.url === '/input') {
    response.setHeader('Content-Type', 'application/octet-stream')
    response.setHeader('Content-Length', inputBytes.length)
    response.end(inputBytes)
    return
  }

  if (request.url === '/elheif-wasm.js') {
    response.setHeader('Content-Type', 'text/javascript')
    response.end(readFileSync(wasmPath))
    return
  }

  response.statusCode = 404
  response.end('not found')
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const browser = await chromium.launch({
  headless,
  executablePath: chromePath,
  args: ['--no-sandbox'],
})
const page = await browser.newPage()
page.on('console', (message) => {
  if (message.type() === 'error') console.error(`browser: ${message.text()}`)
})
page.on('pageerror', (error) =>
  console.error(`browser page error: ${error.message}`),
)
await page.goto(`http://127.0.0.1:${port}/`)

await page.evaluate(() => {
  globalThis.Module = {}
})
await page.addScriptTag({ url: `http://127.0.0.1:${port}/elheif-wasm.js` })
await page.evaluate(() => globalThis.__init__ELHEIF_MODULE(globalThis.Module))
await page.waitForFunction(
  () => typeof globalThis.Module?.jsEncodeImage === 'function',
)

const result = await page.evaluate(async () => {
  const input = await fetch('/input').then((response) => response.blob())
  const bitmap = await createImageBitmap(input)
  const sourceCanvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const sourceContext = sourceCanvas.getContext('2d', {
    willReadFrequently: true,
  })
  sourceContext.drawImage(bitmap, 0, 0)
  bitmap.close()
  const source = sourceContext.getImageData(
    0,
    0,
    sourceCanvas.width,
    sourceCanvas.height,
  )

  function psnrRGB(reference, decoded) {
    let squaredError = 0
    for (let i = 0; i < reference.length; i += 4) {
      for (let channel = 0; channel < 3; channel++) {
        const difference = reference[i + channel] - decoded[i + channel]
        squaredError += difference * difference
      }
    }
    const mse = squaredError / ((reference.length / 4) * 3)
    return mse === 0 ? Infinity : 10 * Math.log10(65025 / mse)
  }

  function concatBytes(...arrays) {
    const result = new Uint8Array(
      arrays.reduce((sum, array) => sum + array.length, 0),
    )
    let offset = 0
    for (const array of arrays) {
      result.set(array, offset)
      offset += array.length
    }
    return result
  }

  function u16(value) {
    return new Uint8Array([(value >>> 8) & 255, value & 255])
  }

  function u32(value) {
    return new Uint8Array([
      (value >>> 24) & 255,
      (value >>> 16) & 255,
      (value >>> 8) & 255,
      value & 255,
    ])
  }

  function fourcc(value) {
    return new TextEncoder().encode(value)
  }

  function box(type, payload) {
    return concatBytes(u32(8 + payload.length), fourcc(type), payload)
  }

  function fullBox(type, version, flags, payload) {
    return box(type, concatBytes(u32((version << 24) | flags), payload))
  }

  function startCodeLength(data, offset) {
    if (data[offset] !== 0 || data[offset + 1] !== 0) return 0
    if (data[offset + 2] === 1) return 3
    if (data[offset + 2] === 0 && data[offset + 3] === 1) return 4
    return 0
  }

  function annexBToLengthPrefixed(data) {
    let firstStart = -1
    for (let i = 0; i + 3 < data.length; i++) {
      if (startCodeLength(data, i)) {
        firstStart = i
        break
      }
    }
    if (firstStart < 0) return data

    const nals = []
    let start = firstStart
    while (start < data.length) {
      const prefix = startCodeLength(data, start)
      const nalStart = start + prefix
      let next = nalStart
      while (next + 3 < data.length && !startCodeLength(data, next)) next++
      const nalEnd = next < data.length ? next : data.length
      if (nalEnd > nalStart) nals.push(data.subarray(nalStart, nalEnd))
      start = next
    }
    return concatBytes(...nals.map((nal) => concatBytes(u32(nal.length), nal)))
  }

  function hevcDescriptionBytes(description) {
    if (!description)
      throw new Error('WebCodecs did not provide an HEVC decoder description')
    const bytes = new Uint8Array(description)
    if (
      bytes.length >= 8 &&
      new TextDecoder().decode(bytes.subarray(4, 8)) === 'hvcC'
    ) {
      const size = new DataView(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength,
      ).getUint32(0)
      return bytes.subarray(8, Math.min(size, bytes.length))
    }
    return bytes
  }

  function muxHevcStillToHeic(width, height, description, chunks) {
    const hvcC = hevcDescriptionBytes(description)
    const data = concatBytes(
      ...chunks.map((chunk) => annexBToLengthPrefixed(chunk.data)),
    )
    const ftyp = box(
      'ftyp',
      concatBytes(fourcc('heic'), u32(0), fourcc('mif1'), fourcc('heic')),
    )
    const hdlr = fullBox(
      'hdlr',
      0,
      0,
      concatBytes(
        u32(0),
        fourcc('pict'),
        new Uint8Array(12),
        new Uint8Array([0]),
      ),
    )
    const pitm = fullBox('pitm', 0, 0, u16(1))
    const ispe = fullBox('ispe', 0, 0, concatBytes(u32(width), u32(height)))
    const pixi = fullBox('pixi', 0, 0, new Uint8Array([3, 8, 8, 8]))
    const ipco = box('ipco', concatBytes(box('hvcC', hvcC), ispe, pixi))
    const ipma = fullBox(
      'ipma',
      0,
      0,
      concatBytes(u32(1), u16(1), new Uint8Array([3, 0x81, 2, 3])),
    )
    const iprp = box('iprp', concatBytes(ipco, ipma))
    const infe = fullBox(
      'infe',
      2,
      0,
      concatBytes(u16(1), u16(0), fourcc('hvc1'), new Uint8Array([0])),
    )
    const iinf = fullBox('iinf', 0, 0, concatBytes(u16(1), infe))

    function makeMeta(payloadOffset) {
      const iloc = fullBox(
        'iloc',
        0,
        0,
        concatBytes(
          new Uint8Array([0x44, 0x40]),
          u16(1),
          u16(1),
          u16(0),
          u32(0),
          u16(1),
          u32(payloadOffset),
          u32(data.length),
        ),
      )
      return box('meta', concatBytes(u32(0), hdlr, pitm, iloc, iinf, iprp))
    }

    const mdat = box('mdat', data)
    let meta = makeMeta(0)
    meta = makeMeta(ftyp.length + meta.length + 8)
    return concatBytes(ftyp, meta, mdat)
  }

  async function runKvazaar() {
    const start = performance.now()
    const encoded = globalThis.Module.jsEncodeImage(
      new Uint8Array(source.data),
      source.width,
      source.height,
      75,
      'ultrafast',
    )
    const encodeWallMs = performance.now() - start
    if (encoded.err) throw new Error(`Kvazaar encode: ${encoded.err}`)

    const decoded = globalThis.Module.jsDecodeImage(
      new Uint8Array(encoded.data),
    )
    if (decoded.err) throw new Error(`Kvazaar decode: ${decoded.err}`)
    const bitmap = decoded.data[0]
    if (!bitmap) throw new Error('Kvazaar returned no decoded image')
    const decodedPixels = bitmap.data.slice(0, source.data.length)

    return {
      codec: 'wasm-kvazaar-ultrafast',
      container: 'HEIC',
      heifMuxIncluded: true,
      encodeWallMs,
      totalWallMs: performance.now() - start,
      bytes: encoded.data.length,
      psnrDb: psnrRGB(source.data, decodedPixels),
    }
  }

  async function supportedConfig(codec, hardwareAcceleration) {
    if (typeof VideoEncoder !== 'function') return null
    try {
      const support = await VideoEncoder.isConfigSupported({
        codec,
        width: source.width,
        height: source.height,
        bitrate: 30_000_000,
        bitrateMode: 'variable',
        framerate: 1,
        hardwareAcceleration,
        latencyMode: 'quality',
        hevc: { format: 'hevc' },
      })
      return support.supported ? support.config : null
    } catch {
      return null
    }
  }

  async function findCodec(hardwareAcceleration) {
    for (const codec of [
      'hvc1.1.6.L180.B0',
      'hvc1.1.6.L153.B0',
      'hvc1.1.6.L120.B0',
    ]) {
      if (await supportedConfig(codec, hardwareAcceleration)) return codec
    }
    return null
  }

  async function runWebCodecs(hardwareAcceleration, codec, quantizer) {
    const chunks = []
    let decoderConfig
    let encoderError
    const start = performance.now()
    const encoder = new VideoEncoder({
      output(chunk, metadata) {
        const data = new Uint8Array(chunk.byteLength)
        chunk.copyTo(data)
        chunks.push({
          type: chunk.type,
          timestamp: chunk.timestamp,
          duration: chunk.duration,
          data,
        })
        decoderConfig ??= metadata?.decoderConfig
      },
      error(error) {
        encoderError = String(error)
      },
    })

    encoder.configure({
      codec,
      width: source.width,
      height: source.height,
      bitrate: 30_000_000,
      bitrateMode: 'variable',
      framerate: 1,
      hardwareAcceleration,
      latencyMode: 'quality',
      hevc: { format: 'hevc' },
    })
    const frame = new VideoFrame(sourceCanvas, { timestamp: 0 })
    encoder.encode(frame, { keyFrame: true, hevc: { quantizer } })
    await encoder.flush()
    frame.close()
    encoder.close()
    if (encoderError) throw new Error(encoderError)
    const muxStart = performance.now()
    const heic = muxHevcStillToHeic(
      source.width,
      source.height,
      decoderConfig?.description,
      chunks,
    )
    const heifMuxMs = performance.now() - muxStart
    const decoded = globalThis.Module.jsDecodeImage(new Uint8Array(heic))
    if (decoded.err) throw new Error(`WebCodecs HEIC decode: ${decoded.err}`)
    const bitmap = decoded.data[0]
    if (!bitmap) throw new Error('WebCodecs HEIC returned no decoded image')
    const decodedPixels = bitmap.data.slice(0, source.data.length)

    return {
      codec: `webcodecs-${hardwareAcceleration}`,
      container: 'HEIC',
      heifMuxIncluded: true,
      heifMuxMs,
      encodeWallMs: performance.now() - start,
      totalWallMs: performance.now() - start,
      bytes: heic.length,
      psnrDb: psnrRGB(source.data, decodedPixels),
      chunks: chunks.length,
      quantizer,
    }
  }

  const kvazaarRuns = []
  await runKvazaar()
  for (let run = 0; run < 5; run++) kvazaarRuns.push(await runKvazaar())
  const kvazaarRunsByTime = [...kvazaarRuns].sort(
    (a, b) => a.encodeWallMs - b.encodeWallMs,
  )
  const kvazaar = kvazaarRunsByTime[2]
  const webcodecs = []
  const webcodecsCodecs = {}

  const quantizers = [10, 15, 20, 25, 30, 35, 40, 45, 50]
  for (const hardwareAcceleration of ['prefer-hardware', 'prefer-software']) {
    const codec = await findCodec(hardwareAcceleration)
    webcodecsCodecs[hardwareAcceleration] = codec
    if (!codec) {
      webcodecs.push({
        codec: `webcodecs-${hardwareAcceleration}`,
        container: 'HEIC',
        supported: false,
        error: `No HEVC encode config supported with hardwareAcceleration="${hardwareAcceleration}"`,
      })
      continue
    }
    const tuningRuns = []
    for (const quantizer of quantizers) {
      try {
        tuningRuns.push(
          await runWebCodecs(hardwareAcceleration, codec, quantizer),
        )
      } catch (error) {
        tuningRuns.push({
          codec: `webcodecs-${hardwareAcceleration}`,
          quantizer,
          error: String(error),
        })
      }
    }
    const coarseUsable = tuningRuns.filter((run) => Number.isFinite(run.psnrDb))
    if (coarseUsable.length) {
      coarseUsable.sort(
        (a, b) =>
          Math.abs(a.psnrDb - kvazaar.psnrDb) -
          Math.abs(b.psnrDb - kvazaar.psnrDb),
      )
      const refinement = Array.from(
        { length: 5 },
        (_, index) => coarseUsable[0].quantizer - 2 + index,
      ).filter(
        (quantizer) =>
          quantizer >= 0 && quantizer <= 51 && !quantizers.includes(quantizer),
      )
      for (const quantizer of refinement) {
        try {
          tuningRuns.push(
            await runWebCodecs(hardwareAcceleration, codec, quantizer),
          )
        } catch (error) {
          tuningRuns.push({
            codec: `webcodecs-${hardwareAcceleration}`,
            quantizer,
            error: String(error),
          })
        }
      }
    }
    const usable = tuningRuns.filter((run) => Number.isFinite(run.psnrDb))
    usable.sort(
      (a, b) =>
        Math.abs(a.psnrDb - kvazaar.psnrDb) -
        Math.abs(b.psnrDb - kvazaar.psnrDb),
    )
    if (!usable[0]) {
      webcodecs.push({
        codec: `webcodecs-${hardwareAcceleration}`,
        container: 'HEIC',
        supported: false,
        error: 'No quantizer run produced a finite PSNR',
      })
      continue
    }
    const selected = usable[0]
    const measured = []
    await runWebCodecs(hardwareAcceleration, codec, selected.quantizer)
    for (let run = 0; run < 5; run++) {
      measured.push(
        await runWebCodecs(hardwareAcceleration, codec, selected.quantizer),
      )
    }
    measured.sort((a, b) => a.encodeWallMs - b.encodeWallMs)
    webcodecs.push({
      ...measured[2],
      supported: true,
      targetPsnrDb: kvazaar.psnrDb,
      tuningCandidates: tuningRuns.map((run) => run.quantizer),
      tuningPsnrDb: tuningRuns.map((run) => ({
        quantizer: run.quantizer,
        psnrDb: run.psnrDb,
        error: run.error,
      })),
    })
  }

  const hardwareCodec = webcodecsCodecs['prefer-hardware']
  const softwareCodec = webcodecsCodecs['prefer-software']

  return {
    file: 'input',
    width: source.width,
    height: source.height,
    megapixels: +((source.width * source.height) / 1_000_000).toFixed(2),
    commonWebCodecsCodec:
      hardwareCodec && hardwareCodec === softwareCodec ? hardwareCodec : null,
    webcodecsCodecs,
    kvazaar,
    webcodecs,
    note: 'WebCodecs rows include the benchmark HEIF mux and are decoded with the same libheif WASM decoder as Kvazaar.',
  }
})

result.file = basename(inputPath)
console.log(JSON.stringify(result, null, 2))
await browser.close()
server.close()
