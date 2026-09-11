declare module 'imagequant/imagequant_bg.js' {
  export function __wbg_set_wasm(value: unknown): void
  export const Imagequant: new () => {
    set_max_colors(count: number): void
    set_speed(speed: number): void
    process(image: unknown): Uint8Array
  }
  export const ImagequantImage: new (
    data: Uint8Array,
    width: number,
    height: number,
    gamma: number,
  ) => unknown
}

declare module 'imagequant/imagequant_bg.wasm?url' {
  const url: string
  export default url
}
