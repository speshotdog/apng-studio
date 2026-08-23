/**
 * 多格式讀取驗證：確認 .procreate／.psd 走得完「解析 → 圖層樹 → 合成」整條路，
 * 並把結果寫成 PNG 讓人肉眼確認。樣本路徑用環境變數指定，找不到就跳過。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { encodePng } from '../src/codec/png.js'
import { isSupported, parseSource, SUPPORTED } from '../src/formats/index.js'
import type { SourceLayer } from '../src/formats/types.js'

const OUT = 'assets/format-check'
const samples = process.argv.slice(2)
if (!samples.length) {
  console.log('用法：tsx scripts/verify-formats.ts <檔案...>')
  process.exit(0)
}

function describe(node: SourceLayer, depth = 0): string[] {
  return [
    `${'  '.repeat(depth)}${node.isFolder ? '▸' : '·'} #${node.id} ${node.name}` +
      `${node.visible ? '' : '（隱藏）'} α=${node.opacity.toFixed(2)}`,
    ...node.children.flatMap((child) => describe(child, depth + 1)),
  ]
}

await mkdir(OUT, { recursive: true })
for (const sample of samples) {
  if (!isSupported(sample)) throw new Error(`不支援：${sample}`)
  const doc = await parseSource(sample, await readFile(sample))
  const name = basename(sample).replace(/\.[^.]+$/, '')
  console.log(`\n=== ${basename(sample)}（${SUPPORTED[sample.slice(sample.lastIndexOf('.'))]}）`)
  console.log(`畫布 ${doc.canvas.width}×${doc.canvas.height}　圖層 ${doc.flat.size - 1} 個`)
  console.log(describe(doc.root).slice(0, 40).join('\n'))

  const paint = [...doc.flat.values()].filter((layer) => !layer.isFolder)
  if (!paint.length) throw new Error(`${sample} 沒有解析到任何一般圖層`)
  let painted = 0
  for (const layer of paint.slice(0, 3)) {
    const bitmap = doc.renderNode(layer.id)
    if (bitmap.width !== doc.canvas.width || bitmap.height !== doc.canvas.height)
      throw new Error(`圖層 ${layer.id} 的 bitmap 尺寸不是畫布尺寸`)
    const opaque = bitmap.data.reduce(
      (count, value, index) => (index % 4 === 3 && value > 0 ? count + 1 : count),
      0,
    )
    painted += opaque
    console.log(`  圖層 #${layer.id} 不透明像素 ${opaque}`)
    await writeFile(
      join(OUT, `${name}-layer-${layer.id}.png`),
      encodePng(new Uint8Array(bitmap.data), bitmap.width, bitmap.height),
    )
  }
  if (!painted) throw new Error(`${sample} 前三個圖層全是空的，解碼八成有問題`)
  const root = doc.renderNode(doc.root.id)
  await writeFile(
    join(OUT, `${name}-composite.png`),
    encodePng(new Uint8Array(root.data), root.width, root.height),
  )
}
console.log(`\n多格式讀取驗證通過，輸出在 ${OUT}/`)
