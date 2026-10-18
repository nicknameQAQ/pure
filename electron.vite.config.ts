import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: { build: { externalizeDeps: false } },
  preload: {
    build: { externalizeDeps: false, rollupOptions: { output: { format: 'cjs', entryFileNames: 'index.cjs' } } },
  },
  renderer: {
    plugins: [react()],
    build: { minify: true, rollupOptions: { input: resolve('src/renderer/index.html') } },
  },
})
