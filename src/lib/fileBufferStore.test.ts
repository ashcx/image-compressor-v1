import { afterEach, describe, expect, it } from 'vitest'
import {
  acquireFileBuffer,
  forgetFile,
  registerFile,
  releaseFileBuffer,
  setFileBufferCapForTests,
} from './fileBufferStore'

let counter = 0
const nextId = () => `job-${++counter}`

afterEach(() => {
  setFileBufferCapForTests(320 * 1024 * 1024)
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
