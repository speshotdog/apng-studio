import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { verifyApng } from '../src/codec/apng.js'
import { encodeGif } from '../src/codec/gif.js'
import { registerIpc } from '../src/main/ipc.js'

const projectRoot = resolve(import.meta.dirname, '..')
const outputDir = join(projectRoot, 'out', 'smoke')
let window: BrowserWindow | null = null

interface SmokeSnapshot {
  celNames: string[]
  celIds: number[]
  slots: { layerId: number | null }[]
  inheritedId: number | null
  sourceId: number | null
  timelineFrameCount: number
  actualFrameCount: number
  opaquePixels: number
}

function gifFrameCount(bytes: Uint8Array): number {
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 6)), 'GIF89a')
  let offset = 13
  if (bytes[10]! & 0x80) offset += 3 * 2 ** ((bytes[10]! & 7) + 1)
  let frames = 0
  const skipBlocks = (): void => {
    while (bytes[offset] !== 0) {
      offset += 1 + bytes[offset]!
    }
    offset += 1
  }
  while (offset < bytes.length) {
    const marker = bytes[offset++]
    if (marker === 0x3b) break
    if (marker === 0x21) {
      offset += 1
      skipBlocks()
      continue
    }
    assert.equal(marker, 0x2c, `未知的 GIF block 0x${marker?.toString(16)}`)
    frames += 1
    const packed = bytes[offset + 8]!
    offset += 9
    if (packed & 0x80) offset += 3 * 2 ** ((packed & 7) + 1)
    offset += 1
    skipBlocks()
  }
  return frames
}

async function run(): Promise<void> {
  await mkdir(outputDir, { recursive: true })
  registerIpc(() => window)
  window = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      preload: join(projectRoot, 'out', 'preload', 'index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  await window.loadFile(join(projectRoot, 'out', 'renderer', 'index.html'), {
    query: { smoke: '1' },
  })

  const samplePath = join(projectRoot, 'assets', 'samples', '11.clip')
  await window.webContents.executeJavaScript(`(async () => {
    const smoke = window.__smoke
    if (!smoke) throw new Error('找不到 smoke 測試鉤子')
    await smoke.openClip(${JSON.stringify(samplePath)})
    const cels = smoke.getAnimationCels()
    const positions = [0, 1, 2, 4, 6, 7]
    positions.forEach((slot, index) => smoke.store.getState().setSlot(slot, cels[index].id))
    smoke.store.getState().set({ playhead: 0, selectedSlot: 0, playCount: 2, format: 'apng' })
    await smoke.waitIdle()
  })()`)

  const assertVisibleThumbsLoaded = async (): Promise<void> => {
    const pending = await window!.webContents.executeJavaScript(`[
      ...document.querySelectorAll('.layer-row .thumb[data-thumb-loaded="false"]')
    ].filter((thumb) => { const row = thumb.closest('.layer-row'); const rect = row.getBoundingClientRect(); return rect.bottom > 0 && rect.top < innerHeight }).map((thumb) => thumb.dataset.layerId)`)
    assert.deepEqual(pending, [], `可見圖層縮圖尚未載入：${pending.join(', ')}`)
  }
  await assertVisibleThumbsLoaded()

  // 影格軌縮圖必須縮進格子裡，不能用原生尺寸溢出被裁掉（換成 <canvas> 時踩過一次）
  const slotThumbs = (await window.webContents.executeJavaScript(
    `[...document.querySelectorAll('.slot canvas')].map((canvas) => {
      const box = canvas.getBoundingClientRect()
      const slot = canvas.closest('.slot').getBoundingClientRect()
      return { width: Math.round(box.width), height: Math.round(box.height), slotWidth: Math.round(slot.width), slotHeight: Math.round(slot.height), intrinsic: canvas.width }
    })`,
  )) as { width: number; height: number; slotWidth: number; slotHeight: number }[]
  assert.ok(slotThumbs.length > 0, '影格軌必須有縮圖')
  for (const thumb of slotThumbs) {
    assert.ok(
      thumb.width <= thumb.slotWidth && thumb.height <= thumb.slotHeight,
      `影格軌縮圖溢出格子：${thumb.width}×${thumb.height} > ${thumb.slotWidth}×${thumb.slotHeight}`,
    )
  }

  const mainPng = (await window.webContents.capturePage()).toPNG()
  await writeFile(join(outputDir, 'ui-main.png'), mainPng)
  const snapshot = (await window.webContents.executeJavaScript(`(() => {
    const smoke = window.__smoke
    const state = smoke.store.getState()
    const cels = smoke.getAnimationCels()
    const canvas = document.querySelector('.stage canvas')
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    const stats = [...document.querySelectorAll('.stats b')].map((node) => node.textContent)
    let opaquePixels = 0
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) opaquePixels++
    return { celNames: cels.map((cel) => cel.name), celIds: cels.map((cel) => cel.id), slots: state.slots, inheritedId: state.resolveSlot(3), sourceId: state.slots[2].layerId, timelineFrameCount: Number(stats[0]), actualFrameCount: Number(stats[1]), opaquePixels }
  })()`)) as SmokeSnapshot

  assert.deepEqual(snapshot.celNames, ['1', '1a', '1b', '2', '3', '4'])
  assert.equal(snapshot.slots.length, 8)
  assert.equal(snapshot.slots[3]?.layerId, null)
  assert.equal(snapshot.slots[5]?.layerId, null)
  assert.equal(snapshot.inheritedId, snapshot.sourceId)
  assert.equal(snapshot.actualFrameCount, 6)
  assert.equal(snapshot.timelineFrameCount, 8)
  assert.ok(snapshot.opaquePixels > 0, '預覽 canvas 不可全透明')
  const controls = await window.webContents.executeJavaScript(`(async () => {
    const store = window.__smoke.store
    const beforePlayCount = store.getState().playCount
    const originalSlots = store.getState().slots
    document.querySelector('.transport button[title="循環預覽"]').click()
    const loop = store.getState().previewLoop
    store.getState().set({ selectedSlot: 7, playhead: 7 })
    await window.__smoke.waitIdle()
    document.querySelectorAll('.timeline-tools button')[1].click()
    const shrunk = store.getState()
    store.getState().set({ slots: originalSlots, selectedSlot: 0, playhead: 0, previewLoop: true })
    return { beforePlayCount, afterPlayCount: store.getState().playCount, loop, selectedSlot: shrunk.selectedSlot, playhead: shrunk.playhead }
  })()`)
  assert.equal(controls.afterPlayCount, controls.beforePlayCount, '預覽循環不可改變匯出播放次數')
  assert.equal(controls.loop, false)
  assert.equal(controls.selectedSlot, 6)
  assert.equal(controls.playhead, 6)

  const visibilityChanged = await window.webContents.executeJavaScript(`(async () => {
    const before = [...document.querySelector('.stage canvas').getContext('2d').getImageData(0, 0, 360, 360).data]
    const id = window.__smoke.store.getState().resolveSlot(0)
    const node = [...document.querySelectorAll('.layer-row')].find((row) => row.querySelector('.thumb')?.dataset.layerId === String(id))
    node.querySelector('input[type=checkbox]').click()
    await window.__smoke.waitIdle()
    const after = [...document.querySelector('.stage canvas').getContext('2d').getImageData(0, 0, 360, 360).data]
    return before.some((value, index) => value !== after[index])
  })()`)
  assert.equal(visibilityChanged, true, '切換圖層可見性必須改變預覽 RGBA')
  await writeFile(
    join(outputDir, 'ui-visibility.png'),
    (await window.webContents.capturePage()).toPNG(),
  )

  const sourcePixels = await window.webContents.executeJavaScript(
    `(async () => { window.__smoke.store.getState().set({ playhead: 2, selectedSlot: 2 }); await window.__smoke.waitIdle(); return [...document.querySelector('.stage canvas').getContext('2d').getImageData(0, 0, 360, 360).data] })()`,
  )
  await window.webContents.executeJavaScript(
    `(async () => { window.__smoke.store.getState().set({ playhead: 3, selectedSlot: 3 }); await window.__smoke.waitIdle() })()`,
  )
  const inheritedPixels = await window.webContents.executeJavaScript(
    `[...document.querySelector('.stage canvas').getContext('2d').getImageData(0, 0, 360, 360).data]`,
  )
  assert.deepEqual(inheritedPixels, sourcePixels, '第 4 格預覽必須與延續來源第 3 格相同')
  const inheritPng = (await window.webContents.capturePage()).toPNG()
  assert.notDeepEqual(inheritPng, mainPng, 'ui-inherit.png 不可與 ui-main.png 相同')
  await writeFile(join(outputDir, 'ui-inherit.png'), inheritPng)

  window.setSize(1024, 640)
  window.webContents.setZoomFactor(0.8)
  await window.webContents.executeJavaScript(`window.__smoke.waitIdle()`)
  await assertVisibleThumbsLoaded()
  const smallLayout = await window.webContents.executeJavaScript(
    `(() => { const button = document.querySelector('.export-button').getBoundingClientRect(); const names = [...document.querySelectorAll('.layer-name')].map((node) => node.textContent); return { button: { top: button.top, bottom: button.bottom }, viewportHeight: innerHeight, names } })()`,
  )
  assert.ok(
    smallLayout.button.top >= 0 && smallLayout.button.bottom <= smallLayout.viewportHeight,
    '1024×640 時匯出按鈕必須完整可見',
  )
  assert.deepEqual(smallLayout.names.slice(0, 3), ['紙張', '圖層 1', '資料夾 1'])
  assert.ok(!smallLayout.names.includes('未命名圖層'), '圖層樹不可渲染未命名的根節點')
  await writeFile(join(outputDir, 'ui-small.png'), (await window.webContents.capturePage()).toPNG())

  const exportPath = join(outputDir, 'export.png')
  const result = await window.webContents.executeJavaScript(
    `window.__smoke.exportTo(${JSON.stringify(exportPath)})`,
  )
  assert.equal(result.ok, true, result.error)
  const info = verifyApng(new Uint8Array(await readFile(exportPath)))
  assert.equal(info.numFrames, 6)
  assert.equal(info.numPlays, 2)
  assert.equal(info.delaysMs.length, 6)

  const gifPath = join(outputDir, 'export.gif')
  const gifResult = await window.webContents.executeJavaScript(
    `(async () => { window.__smoke.store.getState().set({ format: 'gif' }); return window.__smoke.exportTo(${JSON.stringify(gifPath)}) })()`,
  )
  assert.equal(gifResult.ok, true, gifResult.error)
  const gifUi = await window.webContents.executeJavaScript(`({
    frameLabel: [...document.querySelectorAll('.stats span')].map((node) => node.textContent).find((text) => text.includes('GIF')),
    lineWarning: [...document.querySelectorAll('.issues .warning')].some((node) => node.textContent.includes('只接受 APNG')),
    hasDither: document.body.textContent.includes('抖色')
  })`)
  assert.match(gifUi.frameLabel, /實際 GIF 幀數/)
  assert.equal(gifUi.lineWarning, true)
  assert.equal(gifUi.hasDither, false)
  const gif = new Uint8Array(await readFile(gifPath))
  assert.ok(gif.length > 0)
  assert.equal(gifFrameCount(gif), 6)
  const warningProbe = encodeGif([{ rgba: new Uint8Array(4), delayMs: 1000 / 24 }], 1, 1, {
    numPlays: 1,
    maxColors: 2,
  })
  assert.ok(warningProbe.warnings.some((warning) => warning.includes('延遲精度')))

  const lineCheck = await window.webContents.executeJavaScript(`(async () => {
    window.__smoke.store.getState().set({ format: 'apng' })
    await window.__smoke.waitIdle()
    const started = performance.now()
    document.querySelectorAll('.quick button')[1].click()
    await window.__smoke.waitIdle()
    const resizeMs = performance.now() - started
    const first = window.__smoke.store.getState()
    const warning = [...document.querySelectorAll('.issues .warning')].some((node) => node.textContent.includes('0.4 秒'))
    const cels = window.__smoke.getAnimationCels()
    window.__smoke.store.getState().set({ slots: cels.map((cel) => ({ layerId: cel.id })), fps: 6, playCount: 4, format: 'apng' })
    await window.__smoke.waitIdle()
    const state = window.__smoke.store.getState()
    return { width: state.exportWidth, height: state.exportHeight, resizeMs, warning, errors: document.querySelectorAll('.issues .error').length, pass: document.querySelector('.issues .pass')?.textContent ?? '' }
  })()`)
  assert.ok(lineCheck.width === 320 || lineCheck.height === 270)
  assert.ok(lineCheck.width <= 320 && lineCheck.height <= 270)
  assert.ok(lineCheck.resizeMs < 500, `調整輸出尺寸耗時 ${lineCheck.resizeMs}ms，應低於 500ms`)
  assert.equal(lineCheck.warning, true)
  assert.equal(lineCheck.errors, 0)
  assert.match(lineCheck.pass, /符合 LINE 動態貼圖規格/)
  const lineFooter = await window.webContents.executeJavaScript(
    `(() => { const issues = document.querySelector('.export-footer .issues').getBoundingClientRect(); const button = document.querySelector('.export-button').getBoundingClientRect(); return { issues: { top: issues.top, bottom: issues.bottom }, button: { top: button.top, bottom: button.bottom }, height: innerHeight } })()`,
  )
  assert.ok(
    lineFooter.issues.top >= 0 && lineFooter.issues.bottom <= lineFooter.height,
    'LINE 檢查結果必須完整可見',
  )
  assert.ok(
    lineFooter.button.top >= 0 && lineFooter.button.bottom <= lineFooter.height,
    '匯出按鈕必須完整可見',
  )
  await writeFile(
    join(outputDir, 'ui-line-ok.png'),
    (await window.webContents.capturePage()).toPNG(),
  )

  const lineFail = await window.webContents.executeJavaScript(`(async () => {
    window.__smoke.store.getState().set({ exportWidth: 360, exportHeight: 360, playCount: 0 })
    await window.__smoke.waitIdle()
    return { errors: [...document.querySelectorAll('.export-footer .issues .error')].map((node) => node.textContent), buttonVisible: document.querySelector('.export-button').getBoundingClientRect().bottom <= innerHeight }
  })()`)
  assert.ok(lineFail.errors.length >= 2, 'LINE 不合規情境必須列出錯誤')
  assert.ok(lineFail.buttonVisible, 'LINE 不合規時匯出按鈕仍須可見')
  await new Promise((resolve) => setTimeout(resolve, 100))
  await writeFile(
    join(outputDir, 'ui-line-fail.png'),
    (await window.webContents.capturePage()).toPNG(),
  )

  await window.webContents.executeJavaScript(`(() => {
    const smoke = window.__smoke
    smoke.store.getState().set({ slots: Array.from({ length: 8 }, () => ({ layerId: null })), playCount: 4, format: 'apng' })
    window.confirm = () => true
    document.querySelectorAll('.timeline-tools button')[2].click()
  })()`)
  await new Promise((resolve) => setTimeout(resolve, 100))
  await window.webContents.executeJavaScript(
    `document.querySelectorAll('.quick button')[1].click()`,
  )
  await new Promise((resolve) => setTimeout(resolve, 100))
  const importedTimeline = await window.webContents.executeJavaScript(`(() => {
    const smoke = window.__smoke
    const state = smoke.store.getState()
    const cels = smoke.getAnimationCels()
    const stats = [...document.querySelectorAll('.stats b')].map((node) => node.textContent)
    return {
      slots: state.slots,
      fps: state.fps,
      cel1: cels.find((cel) => cel.name === '1').id,
      cel1a: cels.find((cel) => cel.name === '1a').id,
      stats,
      errors: document.querySelectorAll('.issues .error').length,
    }
  })()`)
  assert.equal(importedTimeline.slots.length, 20)
  assert.equal(importedTimeline.fps, 20)
  assert.equal(importedTimeline.slots[0].layerId, importedTimeline.cel1)
  assert.equal(importedTimeline.slots[1].layerId, null)
  assert.equal(importedTimeline.slots[2].layerId, importedTimeline.cel1a)
  assert.equal(Number(importedTimeline.stats[0]), 20)
  assert.ok(importedTimeline.stats.some((value: string) => value.includes('1.00')))
  assert.equal(importedTimeline.errors, 0)
  await writeFile(
    join(outputDir, 'ui-timeline.png'),
    (await window.webContents.capturePage()).toPNG(),
  )
  const timelineExportPath = join(outputDir, 'export-timeline.png')
  const timelineResult = await window.webContents.executeJavaScript(
    `window.__smoke.exportTo(${JSON.stringify(timelineExportPath)})`,
  )
  assert.equal(timelineResult.ok, true, timelineResult.error)
  const timelineInfo = verifyApng(new Uint8Array(await readFile(timelineExportPath)))
  assert.equal(timelineInfo.numPlays, 4)
  assert.equal(timelineInfo.numFrames, Number(importedTimeline.stats[1]))

  // 拖放路徑：把真正的 .clip 位元組餵進 clip:openBuffer，結果必須與走檔案路徑開出來的一致。
  // 放在最後跑，因為它會把主行程的 current 換成 buffer 解析出來的文件。
  const sampleBase64 = (await readFile(samplePath)).toString('base64')
  const dropped = await window.webContents.executeJavaScript(`(async () => {
    const binary = atob(${JSON.stringify(sampleBase64)})
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const summary = await window.api.openClipBuffer(bytes)
    const animation = summary.tree.children.find((child) => child.isAnimationFolder)
    return {
      width: summary.canvas.width,
      height: summary.canvas.height,
      frameRate: summary.timeline ? summary.timeline.frameRate : null,
      celNames: animation ? animation.children.map((child) => child.name) : [],
    }
  })()`)
  assert.equal(dropped.width, 360, '拖放解析的畫布寬度必須與檔案路徑解析一致')
  assert.equal(dropped.height, 360, '拖放解析的畫布高度必須與檔案路徑解析一致')
  assert.equal(dropped.frameRate, 20, '拖放解析的時間軸必須與檔案路徑解析一致')
  assert.deepEqual(dropped.celNames, snapshot.celNames, '拖放解析的圖層樹必須與檔案路徑解析一致')

  console.table({
    cels: snapshot.celNames.join(', '),
    dropCels: dropped.celNames.join(', '),
    timelineFrames: snapshot.timelineFrameCount,
    apngFrames: info.numFrames,
    gifFrames: gifFrameCount(gif),
    plays: info.numPlays,
    opaquePixels: snapshot.opaquePixels,
  })
  console.log(`Smoke 通過：${outputDir}`)
}

app
  .whenReady()
  .then(run)
  .then(() => app.quit())
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
app.on('before-quit', () => {
  if (window && !window.isDestroyed()) window.destroy()
  window = null
})
