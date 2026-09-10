import { zipSync } from 'fflate'

export interface ZipEntry {
  name: string
  data: Uint8Array
}

/**
 * Returns a name that is not already in `used`, appending `-2`, `-3`, … before
 * the extension on collision, and records it. Keeps batches whose inputs share a
 * filename (e.g. photo.jpg from two folders) from overwriting each other.
 */
export function uniqueEntryName(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name)
    return name
  }

  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  const extension = dot > 0 ? name.slice(dot) : ''

  let index = 2
  let candidate = `${base}-${index}${extension}`
  while (used.has(candidate)) {
    index += 1
    candidate = `${base}-${index}${extension}`
  }
  used.add(candidate)
  return candidate
}

export function buildZip(entries: ZipEntry[]): Uint8Array<ArrayBuffer> {
  const used = new Set<string>()
  const files: Record<string, Uint8Array> = {}

  for (const entry of entries) {
    files[uniqueEntryName(entry.name, used)] = entry.data
  }

  // Images are already compressed, so deflating them again wastes CPU for
  // almost no size gain; store the bytes and just bundle them.
  return zipSync(files, { level: 0 }) as Uint8Array<ArrayBuffer>
}
