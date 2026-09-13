import { afterEach, describe, expect, it } from 'vitest'
import {
  acquireFileBuffer,
  configureFileReadConcurrency,
  forgetFile,
  registerFile,
  releaseFileBuffer,
  resetFileReadConcurrencyForTests,
  setFileBufferCapForTests,
} from './fileBufferStore'

let counter = 0
const nextId = () => `job-${++counter}`
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => {
  setFileBufferCapForTests(320 * 1024 * 1024)
  resetFileReadConcurrencyForTests()
})

describe('fileBufferStore', () => {
  it('reads a registered file', async () => {
    const id = nextId()
    const file = new File([new Uint8Array([1, 2, 3])], 'a.jpg')
    registerFile(id, file)
    const buffer = await acquireFileBuffer(id)
    expect(new Uint8Array(buffer)).toEqual(new Uint8Array([1, 2, 3]))
    releaseFileBuffer(id)
  })

  it('reads on demand when the eager read was capped away', async () => {
    setFileBufferCapForTests(0)
    const id = nextId()
    registerFile(id, new File([new Uint8Array([9])], 'b.jpg'))
    const buffer = await acquireFileBuffer(id)
    expect(new Uint8Array(buffer)).toEqual(new Uint8Array([9]))
    releaseFileBuffer(id)
  })

  it('shares the cached buffer across acquires', async () => {
    const id = nextId()
    let reads = 0
    const file = {
      arrayBuffer: () => {
        reads += 1
        return Promise.resolve(new ArrayBuffer(4))
      },
    } as unknown as File
    registerFile(id, file)
    await acquireFileBuffer(id)
    await acquireFileBuffer(id)
    expect(reads).toBe(1)
    releaseFileBuffer(id)
  })

  it('re-reads on demand after the buffer is released', async () => {
    const id = nextId()
    let reads = 0
    const file = {
      arrayBuffer: () => {
        reads += 1
        return Promise.resolve(new Uint8Array([7]).buffer)
      },
    } as unknown as File
    registerFile(id, file)
    await acquireFileBuffer(id)
    releaseFileBuffer(id)
    const buffer = await acquireFileBuffer(id)
    expect(new Uint8Array(buffer)).toEqual(new Uint8Array([7]))
    expect(reads).toBe(2)
    forgetFile(id)
  })

  it('rejects after the file is forgotten', async () => {
    const id = nextId()
    registerFile(id, new File([new Uint8Array([1])], 'c.jpg'))
    await acquireFileBuffer(id)
    forgetFile(id)
    await expect(acquireFileBuffer(id)).rejects.toThrow('no longer available')
  })

  it('surfaces read failures without an unhandled rejection', async () => {
    const id = nextId()
    const failure = new DOMException(
      'The object can not be found here.',
      'NotFoundError',
    )
    const file = {
      arrayBuffer: () => Promise.reject(failure),
    } as unknown as File
    registerFile(id, file)
    await expect(acquireFileBuffer(id)).rejects.toThrow('can not be found')
  })
})

describe('fileBufferStore reservations', () => {
  const delayedFile = (size: number, onRead: () => void): File =>
    ({
      size,
      arrayBuffer: () => {
        onRead()
        return new Promise<ArrayBuffer>((resolve) =>
          setTimeout(() => resolve(new ArrayBuffer(size)), 5),
        )
      },
    }) as unknown as File

  it('skips eager reads that exceed the cap and reads on demand instead', async () => {
    setFileBufferCapForTests(2)
    const id = nextId()
    let reads = 0
    registerFile(
      id,
      delayedFile(10, () => (reads += 1)),
    )
    await flush()
    expect(reads).toBe(0)

    const buffer = await acquireFileBuffer(id)
    expect(buffer.byteLength).toBe(10)
    expect(reads).toBe(1)
    forgetFile(id)
  })

  it('reserves bytes so in-flight eager reads respect the cap', async () => {
    setFileBufferCapForTests(6)
    const first = nextId()
    const second = nextId()
    let reads = 0
    registerFile(
      first,
      delayedFile(4, () => (reads += 1)),
    )
    registerFile(
      second,
      delayedFile(4, () => (reads += 1)),
    )
    await flush()
    // 4 buffered/reserved + 4 does not fit in 6, so only one eager read starts.
    expect(reads).toBe(1)

    await acquireFileBuffer(first)
    await acquireFileBuffer(second)
    expect(reads).toBe(2)
    forgetFile(first)
    forgetFile(second)
  })

  it('limits eager read concurrency independently of the buffer cap', async () => {
    setFileBufferCapForTests(1024)
    configureFileReadConcurrency(1)
    const first = nextId()
    const second = nextId()
    let reads = 0
    registerFile(
      first,
      delayedFile(1, () => (reads += 1)),
    )
    registerFile(
      second,
      delayedFile(1, () => (reads += 1)),
    )
    await flush()
    expect(reads).toBe(1)

    await acquireFileBuffer(first)
    await acquireFileBuffer(second)
    expect(reads).toBe(2)
    forgetFile(first)
    forgetFile(second)
  })
})
