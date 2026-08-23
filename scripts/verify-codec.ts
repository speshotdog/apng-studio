import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { encodeApng, planApng, verifyApng, type ApngFrame } from '../src/codec/apng.js'
import { encodeGif } from '../src/codec/gif.js'
import { validateForLine } from '../src/codec/line.js'
import { planFromSlots } from '../src/renderer/plan.js'
import { useStore } from '../src/renderer/state/store.js'

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
  validateForLine({ width: 320, height: 270, plan: identicalPlan, numPlays: 1 }).some(
    (issue) => issue.level === 'error' && issue.message.includes('完全相同'),
  ),
)

const gif = encodeGif(frames, width, height, { numPlays: 4, maxColors: 256 })
assert.equal(new TextDecoder().decode(gif.bytes.subarray(0, 6)), 'GIF89a')
assert(gif.bytes.length > 0)

await mkdir('out/verify', { recursive: true })
await writeFile('out/verify/test-merged.png', merged)
await writeFile('out/verify/test-nomerge.png', noMerge)
console.log('Codec verification passed')
