import { describe, expect, it } from 'vitest'
import { validateFiles, validateImageFile } from './intake'

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]
const WEBP = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]
const AVIF = [
  0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66, 0, 0, 0, 0,
]

function file(bytes: number[], name: string): File {
  return new File([new Uint8Array(bytes)], name)
}

describe('validateImageFile', () => {
  it('accepts each supported magic-byte signature', async () => {
    for (const bytes of [PNG, JPEG, WEBP, AVIF]) {
      await expect(
        validateImageFile(file(bytes, 'image.bin')),
      ).resolves.toEqual({ accepted: true })
    }
  })

  it('rejects unsupported content regardless of extension', async () => {
    const result = await validateImageFile(
      file([1, 2, 3, 4, 5, 6, 7, 8], 'photo.jpg'),
    )
    expect(result.accepted).toBe(false)
    expect(result.reason).toContain('Unsupported')
  })

  it('rejects empty files', async () => {
    const result = await validateImageFile(file([], 'empty.png'))
    expect(result.accepted).toBe(false)
    expect(result.reason).toBe('Empty file')
  })
})

describe('validateFiles', () => {
  it('partitions accepted and rejected files in order', async () => {
    const files = [
      file(PNG, 'a.png'),
      file([9, 9, 9], 'bad.txt'),
      file(JPEG, 'b.jpg'),
    ]
    const outcome = await validateFiles(files, 2)
    expect(outcome.accepted.map((entry) => entry.name)).toEqual([
      'a.png',
      'b.jpg',
    ])
    expect(outcome.rejected.map((entry) => entry.name)).toEqual(['bad.txt'])
  })

  it('handles an empty batch', async () => {
    await expect(validateFiles([])).resolves.toEqual({
      accepted: [],
      rejected: [],
    })
  })
})
