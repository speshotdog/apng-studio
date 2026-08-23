import { build } from 'esbuild'

// smoke 與 try-giphy 都得在 Electron 主程序裡跑（要用 safeStorage / dialog），
// 所以先 bundle 成單一 .js 再交給 electron 執行。
const entries = [
  ['scripts/smoke.ts', 'scripts/smoke.js'],
  ['scripts/try-giphy.ts', 'scripts/try-giphy.js'],
]

for (const [entryPoint, outfile] of entries) {
  await build({
    entryPoints: [entryPoint],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    external: ['electron', 'sql.js'],
    sourcemap: false,
  })
}
