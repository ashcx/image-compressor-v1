export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`

  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`
}

export function replaceExtension(name: string, extension: string): string {
  const base = name.replace(/\.[^./\\]+$/, '')
  return `${base}.${extension}`
}

export function percentReduction(
  originalSize: number,
  outputSize: number,
): number {
  if (originalSize <= 0) return 0
  return Math.round(((originalSize - outputSize) / originalSize) * 100)
}
