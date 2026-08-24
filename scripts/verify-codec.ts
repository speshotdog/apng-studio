import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { encodeApng, planApng, verifyApng, type ApngFrame } from '../src/codec/apng.js'
import { encodeGif } from '../src/codec/gif.js'
import { EXPORT_TARGETS, validateForLine } from '../src/codec/line.js'
import { planFromSlots } from '../src/renderer/plan.js'
import { newTrack, runtimeDocument, useStore } from '../src/renderer/state/store.js'
import type { EditorDocument } from '../src/project/types.js'
import { autoFixForLine } from '../src/codec/autofix.js'
import { uploadToGiphy } from '../src/main/giphy.js'
import { distributeDelays, frameDelays, mergeAdjacentIdenticalFrames } from '../src/codec/timing.js'

// —— 影格延遲：LINE 會把 fcTL 加總後要求剛好 1/2/3/4 秒 ——
// 每一格都必須是 10 毫秒的整數倍，總和必須精確，否則 LINE 會回
// 「播放時間請設定為1秒、2秒、3秒或4秒」。
for (const [count, fps] of [
  [5, 5],
  [6, 6],
  [8, 8],
  [12, 6],
  [18, 6],
  [20, 5],
  [7, 7],
] as Array<[number, number]>) {
  const delays = frameDelays(count, fps)
  assert.equal(delays.length, count)
  assert(
    delays.every((delay) => delay % 10 === 0),
    `${count}@${fps} 有非 10ms 整數倍的延遲`,
  )
  assert.equal(
    delays.reduce((sum, delay) => sum + delay, 0),
    (count / fps) * 1000,
    `${count}@${fps} 總長度不精確`,
  )
}
assert.deepEqual(distributeDelays(1000, 6), [160, 170, 170, 160, 170, 170])
assert.equal(
  distributeDelays(1000, 6).reduce((a, b) => a + b, 0),
  1000,
)

const width = 64
const height = 64
const solid = (r: number, g: number, b: number): Uint8Array => {
  const rgba = new Uint8Array(width * height * 4)
  for (let i = 0; i < rgba.length; i += 4) rgba.set([r, g, b, i === 3 ? 0 : 255], i)
  return rgba
}
const colors = [
  [255, 0, 0],
  [255, 128, 0],
  [0, 255, 0],
  [0, 255, 0],
  [0, 255, 0],
  [0, 128, 255],
  [0, 0, 255],
  [128, 0, 255],
]
const frames: ApngFrame[] = colors.map(([r, g, b]) => ({ rgba: solid(r!, g!, b!), delayMs: 50 }))

const mergedAdjacentFrames = mergeAdjacentIdenticalFrames(frames)
assert.equal(mergedAdjacentFrames.length, 6)
assert.equal(mergedAdjacentFrames[2]!.delayMs, 150)
assert.equal(frames[2]!.delayMs, 50, '合併不得修改原始影格')

const mergedPlan = planApng(frames, { numPlays: 4, mergeIdentical: true })
assert.equal(mergedPlan.actualFrameCount, 6)
assert.equal(mergedPlan.frames[2]!.delayMs, 150)
assert.equal(mergedPlan.totalDurationMs, 400)
const noMergePlan = planApng(frames, { numPlays: 4, mergeIdentical: false })
assert.equal(noMergePlan.actualFrameCount, 8)
const slotPlan = planFromSlots([1, 2, 2, 2, 3], 20, true)
assert.equal(slotPlan.actualFrameCount, 3)
assert.equal(slotPlan.frames[1]!.delayMs, 150)
assert.equal(slotPlan.totalDurationMs, 250)
const sourceId = 'source-a'
const oneTrack = (layerId: number | null) => [
  { ...newTrack('t', 1), slots: [{ sourceId: layerId === null ? null : sourceId, layerId }] },
]
useStore.setState({
  sources: [{ id: sourceId, path: 'a.clip', name: 'a.clip' }],
  tracks: oneTrack(5),
  activeTrack: 0,
})
assert.deepEqual(useStore.getState().resolveSlot(3), { sourceId, layerId: 5 })
useStore.setState({ tracks: oneTrack(null), activeTrack: 0 })
assert.equal(useStore.getState().resolveSlot(3), null)

// 減少格數後再加回來，被切掉的內容要原封不動回來（避免手滑調低格數就白做）。
useStore.setState({
  tracks: [
    {
      ...newTrack('t', 4),
      slots: [1, 2, 3, 4].map((layerId) => ({ sourceId, layerId })),
    },
  ],
  activeTrack: 0,
  trimmed: {},
})
useStore.getState().resizeFrames(2)
assert.equal(useStore.getState().tracks[0]!.slots.length, 2)
useStore.getState().resizeFrames(4)
assert.deepEqual(
  useStore.getState().tracks[0]!.slots.map(({ layerId }) => layerId),
  [1, 2, 3, 4],
)
useStore.getState().undo()
assert.equal(useStore.getState().tracks[0]!.slots.length, 2)

// 每份文件有獨立工作副本與歷史；切換本身不應新增 revision 或污染另一份。
const editorDocument = (id: string, fps: number): EditorDocument => ({
  tracks: [{ ...newTrack(id, 1), id }],
  visibility: [],
  fps,
  playCount: 1,
  format: 'apng',
  lineTarget: 'sticker',
  exportWidth: 270,
  exportHeight: 270,
  lockAspect: true,
  scaleMode: 'smooth',
  mergeIdentical: true,
  staticFrame: 0,
  gifColors: 256,
  gifMatte: null,
  activeSourceId: sourceId,
  contentRevision: 0,
})
const documentA = runtimeDocument(editorDocument('document-a', 12))
const documentB = runtimeDocument(editorDocument('document-b', 24))
useStore.setState({
  documents: { a: documentA, b: documentB },
  activeDocumentId: 'a',
  standaloneDocumentId: 'a',
  tracks: documentA.tracks,
  visibility: new Map(),
  fps: documentA.fps,
  past: [],
  future: [],
  contentRevision: 0,
  projectRevision: 0,
  savedRevision: 0,
  dirty: false,
})
useStore.getState().commit()
useStore.getState().set({ fps: 13 })
assert.equal(useStore.getState().projectRevision, 1)
useStore.getState().switchDocument('b')
assert.equal(useStore.getState().fps, 24)
assert.equal(useStore.getState().past.length, 0)
assert.equal(useStore.getState().projectRevision, 1, '切換文件不能算語意編輯')
useStore.getState().commit()
useStore.getState().set({ fps: 25 })
useStore.getState().switchDocument('a')
assert.equal(useStore.getState().fps, 13)
assert.equal(useStore.getState().past.length, 1)
useStore.getState().undo()
assert.equal(useStore.getState().fps, 12)
assert.equal(useStore.getState().contentRevision, 2, 'undo 也要遞增 contentRevision')
useStore.getState().switchDocument('b')
assert.equal(useStore.getState().fps, 25)
useStore.getState().undo()
assert.equal(useStore.getState().fps, 24)
const beforeMatteRevision = useStore.getState().projectRevision
const beforeMatteContentRevision = useStore.getState().contentRevision
useStore.getState().set({ gifMatte: '#1e1e1e' })
assert.equal(useStore.getState().projectRevision, beforeMatteRevision + 1)
assert.equal(useStore.getState().contentRevision, beforeMatteContentRevision + 1)
assert.equal(useStore.getState().dirty, true, '變更 gifMatte 必須標記文件為未儲存')

const merged = encodeApng(frames, width, height, { numPlays: 4, mergeIdentical: true })
const noMerge = encodeApng(frames, width, height, { numPlays: 4, mergeIdentical: false })
const mergedInfo = verifyApng(merged)
const noMergeInfo = verifyApng(noMerge)
assert.equal(mergedInfo.numFrames, mergedPlan.actualFrameCount)
assert.deepEqual(
  mergedInfo.delaysMs,
  mergedPlan.frames.map((frame) => frame.delayMs),
)
assert.equal(mergedInfo.numPlays, 4)
assert.equal(noMergeInfo.numFrames, noMergePlan.actualFrameCount)
assert.deepEqual(
  noMergeInfo.delaysMs,
  noMergePlan.frames.map((frame) => frame.delayMs),
)

const identical = Array.from({ length: 5 }, (): ApngFrame => ({
  rgba: solid(1, 2, 3),
  delayMs: 200,
}))
const identicalPlan = planApng(identical, { numPlays: 1, mergeIdentical: true })
assert.equal(identicalPlan.allIdentical, true)
assert(
  validateForLine({
    target: 'sticker',
    width: 320,
    height: 270,
    plan: identicalPlan,
    numPlays: 1,
    format: 'apng',
  }).some((issue) => issue.level === 'error' && issue.message.includes('完全相同')),
)

const compliantPlan = planApng(
  frames.slice(0, 6).map((frame, index) => ({ ...frame, delayMs: index === 5 ? 165 : 167 })),
  { numPlays: 4, mergeIdentical: false },
)
const lineErrors = (
  target: 'sticker' | 'emoji' | 'main',
  width: number,
  height: number,
  byteLength?: number,
) =>
  validateForLine({
    target,
    width,
    height,
    plan: compliantPlan,
    numPlays: 4,
    format: 'apng',
    byteLength,
  }).filter((issue) => issue.level === 'error')
assert(lineErrors('emoji', 270, 270).some((issue) => issue.message.includes('180×180')))
assert.equal(lineErrors('emoji', 180, 180, 250 * 1024).length, 0)
assert(lineErrors('emoji', 180, 180, 400 * 1024).some((issue) => issue.message.includes('300')))
assert.equal(lineErrors('main', 240, 240).length, 0)
assert.equal(lineErrors('sticker', 320, 270).length, 0)
assert(lineErrors('sticker', 200, 180).some((issue) => issue.message.includes('270')))
assert.equal(
  validateForLine({
    target: 'emoji',
    width: 1,
    height: 1,
    plan: compliantPlan,
    numPlays: 0,
    format: 'gif',
  })[0]?.level,
  'info',
)

const fix = (ids: number[], target: 'sticker' | 'emoji' | 'main' = 'sticker') =>
  autoFixForLine({
    target,
    canvasWidth: 360,
    canvasHeight: 360,
    frameKeys: ids.map(String),
    fps: 20,
    playCount: 1,
    exportWidth: 360,
    exportHeight: 360,
    format: 'apng',
  })
/** 把 autofix 回傳的順序換算回圖層 id，方便比對。 */
const applied = (ids: number[], order: number[]): number[] => order.map((frame) => ids[frame]!)
const fixedFour = fix([1, 2, 3, 4])
assert.deepEqual(applied([1, 2, 3, 4], fixedFour.order), [1, 2, 3, 4, 3, 2])
assert.deepEqual([fixedFour.exportWidth, fixedFour.exportHeight], [270, 270])
assert.equal(fixedFour.fps, 6)
assert.equal(fixedFour.playCount, 4)
assert.deepEqual(fixedFour.unresolved, [])
assert.deepEqual(applied([1, 2], fix([1, 2]).order), [1, 2, 1, 2, 1, 2])
// 補幀出來的東西必須直接通過 LINE 規格檢查，這是這個功能存在的理由。
for (const ids of [
  [1, 2],
  [1, 2, 3],
  [1, 2, 3, 4],
  [1, 1, 2, 2, 3, 3],
  [1, 2, 3, 4, 5, 6, 7],
]) {
  const fixed = fix(ids)
  const plan = planFromSlots(applied(ids, fixed.order), fixed.fps, true)
  const seconds = plan.totalDurationMs / 1000
  assert(
    plan.actualFrameCount >= 5 && plan.actualFrameCount <= 20,
    `${ids} 補完只有 ${plan.actualFrameCount} 實幀`,
  )
  assert([1, 2, 3, 4].includes(seconds), `${ids} 補完長度是 ${seconds} 秒`)
  assert(seconds * fixed.playCount <= 4, `${ids} 補完總播放超過 4 秒`)
  assert(
    plan.frames.every((frame) => frame.delayMs % 10 === 0),
    `${ids} 補完有非 10ms 整數倍的延遲`,
  )
  assert.equal(
    validateForLine({
      target: 'sticker',
      width: fixed.exportWidth,
      height: fixed.exportHeight,
      plan,
      numPlays: fixed.playCount,
      format: fixed.format,
    }).filter(({ level }) => level === 'error').length,
    0,
    `${ids} 補完後仍有 LINE 規格錯誤`,
  )
}
const fixedOne = fix([1])
assert.equal(fixedOne.order.length, 1)
assert(fixedOne.unresolved.some((message) => message.includes('只有一種畫面')))
assert.equal(fix(Array.from({ length: 20 }, (_, index) => index)).order.length, 20)
const fixedLong = fix(Array.from({ length: 26 }, (_, index) => index))
assert.equal(fixedLong.order.length, 20)
assert(fixedLong.changes.some((change) => change.to.includes('裁切')))
assert.deepEqual(
  [fix([1, 2, 3, 4, 5], 'emoji').exportWidth, fix([1, 2, 3, 4, 5], 'emoji').exportHeight],
  [180, 180],
)
assert.deepEqual(
  [fix([1, 2, 3, 4, 5], 'main').exportWidth, fix([1, 2, 3, 4, 5], 'main').exportHeight],
  [240, 240],
)

const staticIssues = (width: number, height: number, packCount: number) =>
  validateForLine({
    target: 'staticSticker',
    width,
    height,
    plan: compliantPlan,
    numPlays: 1,
    format: 'apng',
    packCount,
  })
assert.equal(staticIssues(370, 320, 32).filter(({ level }) => level === 'error').length, 0)
assert(
  staticIssues(380, 320, 32).some(
    ({ level, message }) => level === 'error' && message.includes('尺寸'),
  ),
)
assert(staticIssues(371, 320, 32).some(({ level }) => level === 'warning'))
assert(
  staticIssues(370, 320, 30).some(
    ({ level, message }) => level === 'error' && message.includes('張數'),
  ),
)

const plurkIssues = (width: number, height: number, format: 'apng' | 'gif', bytes: number) =>
  validateForLine({
    target: 'plurkEmoticon',
    width,
    height,
    plan: compliantPlan,
    numPlays: 0,
    format,
    byteLength: bytes,
  })
assert.equal(
  plurkIssues(48, 48, 'gif', 100 * 1024).filter(({ level }) => level === 'error').length,
  0,
)
assert(plurkIssues(64, 64, 'gif', 100).some(({ message }) => message.includes('48')))
assert(plurkIssues(48, 48, 'gif', 300 * 1024).some(({ message }) => message.includes('256')))
assert(plurkIssues(48, 48, 'apng', 100).some(({ message }) => message.includes('GIF')))
assert.equal(plurkIssues(40, 48, 'gif', 100).filter(({ level }) => level === 'error').length, 0)

const targetIssues = (
  target: 'twitchEmoteAnimated' | 'twitchEmoteStatic' | 'youtubeEmoji',
  frameCount: number,
  fps: number,
  format: 'apng' | 'gif' | 'png',
  bytes: number,
  size = 48,
) =>
  validateForLine({
    target,
    width: size,
    height: size,
    plan: planFromSlots(
      Array.from({ length: frameCount }, (_, index) => index),
      fps,
      false,
    ),
    numPlays: target === 'twitchEmoteAnimated' ? 0 : 1,
    format,
    byteLength: bytes,
  })
const errorsOf = (issues: ReturnType<typeof targetIssues>) =>
  issues.filter(({ level }) => level === 'error')
assert.equal(errorsOf(targetIssues('twitchEmoteAnimated', 60, 30, 'gif', 1024 * 1024)).length, 0)
assert(
  targetIssues('twitchEmoteAnimated', 72, 30, 'gif', 100).some(({ message }) =>
    message.includes('60'),
  ),
)
assert(
  targetIssues('twitchEmoteAnimated', 60, 60, 'gif', 100).some(({ message }) =>
    message.includes('30'),
  ),
)
assert(errorsOf(targetIssues('twitchEmoteAnimated', 60, 30, 'gif', 1.2 * 1024 * 1024)).length > 0)
assert.deepEqual(
  EXPORT_TARGETS.twitchEmoteAnimated.multiSize?.map(({ width }) => width),
  [28, 56, 112],
)
assert(errorsOf(targetIssues('twitchEmoteStatic', 1, 1, 'png', 30 * 1024)).length > 0)
assert.equal(errorsOf(targetIssues('twitchEmoteStatic', 1, 1, 'png', 20 * 1024)).length, 0)
assert.equal(errorsOf(targetIssues('youtubeEmoji', 1, 1, 'png', 500 * 1024)).length, 0)
assert(
  targetIssues('youtubeEmoji', 1, 1, 'apng', 100).some(({ message }) => message.includes('靜態')),
)
assert(
  targetIssues('youtubeEmoji', 1, 1, 'png', 100, 600).some(({ message }) =>
    message.includes('480'),
  ),
)
assert(errorsOf(targetIssues('youtubeEmoji', 1, 1, 'png', 100, 32)).length > 0)
const twitchFix = autoFixForLine({
  target: 'twitchEmoteAnimated',
  canvasWidth: 360,
  canvasHeight: 360,
  frameKeys: Array.from({ length: 72 }, (_, index) => String(index)),
  fps: 60,
  playCount: 0,
  exportWidth: 112,
  exportHeight: 112,
  format: 'gif',
})
assert.deepEqual([twitchFix.order.length, twitchFix.fps], [60, 30])

const fakeGif = new Uint8Array([71, 73, 70])
let calls = 0
const successFetch: typeof fetch = async () => {
  calls++
  return new Response(
    JSON.stringify(
      calls === 1
        ? { data: { id: 'abc' } }
        : {
            data: {
              url: 'https://giphy.com/gifs/abc',
              images: { original: { url: 'https://media.giphy.com/media/abc/giphy.gif' } },
            },
          },
    ),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}
const uploaded = await uploadToGiphy(fakeGif, 'tag', 'fake-key', '', successFetch)
assert.equal(uploaded.ok, true)
assert.equal(uploaded.id, 'abc')
const limited = await uploadToGiphy(
  fakeGif,
  '',
  'fake-key',
  '',
  async () => new Response(JSON.stringify({ meta: { msg: 'rate limit' } }), { status: 429 }),
)
assert.match(limited.error ?? '', /每天上限 10 次/)
const timeoutFetch: typeof fetch = (_input, init) =>
  new Promise((_resolve, reject) =>
    init?.signal?.addEventListener('abort', () =>
      reject(new DOMException('aborted', 'AbortError')),
    ),
  )
const timedOut = await uploadToGiphy(fakeGif, '', 'fake-key', '', timeoutFetch, 1)
assert.match(timedOut.error ?? '', /逾時/)

function decodeGifLzw(data: Uint8Array, minimumCodeSize: number): number[] {
  const clearCode = 1 << minimumCodeSize
  const endCode = clearCode + 1
  let codeSize = minimumCodeSize + 1
  let bitOffset = 0
  let dictionary: number[][] = []
  const reset = (): void => {
    dictionary = Array.from({ length: clearCode }, (_, index) => [index])
    dictionary.push([], [])
    codeSize = minimumCodeSize + 1
  }
  const readCode = (): number => {
    let code = 0
    for (let bit = 0; bit < codeSize; bit++) {
      const byte = data[bitOffset >> 3]
      if (byte === undefined) throw new Error('GIF LZW 資料提前結束')
      code |= ((byte >> (bitOffset & 7)) & 1) << bit
      bitOffset++
    }
    return code
  }

  reset()
  const output: number[] = []
  let previous: number[] | null = null
  while (bitOffset + codeSize <= data.length * 8) {
    const code = readCode()
    if (code === clearCode) {
      reset()
      previous = null
      continue
    }
    if (code === endCode) break
    const entry: number[] | null =
      code < dictionary.length
        ? dictionary[code]!
        : code === dictionary.length && previous
          ? [...previous, previous[0]!]
          : null
    if (!entry?.length) throw new Error(`GIF LZW 代碼 ${code} 無法解析`)
    output.push(...entry)
    if (previous) {
      dictionary.push([...previous, entry[0]!])
      if (dictionary.length === 1 << codeSize && codeSize < 12) codeSize++
    }
    previous = entry
  }
  return output
}

function inspectGifFrame(bytes: Uint8Array): {
  palette: number[][]
  indexes: number[]
  transparentIndexes: number[]
} {
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 6)), 'GIF89a')
  const logicalPacked = bytes[10]!
  assert(logicalPacked & 0x80, '測試 GIF 必須有全域調色盤')
  const globalColors = 1 << ((logicalPacked & 0x07) + 1)
  let offset = 13
  const globalPalette = Array.from({ length: globalColors }, () => {
    const color = [bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!]
    offset += 3
    return color
  })
  const transparentIndexes: number[] = []
  while (offset < bytes.length) {
    const marker = bytes[offset++]!
    if (marker === 0x3b) break
    if (marker === 0x21) {
      const label = bytes[offset++]!
      if (label === 0xf9) {
        assert.equal(bytes[offset++]!, 4)
        const packed = bytes[offset]!
        if (packed & 1) transparentIndexes.push(bytes[offset + 3]!)
        offset += 4
        assert.equal(bytes[offset++]!, 0)
      } else {
        while (true) {
          const blockLength = bytes[offset++]!
          if (blockLength === 0) break
          offset += blockLength
        }
      }
      continue
    }
    if (marker !== 0x2c) throw new Error(`未知 GIF 區塊 0x${marker.toString(16)}`)
    const imagePacked = bytes[offset + 8]!
    offset += 9
    let palette = globalPalette
    if (imagePacked & 0x80) {
      const localColors = 1 << ((imagePacked & 0x07) + 1)
      palette = Array.from({ length: localColors }, () => {
        const color = [bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!]
        offset += 3
        return color
      })
    }
    const minimumCodeSize = bytes[offset++]!
    const chunks: Uint8Array[] = []
    let total = 0
    while (true) {
      const blockLength = bytes[offset++]!
      if (blockLength === 0) break
      const chunk = bytes.subarray(offset, offset + blockLength)
      chunks.push(chunk)
      total += chunk.length
      offset += blockLength
    }
    const compressed = new Uint8Array(total)
    let target = 0
    for (const chunk of chunks) {
      compressed.set(chunk, target)
      target += chunk.length
    }
    return { palette, indexes: decodeGifLzw(compressed, minimumCodeSize), transparentIndexes }
  }
  throw new Error('GIF 沒有影像區塊')
}

const edgeFrame: ApngFrame = {
  rgba: new Uint8Array([255, 255, 255, 128, 12, 34, 56, 10]),
  delayMs: 100,
}
const plainEdge = inspectGifFrame(
  encodeGif([edgeFrame], 2, 1, { numPlays: 1, maxColors: 256, matte: null }).bytes,
)
const darkEdge = inspectGifFrame(
  encodeGif([edgeFrame], 2, 1, {
    numPlays: 1,
    maxColors: 256,
    matte: { r: 30, g: 30, b: 30 },
  }).bytes,
)
const decodedPixel = (
  inspected: ReturnType<typeof inspectGifFrame>,
  pixel: number,
): [number, number, number, number] => {
  const index = inspected.indexes[pixel]!
  if (index === inspected.transparentIndexes[0]) return [0, 0, 0, 0]
  const color = inspected.palette[index]!
  return [color[0]!, color[1]!, color[2]!, 255]
}
assert.deepEqual(decodedPixel(plainEdge, 0), [255, 255, 255, 255])
assert.deepEqual(decodedPixel(plainEdge, 1), [0, 0, 0, 0])
assert.deepEqual(decodedPixel(darkEdge, 0), [143, 143, 143, 255])
assert.deepEqual(decodedPixel(darkEdge, 1), [0, 0, 0, 0])
for (const inspected of [plainEdge, darkEdge]) {
  assert.equal(inspected.transparentIndexes.length, 1, '每幀只應宣告一個透明索引')
  const transparentIndex = inspected.transparentIndexes[0]!
  assert(inspected.palette[transparentIndex], '透明索引必須存在於調色盤')
  assert.equal(
    inspected.indexes.filter((index) => index === transparentIndex).length,
    1,
    '只有低 alpha 像素可使用透明索引',
  )
}

const gif = encodeGif(frames, width, height, { numPlays: 4, maxColors: 256 })
assert.equal(new TextDecoder().decode(gif.bytes.subarray(0, 6)), 'GIF89a')
assert(gif.bytes.length > 0)

await mkdir('out/verify', { recursive: true })
await writeFile('out/verify/test-merged.png', merged)
await writeFile('out/verify/test-nomerge.png', noMerge)
console.log('Codec verification passed')
