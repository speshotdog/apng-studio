import { build } from 'esbuild'

await build({
  entryPoints: ['scripts/smoke.ts'],
  outfile: 'scripts/smoke.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  external: ['electron', 'sql.js'],
  sourcemap: false,
})
