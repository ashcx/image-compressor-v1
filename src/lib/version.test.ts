import { afterEach, describe, expect, it, vi } from 'vitest'
import { watchForUpdates } from './version'

function stubVersion(version: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ version }),
    })),
  )
}

describe('watchForUpdates', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('notifies when the deployed version differs from the running build', async () => {
    stubVersion('newsha')
    const onUpdate = vi.fn()

    const stop = watchForUpdates(onUpdate, 'oldsha')
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledWith('newsha'))
    stop()
  })

  it('stays quiet when the deployed version matches', async () => {
    stubVersion('same')
    const onUpdate = vi.fn()

    const stop = watchForUpdates(onUpdate, 'same')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(onUpdate).not.toHaveBeenCalled()
    stop()
  })

  it('ignores responses without a version', async () => {
    stubVersion('')
    const onUpdate = vi.fn()

    const stop = watchForUpdates(onUpdate, 'oldsha')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(onUpdate).not.toHaveBeenCalled()
    stop()
  })
})
