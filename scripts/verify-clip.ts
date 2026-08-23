import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import UPNG from 'upng-js'
import { inflateSync } from 'node:zlib'
import { readChunks } from '../src/clip/chunks.js'
import { openClipDatabase, queryRows } from '../src/clip/db.js'
import { parseBinc } from '../src/clip/binc.js'
import { parseClip, type Bitmap } from '../src/clip/index.js'

function arrayBuffer(data: Uint8Array | Uint8ClampedArray): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
}

function decodePng(data: Uint8Array): Bitmap {
  const image = UPNG.decode(arrayBuffer(data))
  const rgba = UPNG.toRGBA8(image)[0]
  if (!rgba) throw new Error('PNG 沒有可解碼的影格')
  return { width: image.width, height: image.height, data: new Uint8ClampedArray(rgba) }
}

const sample = await readFile(resolve('assets/samples/11.clip'))
const chunks = readChunks(sample)
const bincDb = await openClipDatabase(chunks.sqlite)
const mixerRow = queryRows(bincDb, 'SELECT TrackActionMixer FROM Track WHERE TrackKind = 2000')[0]!
const mixerId =
  typeof mixerRow.TrackActionMixer === 'string'
    ? mixerRow.TrackActionMixer
    : Buffer.from(mixerRow.TrackActionMixer as Uint8Array).toString('utf8')
const mixer = chunks.external.get(mixerId)!
const unpackedBinc = inflateSync(mixer.subarray(4))
assert.equal(unpackedBinc.length, 1572)
parseBinc(unpackedBinc)
bincDb.close()
const document = await parseClip(sample)
assert.equal(document.canvas.width, 360)
assert.equal(document.canvas.height, 360)
assert.equal(document.flat.size, 25)
assert.equal(document.root.id, 2)

const animationFolder = [...document.flat.values()].find((layer) => layer.isAnimationFolder)
assert(animationFolder, '找不到動畫資料夾')
assert.equal(animationFolder.id, 5)
assert.equal(animationFolder.name, '資料夾 1')
const actualOrder = animationFolder.children.map((layer) => layer.name)
console.log(`動畫資料夾實際順序：${actualOrder.join(', ')}`)
assert.deepEqual([...actualOrder].sort(), ['1', '1a', '1b', '2', '3', '4'].sort())

const layer2 = document.flat.get(9)
assert(layer2, '找不到 MainId 9')
assert.equal(layer2.name, '圖層 2')
assert.equal(layer2.offsetX, 8)
assert.equal(layer2.offsetY, -20)
assert.equal(layer2.renderOffsetX, -8)
assert.equal(layer2.renderOffsetY, 20)
assert(document.timeline, '找不到時間軸')
assert.equal(document.timeline.frameRate, 20)
assert.equal(document.timeline.endFrame, 20)
assert.equal(document.cspTimelines.length, 1)
const cspTimeline = document.cspTimelines[0]!
assert.equal(cspTimeline.animationFolderId, 5)
assert.equal(cspTimeline.animationFolderName, '資料夾 1')
assert.equal(cspTimeline.frameRate, 20)
assert.equal(cspTimeline.frameCount, 20)
assert.equal(cspTimeline.keys.length, 19)
assert.deepEqual(
  cspTimeline.keys.map((key) => key.frame),
  [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
)
assert.deepEqual(
  cspTimeline.keys.map((key) => key.celName),
  ['1', '1a', '1b', '2', '3', '4', '2', '3', '4', '3', '2', '4', '2', '3', '4', '3', '2', '4', '2'],
)
assert.deepEqual(cspTimeline.warnings, [])

await mkdir(resolve('out/verify'), { recursive: true })
const goldenLayerIds = [3, 9, 11, 12, 16, 17, 18, 20, 21, 22, 32, 34, 36, 38, 40, 42]
for (const layerId of goldenLayerIds) {
  const actual = document.renderRawBitmap(layerId)
  const goldenPath = resolve('assets/golden', `layer-${String(layerId).padStart(3, '0')}.png`)
  const expected = decodePng(await readFile(goldenPath))
  assert.equal(actual.width, expected.width, `圖層 ${layerId} 寬度不符`)
  assert.equal(actual.height, expected.height, `圖層 ${layerId} 高度不符`)
  let differentPixels = 0
  for (let index = 0; index < actual.data.length; index += 4) {
    if (
      actual.data[index] !== expected.data[index] ||
      actual.data[index + 1] !== expected.data[index + 1] ||
      actual.data[index + 2] !== expected.data[index + 2] ||
      actual.data[index + 3] !== expected.data[index + 3]
    )
      differentPixels += 1
  }
  console.log(`圖層 ${layerId}：${differentPixels === 0 ? '相同' : `不同像素 ${differentPixels}`}`)
  assert.equal(differentPixels, 0, `圖層 ${layerId} 與黃金圖不同`)
}

const rows: { cel: string; nonTransparent: number; size: string }[] = []
for (const cel of animationFolder.children) {
  const bitmap = document.renderNode(cel.id)
  let nonTransparent = 0
  for (let index = 3; index < bitmap.data.length; index += 4)
    if (bitmap.data[index] !== 0) nonTransparent += 1
  assert(nonTransparent > 0, `cel ${cel.name} 的合成結果全透明`)
  const pixels = bitmap.data.buffer.slice(
    bitmap.data.byteOffset,
    bitmap.data.byteOffset + bitmap.data.byteLength,
  ) as ArrayBuffer
  const png = UPNG.encode([pixels], bitmap.width, bitmap.height, 0)
  await writeFile(resolve('out/verify', `cel-${cel.name}.png`), Buffer.from(png))
  rows.push({ cel: cel.name, nonTransparent, size: `${bitmap.width}×${bitmap.height}` })
}
const visibilityCel = animationFolder.children[0]!
const hidden = document.renderNode(
  visibilityCel.id,
  new Map(visibilityCel.children.map((child) => [child.id, false])),
)
assert(
  hidden.data.every((value) => value === 0),
  '關閉 cel 內所有圖層後，合成結果必須全透明',
)

const cel4 = animationFolder.children.find((layer) => layer.name === '4')
assert(cel4, '找不到 cel 4')
const canvas = document.renderNode(cel4.id)
const expectedCanvas = decodePng(await readFile(resolve('assets/golden/canvas-preview.png')))
assert.equal(canvas.width, expectedCanvas.width, '畫布縮圖寬度不符')
assert.equal(canvas.height, expectedCanvas.height, '畫布縮圖高度不符')
const diff = new Uint8ClampedArray(canvas.data)
let comparedPixels = 0
let differentPixels = 0
for (let index = 0; index < canvas.data.length; index += 4) {
  if (expectedCanvas.data[index + 3] <= 16) continue
  comparedPixels += 1
  const different =
    Math.abs(canvas.data[index] - expectedCanvas.data[index]) > 8 ||
    Math.abs(canvas.data[index + 1] - expectedCanvas.data[index + 1]) > 8 ||
    Math.abs(canvas.data[index + 2] - expectedCanvas.data[index + 2]) > 8
  if (different) {
    differentPixels += 1
    diff[index] = 255
    diff[index + 1] = 0
    diff[index + 2] = 0
    diff[index + 3] = 255
  }
}
assert(comparedPixels > 0, '畫布縮圖沒有 alpha > 16 的像素可供比對')
const differenceRatio = differentPixels / comparedPixels
console.log(
  `畫布縮圖差異比例：${(differenceRatio * 100).toFixed(3)}% (${differentPixels}/${comparedPixels})`,
)
const diffPng = UPNG.encode([arrayBuffer(diff)], canvas.width, canvas.height, 0)
await writeFile(resolve('out/verify/diff-canvas.png'), Buffer.from(diffPng))
assert(
  differenceRatio < 0.02,
  `畫布縮圖差異比例 ${(differenceRatio * 100).toFixed(3)}%，必須小於 2%`,
)

console.table(rows)
console.log('CLIP 解析驗證通過')
