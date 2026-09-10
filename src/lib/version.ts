declare const __APP_VERSION__: string

export const appVersion =
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'

const CHECK_INTERVAL_MS = 60_000

/**
 * Polls the deployed `version.json` (cache-busted) and invokes `onUpdate` when it
 * differs from the running build. GitHub Pages cannot set `Cache-Control`, so the
 * HTML can be served stale for up to 10 minutes; this gives the app a way to detect
 * a newer deploy and prompt the user to reload, with the reload revalidating the
 * document.
 */
export function watchForUpdates(
  onUpdate: (version: string) => void,
  currentVersion: string = appVersion,
): () => void {
  let stopped = false

  async function check(): Promise<void> {
    if (stopped) return
    try {
      const response = await fetch(
        `${import.meta.env.BASE_URL}version.json?t=${Date.now()}`,
        { cache: 'no-store' },
      )
      if (!response.ok) return
      const data = (await response.json()) as { version?: string }
      if (!stopped && data.version && data.version !== currentVersion) {
        onUpdate(data.version)
      }
    } catch {
      // Offline or blocked; try again on the next tick.
    }
  }

  const interval = setInterval(check, CHECK_INTERVAL_MS)
  const onFocus = () => void check()
  if (typeof window !== 'undefined') window.addEventListener('focus', onFocus)
  if (typeof document !== 'undefined')
    document.addEventListener('visibilitychange', onFocus)
  void check()

  return () => {
    stopped = true
    clearInterval(interval)
    if (typeof window !== 'undefined')
      window.removeEventListener('focus', onFocus)
    if (typeof document !== 'undefined')
      document.removeEventListener('visibilitychange', onFocus)
  }
}
