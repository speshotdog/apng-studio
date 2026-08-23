import type { ApngFrame, ApngOptions, ApngPlan } from '../codec/apng.js'
import { frameDelays } from '../codec/timing.js'
function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
export function planFrames(frames: ApngFrame[], options: ApngOptions): ApngPlan {
  const planned: ApngPlan['frames'] = []
  frames.forEach((frame, index) => {
    const previous = frames[index - 1]
    if (options.mergeIdentical && previous && equal(previous.rgba, frame.rgba)) {
      const target = planned[planned.length - 1]!
      target.sourceIndices.push(index)
      target.delayMs += frame.delayMs
    } else planned.push({ sourceIndices: [index], delayMs: frame.delayMs })
  })
  return {
    frames: planned,
    timelineFrameCount: frames.length,
    actualFrameCount: planned.length,
    totalDurationMs: frames.reduce((sum, frame) => sum + frame.delayMs, 0),
    allIdentical: frames.length > 0 && frames.every((frame) => equal(frame.rgba, frames[0]!.rgba)),
    firstFrameRgba: frames[0]?.rgba,
  }
}
/** 影格識別鍵可以是圖層 id，也可以是多軌合成後的組合鍵；只比對是否相同。 */
export function planFromSlots(
  resolvedIds: Array<string | number | null>,
  fps: number,
  mergeIdentical: boolean,
): ApngPlan {
  const delays = resolvedIds.length ? frameDelays(resolvedIds.length, fps) : []
  const frames = resolvedIds.map((id, index) => ({ id, delayMs: delays[index]! }))
  const planned: ApngPlan['frames'] = []
  frames.forEach((frame, index) => {
    const previous = frames[index - 1]
    if (mergeIdentical && previous && previous.id === frame.id) {
      planned[planned.length - 1]!.sourceIndices.push(index)
      planned[planned.length - 1]!.delayMs += frame.delayMs
    } else planned.push({ sourceIndices: [index], delayMs: frame.delayMs })
  })
  return {
    frames: planned,
    timelineFrameCount: frames.length,
    actualFrameCount: planned.length,
    totalDurationMs: frames.reduce((sum, frame) => sum + frame.delayMs, 0),
    allIdentical: frames.length > 0 && frames.every((frame) => frame.id === frames[0]!.id),
  }
}
