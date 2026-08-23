import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { encodeApng, planApng, verifyApng, type ApngFrame } from '../src/codec/apng.js'
import { encodeGif } from '../src/codec/gif.js'
import { EXPORT_TARGETS, validateForLine } from '../src/codec/line.js'
import { planFromSlots } from '../src/renderer/plan.js'
import { newTrack, useStore } from '../src/renderer/state/store.js'
import { autoFixForLine } from '../src/codec/autofix.js'
import { uploadToGiphy } from '../src/main/giphy.js'
import { distributeDelays, frameDelays } from '../src/codec/timing.js'

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
const oneTrack = (layerId: number | null) => [{ ...newTrack('t', 1), slots: [{ layerId }] }]
useStore.setState({ tracks: oneTrack(5), activeTrack: 0 })
assert.equal(useStore.getState().resolveSlot(3), 5)
useStore.setState({ tracks: oneTrack(null), activeTrack: 0 })
assert.equal(useStore.getState().resolveSlot(3), null)

// 減少格數後再加回來，被切掉的內容要原封不動回來（避免手滑調低格數就白做）。
useStore.setState({
  tracks: [{ ...newTrack('t', 4), slots: [1, 2, 3, 4].map((layerId) => ({ layerId })) }],
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
    resolvedIds: ids,
    fps: 20,
    playCount: 1,
    exportWidth: 360,
    exportHeight: 360,
    format: 'apng',
  })
const fixedFour = fix([1, 2, 3, 4])
assert.deepEqual(
  fixedFour.slots.map(({ layerId }) => layerId),
  [1, 2, 3, 4, 3, 2],
)
assert.deepEqual([fixedFour.exportWidth, fixedFour.exportHeight], [270, 270])
assert.equal(fixedFour.fps, 6)
assert.equal(fixedFour.playCount, 4)
assert.deepEqual(fixedFour.unresolved, [])
assert.deepEqual(
  fix([1, 2]).slots.map(({ layerId }) => layerId),
  [1, 2, 1, 2, 1, 2],
)
// 補幀出來的東西必須直接通過 LINE 規格檢查，這是這個功能存在的理由。
for (const ids of [
  [1, 2],
  [1, 2, 3],
  [1, 2, 3, 4],
  [1, 1, 2, 2, 3, 3],
  [1, 2, 3, 4, 5, 6, 7],
]) {
  const fixed = fix(ids)
  const plan = planFromSlots(
    fixed.slots.map(({ layerId }) => layerId),
    fixed.fps,
    true,
  )
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
assert.equal(fixedOne.slots.length, 1)
assert(fixedOne.unresolved.some((message) => message.includes('只有一種畫面')))
assert.equal(fix(Array.from({ length: 20 }, (_, index) => index)).slots.length, 20)
const fixedLong = fix(Array.from({ length: 26 }, (_, index) => index))
assert.equal(fixedLong.slots.length, 20)
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
  resolvedIds: Array.from({ length: 72 }, (_, layerId) => layerId),
  fps: 60,
  playCount: 0,
  exportWidth: 112,
  exportHeight: 112,
  format: 'gif',
})
assert.deepEqual([twitchFix.slots.length, twitchFix.fps], [60, 30])

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

const gif = encodeGif(frames, width, height, { numPlays: 4, maxColors: 256 })
assert.equal(new TextDecoder().decode(gif.bytes.subarray(0, 6)), 'GIF89a')
assert(gif.bytes.length > 0)

await mkdir('out/verify', { recursive: true })
await writeFile('out/verify/test-merged.png', merged)
await writeFile('out/verify/test-nomerge.png', noMerge)
console.log('Codec verification passed')
