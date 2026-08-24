import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseClip } from '../src/clip/index.js'
import type { ClipSummary } from '../src/preload/api.js'
import { buildCspTracks } from '../src/renderer/state/store.js'

function expectDeepEqual(label: string, actual: unknown, expected: unknown): void {
  try {
    assert.deepEqual(actual, expected)
  } catch {
    console.error(`${label} 驗證失敗`)
    console.error(`實際值：${JSON.stringify(actual)}`)
    console.error(`期望值：${JSON.stringify(expected)}`)
    throw new Error(`${label} 與期望值不符`)
  }
}

try {
  const sample = await readFile(resolve('assets/samples/09.clip'))
  const document = await parseClip(sample)
  const expected = new Map<string, Array<{ frame: number; celName: string }>>([
    ['資料夾 1', ['1', '2', '3', '4', '5', '6', '1'].map((celName, frame) => ({ frame, celName }))],
    [
      '資料夾 2',
      ['1', '2', '3', '4', '5', '6', '1', '2', '3', '4', '5', '6'].map((celName, frame) => ({
        frame,
        celName,
      })),
    ],
    [
      '資料夾 3',
      ['1', '2', '3', '4', '5', '6', '1', '2', '3', '4', '5', '6'].map((celName, frame) => ({
        frame,
        celName,
      })),
    ],
    [
      '資料夾 4',
      ['1', '2', '3', '4', '5', '6', '1', '2', '3', '4', '5', '6'].map((celName, frame) => ({
        frame,
        celName,
      })),
    ],
  ])

  expectDeepEqual(
    'CSP 時間軌名稱',
    document.cspTimelines.map((timeline) => timeline.animationFolderName),
    [...expected.keys()],
  )
  expectDeepEqual('CSP TimeLine 群組數', document.cspTimelineGroups.length, 1)
  for (const timeline of document.cspTimelines) {
    expectDeepEqual(`${timeline.animationFolderName} frameRate`, timeline.frameRate, 12)
    expectDeepEqual(`${timeline.animationFolderName} frameCount`, timeline.frameCount, 12)
    expectDeepEqual(
      `${timeline.animationFolderName} keys`,
      timeline.keys,
      expected.get(timeline.animationFolderName),
    )
    expectDeepEqual(`${timeline.animationFolderName} warnings`, timeline.warnings, [])
  }

  const folder3 = [...document.flat.values()].find(
    (layer) => layer.isAnimationFolder && layer.name === '資料夾 3',
  )
  expectDeepEqual(
    '資料夾 3 子層',
    folder3?.children.map((layer) => layer.name),
    ['1', '2', '3', '4', '5', '6'],
  )
  const summary: ClipSummary = {
    filePath: resolve('assets/samples/09.clip'),
    canvas: document.canvas,
    timeline: document.timeline,
    tree: document.root,
    cspTimelines: document.cspTimelines,
    cspTimelineGroups: document.cspTimelineGroups,
  }
  const built = buildCspTracks(summary, 'source-09', document.cspTimelineGroups[0]!.tracks)
  expectDeepEqual('CSP 多軌建構器 FPS', built.frameRate, 12)
  expectDeepEqual(
    'CSP 多軌建構器軌道順序',
    built.tracks.map((track) => track.name),
    [...expected.keys()],
  )
  for (const [trackIndex, track] of built.tracks.entries()) {
    const timeline = document.cspTimelineGroups[0]!.tracks[trackIndex]!
    const folder = document.flat.get(timeline.animationFolderId)!
    const layerIds = new Map(folder.children.map((layer) => [layer.name, layer.id]))
    const expectedSlots = Array.from({ length: timeline.frameCount }, () => null as number | null)
    for (const key of timeline.keys) expectedSlots[key.frame] = layerIds.get(key.celName) ?? null
    expectDeepEqual(
      `${track.name} slots`,
      track.slots.map((slot) => slot.layerId),
      expectedSlots,
    )
    expectDeepEqual(
      `${track.name} source ids`,
      track.slots.filter((slot) => slot.layerId !== null).map((slot) => slot.sourceId),
      timeline.keys.map(() => 'source-09'),
    )
  }
  console.log('CSP 時間軸換算驗證通過')
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
