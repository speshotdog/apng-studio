// 臨時診斷：dump 09.clip 的 CSP 時間軸解析結果與動畫資料夾結構
import { readFileSync } from 'node:fs'
import { parseClip } from '../src/clip/index.js'

const buffer = readFileSync(new URL('../assets/samples/09.clip', import.meta.url))
const doc = await parseClip(buffer)

console.log('canvas:', doc.canvas.width, 'x', doc.canvas.height)
console.log('timelines:', doc.cspTimelines.length)
for (const tl of doc.cspTimelines) {
  console.log('---')
  console.log('folder:', tl.animationFolderId, JSON.stringify(tl.animationFolderName))
  console.log('frameRate:', tl.frameRate, 'frameCount:', tl.frameCount)
  console.log('warnings:', tl.warnings)
  console.log('keys:', tl.keys.map((k) => `${k.frame}:${k.celName}`).join(' '))
}
console.log('=== 圖層樹（動畫資料夾與子層） ===')
const visit = (node: any, depth: number) => {
  console.log('  '.repeat(depth) + `${node.id} ${JSON.stringify(node.name)}${node.isFolder ? ' [folder]' : ''}`)
  for (const c of node.children ?? []) visit(c, depth + 1)
}
visit(doc.root ?? (doc as any).tree, 0)
