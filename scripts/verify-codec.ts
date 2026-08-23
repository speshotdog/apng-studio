import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { encodeApng, planApng, verifyApng, type ApngFrame } from '../src/codec/apng.js'
import { encodeGif } from '../src/codec/gif.js'
import { validateForLine } from '../src/codec/line.js'
import { planFromSlots } from '../src/renderer/plan.js'
import { useStore } from '../src/renderer/state/store.js'
import { autoFixForLine } from '../src/codec/autofix.js'
import { uploadToGiphy } from '../src/main/giphy.js'

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
useStore.setState({ slots: [{ layerId: 5 }] })
assert.equal(useStore.getState().resolveSlot(3), 5)
useStore.setState({ slots: [{ layerId: null }] })
assert.equal(useStore.getState().resolveSlot(3), null)

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
    slots: ids.map((layerId) => ({ layerId })),
    fps: 20,
    playCount: 1,
    exportWidth: 360,
    exportHeight: 360,
    format: 'apng',
    identicalToPrev: ids.map((id, index) => index > 0 && id === ids[index - 1]),
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
  [1, 2, 1, 2, 1],
)
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
