interface ImagequantInstance {
  set_max_colors(count: number): void
  set_speed(speed: number): void
  process(image: unknown): Uint8Array
}

interface ImagequantApi {
  Imagequant: new () => ImagequantInstance
  ImagequantImage: new (
    data: Uint8Array,
    width: number,
    height: number,
    gamma: number,
  ) => unknown
}

let apiPromise: Promise<ImagequantApi> | null = null

async function loadImagequant(): Promise<ImagequantApi> {
  if (!apiPromise) {
    apiPromise = (async () => {
      const iqbg = await import('imagequant/imagequant_bg.js')
      const { default: wasmUrl } = await import(
        'imagequant/imagequant_bg.wasm?url'
      )
      const module = await WebAssembly.compile(
        await (await fetch(wasmUrl)).arrayBuffer(),
      )
      const imports: Record<string, object> = {}
      for (const entry of WebAssembly.Module.imports(module)) {
        imports[entry.module] = iqbg
      }
      const instance = await WebAssembly.instantiate(
        module,
        imports as unknown as WebAssembly.Imports,
      )
      iqbg.__wbg_set_wasm(instance.exports)
      return iqbg as unknown as ImagequantApi
    })()
  }
  return apiPromise
}

/**
 * Lossy palette PNG (256 colours) via libimagequant. Returns a ready PNG.
 * Best for screenshots/graphics; can band gradients and photos.
 */
export async function encodeImagequant(
  imageData: ImageData,
): Promise<ArrayBuffer> {
  const api = await loadImagequant()
  // The quantizer may mutate/free the input, so hand it a fresh copy.
  const rgba = new Uint8Array(imageData.data)
  const quant = new api.Imagequant()
  quant.set_max_colors(256)
  quant.set_speed(5)
  const image = new api.ImagequantImage(
    rgba,
    imageData.width,
    imageData.height,
    0,
  )
  const png = quant.process(image)
  return new Uint8Array(png).buffer
}
