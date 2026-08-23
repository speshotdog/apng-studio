import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

const require = createRequire(import.meta.url)
const sqlWasm = readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'))

export default defineConfig({
  main: {
    plugins: [
      {
        name: 'sql-wasm',
        generateBundle() {
          this.emitFile({ type: 'asset', fileName: 'sql-wasm.wasm', source: sqlWasm })
        },
      },
    ],
    build: { rollupOptions: { input: resolve('src/main/index.ts') } },
  },
  preload: { build: { rollupOptions: { input: resolve('src/preload/index.ts') } } },
  renderer: { root: resolve('src/renderer'), plugins: [react()] },
})
