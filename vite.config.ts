import preact from '@preact/preset-vite'
import { defineConfig, type Plugin } from 'vite'

declare const process: { env: Record<string, string | undefined> }

function resolveVersion(): string {
  const fromCi = process.env.GITHUB_SHA ?? process.env.COMMIT_SHA
  if (fromCi) return fromCi.slice(0, 7)
  return Date.now().toString(36)
}

function versionPlugin(version: string): Plugin {
  return {
    name: 'emit-version',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ version }),
      })
    },
  }
}

export default defineConfig(() => {
  const version = resolveVersion()

  return {
    base: '/image-compressor-v1/',
    define: {
      __APP_VERSION__: JSON.stringify(version),
    },
    plugins: [preact(), versionPlugin(version)],
    optimizeDeps: {
      exclude: [
        '@jsquash/avif',
        '@jsquash/jxl',
        '@jsquash/oxipng',
        '@jsquash/png',
        'imagequant',
      ],
    },
    build: {
      target: 'es2022',
    },
    worker: {
      format: 'es' as const,
    },
  }
})
