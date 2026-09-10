import preact from '@preact/preset-vite'
import { defineConfig } from 'vite'

export default defineConfig({
  base: '/image-compressor-v1/',
  plugins: [preact()],
  optimizeDeps: {
    exclude: [
      '@jsquash/avif',
      '@jsquash/jpeg',
      '@jsquash/jxl',
      '@jsquash/png',
      '@jsquash/webp',
    ],
  },
  build: {
    target: 'es2022',
  },
  worker: {
    format: 'es',
  },
})
