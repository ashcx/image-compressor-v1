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

  it('tracks retained bytes and flags when over budget', async () => {
    const store = createMemoryOutputStore(10)
    expect(store.memoryBytes).toBe(0)
    expect(store.overBudget).toBe(false)

    await store.put('a', blob('hello'))
    expect(store.memoryBytes).toBe(5)
    expect(store.overBudget).toBe(false)

    await store.put('b', blob('world!'))
    expect(store.memoryBytes).toBe(11)
    expect(store.overBudget).toBe(true)

    await store.delete('a')
    expect(store.memoryBytes).toBe(6)

    await store.clear()
    expect(store.memoryBytes).toBe(0)
    expect(store.overBudget).toBe(false)
  })

  it('replaces an existing blob without double-counting its bytes', async () => {
    const store = createMemoryOutputStore(100)
    await store.put('a', blob('hello'))
    await store.put('a', blob('hi'))
    expect(store.memoryBytes).toBe(2)
    expect(await (await store.get('a'))?.text()).toBe('hi')
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

  it('clears a memory store without OPFS', async () => {
    const store = await createOutputStore()
    await store.put('x', blob('hi'))
    await store.clear()
    expect(await await store.get('x')).toBeNull()
  })
})
