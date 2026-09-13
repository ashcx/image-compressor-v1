import { describe, expect, it } from 'vitest'
import { createMemoryOutputStore, createOutputStore } from './outputStore'

const blob = (text: string) => new Blob([text])

describe('memory output store', () => {
  it('puts, gets, deletes, and clears', async () => {
    const store = createMemoryOutputStore()
    expect(store.persistent).toBe(false)

    await store.put('a', blob('one'))
    expect(await (await store.get('a'))?.text()).toBe('one')

    await store.delete('a')
    expect(await store.get('a')).toBeNull()

    await store.put('b', blob('two'))
    await store.clear()
    expect(await store.get('b')).toBeNull()
  })

  it('returns null for unknown ids', async () => {
    const store = createMemoryOutputStore()
    expect(await store.get('missing')).toBeNull()
  })
})

describe('createOutputStore', () => {
  it('falls back to an in-memory store without OPFS', async () => {
    const store = await createOutputStore()
    expect(store.persistent).toBe(false)

    await store.put('x', blob('hi'))
    expect(await (await store.get('x'))?.text()).toBe('hi')
    await store.delete('x')
    expect(await store.get('x')).toBeNull()
  })
})
