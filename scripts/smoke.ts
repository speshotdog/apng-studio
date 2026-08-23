import assert from 'node:assert/strict'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { app, BrowserWindow, nativeImage } from 'electron'
import JSZip from 'jszip'
import UPNG from 'upng-js'
import { verifyApng } from '../src/codec/apng.js'
import { encodeGif } from '../src/codec/gif.js'
import { registerIpc } from '../src/main/ipc.js'
import { testGiphyKey } from '../src/main/giphy.js'

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
  await rm(outputDir, { recursive: true, force: true })
  await mkdir(outputDir, { recursive: true })
  const invalidKey = await testGiphyKey('fake-key', async () => new Response('{}', { status: 401 }))
  assert.deepEqual(invalidKey, { ok: false, message: '金鑰無效' })
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

  const fakeKey = `smoke-${crypto.randomUUID()}`
  await window.webContents.executeJavaScript(`window.api.clearGiphy()`)
  const savedSettings = await window.webContents.executeJavaScript(
    `window.api.setGiphy(${JSON.stringify(fakeKey)}, 'smoke-user')`,
  )
  assert.equal(savedSettings.ok, true)
  const publicSettings = await window.webContents.executeJavaScript(`window.api.getSettings()`)
  assert.equal(publicSettings.hasGiphyKey, true)
  assert.equal('giphyKey' in publicSettings, false, 'settings:get 不得回傳金鑰欄位')
  const settingsPath = join(app.getPath('userData'), 'settings.json')
  const settingsText = await readFile(settingsPath, 'utf8')
  assert.equal(settingsText.includes(fakeKey), false, 'settings.json 不得含 API Key 明文')
  await window.webContents.executeJavaScript(`document.querySelector('.settings-button').click()`)
  await new Promise((resolve) => setTimeout(resolve, 100))
  const masked = await window.webContents.executeJavaScript(
    `document.querySelector('input[aria-label="GIPHY API Key"]').type`,
  )
  assert.equal(masked, 'password')
  await writeFile(
    join(outputDir, 'ui-settings.png'),
    (await window.webContents.capturePage()).toPNG(),
  )
  await window.webContents.executeJavaScript(
    `document.querySelector('.settings-dialog footer button:last-child')?.previousElementSibling?.click()`,
  )
  await window.webContents.executeJavaScript(`window.api.clearGiphy()`)
  assert.equal(
    (await window.webContents.executeJavaScript(`window.api.getSettings()`)).hasGiphyKey,
    false,
  )

  const withStore = async <T>(script: string): Promise<T> =>
    window!.webContents.executeJavaScript(`(async () => {
      const smoke = window.__smoke
      const before = smoke.snapshotStore()
      try { return await (${script})() }
      finally { await smoke.restoreStore(before); await smoke.waitIdle() }
    })()`)
  const assertCaptureState = async (expected: Record<string, unknown>): Promise<void> => {
    const actual = await window!.webContents.executeJavaScript(
      `(() => { const s = window.__smoke.store.getState(); return { fps: s.fps, exportWidth: s.exportWidth, exportHeight: s.exportHeight, lineTarget: s.lineTarget, playCount: s.playCount } })()`,
    )
    assert.deepEqual(actual, expected, `截圖前 store 狀態不符：${JSON.stringify(actual)}`)
  }

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

  const giphyButton = await window.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('.giphy-button')
    return { text: button.textContent.trim(), secondary: button.classList.contains('secondary'), title: button.title }
  })()`)
  assert.equal(giphyButton.text, '設定 GIPHY 金鑰')
  assert.equal(giphyButton.secondary, true)
  assert.match(giphyButton.title, /開啟設定/)

  const targetMemory = await window.webContents.executeJavaScript(`(async () => {
    const smoke = window.__smoke, store = smoke.store
    const select = async (value) => {
      const element = document.querySelector('.line-targets'); element.value = value
      element.dispatchEvent(new Event('change', { bubbles: true })); await smoke.waitIdle()
    }
    store.getState().set({ lineTarget: 'sticker', targetSettings: {}, fps: 17, playCount: 3, zoom: 0.8, exportWidth: 300, exportHeight: 270 })
    await smoke.waitIdle()
    const before = store.getState()
    const original = { fps: before.fps, playCount: before.playCount, zoom: before.zoom, width: before.exportWidth, height: before.exportHeight }
    const errorsBefore = document.querySelectorAll('.issues .error').length
    await select('twitchEmoteAnimated'); const twitch = store.getState()
    await select('youtubeEmoji'); const youtube = store.getState()
    await select('sticker'); const restored = store.getState()
    return {
      original, twitch: { fps: twitch.fps, playCount: twitch.playCount },
      youtube: { format: youtube.format, staticFrame: youtube.staticFrame },
      restored: { fps: restored.fps, playCount: restored.playCount, zoom: restored.zoom, width: restored.exportWidth, height: restored.exportHeight },
      errorsBefore, errorsAfter: document.querySelectorAll('.issues .error').length,
    }
  })()`)
  assert.ok(targetMemory.twitch.fps <= 30)
  assert.equal(targetMemory.twitch.playCount, 0)
  assert.equal(targetMemory.youtube.format, 'png')
  assert.equal(typeof targetMemory.youtube.staticFrame, 'number')
  assert.deepEqual(targetMemory.restored, targetMemory.original)
  assert.equal(targetMemory.errorsAfter, targetMemory.errorsBefore)

  const nonSquareMemory = await window.webContents.executeJavaScript(`(async () => {
    const smoke = window.__smoke, store = smoke.store, originalDoc = store.getState().doc
    store.getState().set({ doc: { ...originalDoc, canvas: { width: 400, height: 300 } }, lineTarget: 'sticker', targetSettings: {}, zoom: 1 })
    await smoke.waitIdle()
    const select = async (value) => { const element = document.querySelector('.line-targets'); element.value = value; element.dispatchEvent(new Event('change', { bubbles: true })); await smoke.waitIdle() }
    await select('plurkEmoticon'); const plurkZoom = store.getState().zoom
    await select('sticker'); const stickerZoom = store.getState().zoom
    store.getState().set({ doc: originalDoc }); await smoke.waitIdle()
    return { plurkZoom, stickerZoom }
  })()`)
  assert.ok(nonSquareMemory.plurkZoom > 1)
  assert.equal(nonSquareMemory.stickerZoom, 1)

  const badPath = join(outputDir, 'broken.clip')
  await writeFile(badPath, (await readFile(samplePath)).subarray(0, 5000))
  const badClip = await window.webContents.executeJavaScript(`(async () => {
    const before = window.__smoke.store.getState().doc.filePath
    await window.__smoke.openClipUi(${JSON.stringify(badPath)})
    await window.__smoke.waitIdle()
    return { before, after: window.__smoke.store.getState().doc.filePath, error: document.querySelector('.toast')?.textContent ?? '', root: Boolean(document.querySelector('#root .app')) }
  })()`)
  assert.equal(badClip.after, badClip.before, '損壞檔案不可取代原文件')
  assert.equal(badClip.root, true, '損壞檔案後 app 不可白畫面')
  assert.ok(
    badClip.error.length > 0 && /clip|chunk|檔|資料|結構/i.test(badClip.error),
    `損壞檔案錯誤不可讀：${badClip.error}`,
  )
  await window.webContents.executeJavaScript(`(async () => {
    window.__smoke.store.getState().set({ lineTarget: 'sticker', format: 'apng', playCount: 2, fps: 12, zoom: 1, exportWidth: 270, exportHeight: 270, targetSettings: {} })
    await window.__smoke.waitIdle()
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
    node.querySelector('input[type=checkbox]').click()
    await window.__smoke.waitIdle()
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
    lineWarning: [...document.querySelectorAll('.issues .info')].some((node) => node.textContent.includes('只接受 APNG')),
    hasDither: document.body.textContent.includes('抖色')
  })`)
  assert.match(gifUi.frameLabel, /實際 GIF 幀數/)
  assert.equal(gifUi.lineWarning, true)
  assert.equal(gifUi.hasDither, false)
  const gif = new Uint8Array(await readFile(gifPath))
  assert.ok(gif.length > 0)
  assert.equal(gifFrameCount(gif), 6)
  const plurkPath = join(outputDir, 'export-plurk.gif')
  const plurk = await window.webContents.executeJavaScript(`(async () => {
    const target = document.querySelector('.line-targets'); target.value = 'plurkEmoticon'; target.dispatchEvent(new Event('change', { bubbles: true }))
    await window.__smoke.waitIdle()
    const state = window.__smoke.store.getState()
    const result = await window.__smoke.exportTo(${JSON.stringify(plurkPath)})
    return { result, width: state.exportWidth, height: state.exportHeight, format: state.format, zoom: state.zoom }
  })()`)
  assert.equal(plurk.result.ok, true, plurk.result.error)
  assert.deepEqual(
    { width: plurk.width, height: plurk.height, format: plurk.format },
    { width: 48, height: 48, format: 'gif' },
  )
  assert.ok(plurk.zoom >= 1, '噗浪表情必須自動使用填滿構圖')
  const plurkGif = new Uint8Array(await readFile(plurkPath))
  assert.equal(new TextDecoder().decode(plurkGif.subarray(0, 6)), 'GIF89a')
  assert.equal(plurkGif[6]! | (plurkGif[7]! << 8), 48)
  assert.equal(plurkGif[8]! | (plurkGif[9]! << 8), 48)
  assert.ok(plurkGif.length < 256 * 1024)
  await writeFile(join(outputDir, 'ui-plurk.png'), (await window.webContents.capturePage()).toPNG())

  const twitchDir = join(outputDir, 'twitch')
  await mkdir(twitchDir, { recursive: true })
  const twitch = await window.webContents.executeJavaScript(`(async () => {
    const target = document.querySelector('.line-targets'); target.value = 'twitchEmoteAnimated'; target.dispatchEvent(new Event('change', { bubbles: true }))
    await window.__smoke.waitIdle(); const state = window.__smoke.store.getState()
    const result = await window.__smoke.exportTo(${JSON.stringify(twitchDir)})
    return { result, format: state.format, multiSize: true }
  })()`)
  assert.equal(twitch.format, 'gif')
  assert.equal(twitch.result.ok, true, twitch.result.error)
  const twitchFiles = twitch.result.files.map((file: { filePath: string }) => file.filePath).sort()
  assert.equal(twitchFiles.length, 3)
  const twitchSizes: number[] = []
  for (const filePath of twitchFiles) {
    const bytes = new Uint8Array(await readFile(filePath))
    assert.ok(bytes.length <= 1024 * 1024)
    assert.equal(new TextDecoder().decode(bytes.subarray(0, 6)), 'GIF89a')
    twitchSizes.push(bytes[6]! | (bytes[7]! << 8))
  }
  assert.deepEqual(
    twitchSizes.sort((a, b) => a - b),
    [28, 56, 112],
  )
  await writeFile(
    join(outputDir, 'ui-twitch.png'),
    (await window.webContents.capturePage()).toPNG(),
  )

  const youtubePath = join(outputDir, 'youtube.png')
  const youtube = await window.webContents.executeJavaScript(`(async () => {
    const target = document.querySelector('.line-targets'); target.value = 'youtubeEmoji'; target.dispatchEvent(new Event('change', { bubbles: true }))
    await window.__smoke.waitIdle(); const select = document.querySelector('.static-frame-control select'); select.value = '2'; select.dispatchEvent(new Event('change', { bubbles: true }))
    await window.__smoke.waitIdle(); const state = window.__smoke.store.getState()
    const expected = [...window.__smoke.composeFrame(2, 48, 48, state.scaleMode, state)]
    const result = await window.__smoke.exportTo(${JSON.stringify(youtubePath)})
    return { result, format: state.format, expected, hidden: !document.querySelector('.fps-control') && !document.body.textContent.includes('播放次數') }
  })()`)
  assert.equal(youtube.format, 'png')
  assert.equal(youtube.hidden, true)
  assert.equal(youtube.result.ok, true, youtube.result.error)
  const youtubeBytes = new Uint8Array(await readFile(youtubePath))
  assert.equal(new TextDecoder().decode(youtubeBytes).includes('acTL'), false)
  const youtubeDecoded = UPNG.decode(
    youtubeBytes.buffer.slice(
      youtubeBytes.byteOffset,
      youtubeBytes.byteOffset + youtubeBytes.byteLength,
    ),
  )
  assert.deepEqual(
    { width: youtubeDecoded.width, height: youtubeDecoded.height },
    { width: 48, height: 48 },
  )
  const rgba = new Uint8Array(UPNG.toRGBA8(youtubeDecoded)[0]!)
  assert.deepEqual([...rgba], youtube.expected)
  await writeFile(
    join(outputDir, 'ui-youtube.png'),
    (await window.webContents.capturePage()).toPNG(),
  )
  const warningProbe = encodeGif([{ rgba: new Uint8Array(4), delayMs: 1000 / 24 }], 1, 1, {
    numPlays: 1,
    maxColors: 2,
  })
  assert.ok(warningProbe.warnings.some((warning) => warning.includes('延遲精度')))

  const lineCheck = await window.webContents.executeJavaScript(`(async () => {
    window.__smoke.store.getState().set({ format: 'apng', targetSettings: {} })
    await window.__smoke.waitIdle()
    const started = performance.now()
    const target = document.querySelector('.line-targets'); target.value = 'sticker'; target.dispatchEvent(new Event('change', { bubbles: true }))
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
    `(() => { const target = document.querySelector('.line-targets'); target.value = 'sticker'; target.dispatchEvent(new Event('change', { bubbles: true })) })()`,
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
  const timelineOpaque = await window.webContents.executeJavaScript(`(() => {
    const canvas = document.querySelector('.stage canvas')
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    let count = 0
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) count++
    return count
  })()`)
  assert.ok(timelineOpaque > 0, 'ui-timeline.png 截圖前預覽 canvas 不可全透明')
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

  const adjustment = await window.webContents.executeJavaScript(`(async () => {
    const smoke = window.__smoke
    const store = smoke.store
    store.getState().set({ playhead: 0, selectedSlot: 0, exportWidth: 270, exportHeight: 270, zoom: 1, offsetX: 0, offsetY: 0 })
    await smoke.waitIdle()
    const pixels = (zoom, offsetX = 0) => smoke.composeFrame(0, 270, 270, 'smooth', { zoom, offsetX, offsetY: 0 })
    const baseline = pixels(1)
    const implicit = smoke.composeFrame(0, 270, 270, 'smooth')
    const stats = (rgba) => {
      let count = 0, sumX = 0
      for (let i = 3; i < rgba.length; i += 4) if (rgba[i] > 0) { count++; sumX += ((i - 3) / 4) % 270 }
      return { count, centerX: sumX / count }
    }
    return { same: baseline.every((value, index) => value === implicit[index]), base: stats(baseline), large: stats(pixels(2)), small: stats(pixels(.5)), shifted: stats(pixels(1, 100)) }
  })()`)
  assert.equal(adjustment.same, true, 'zoom=1、offset=0 必須維持既有輸出')
  assert.ok(adjustment.large.count > adjustment.base.count, 'zoom=2 非透明像素數必須增加')
  assert.ok(adjustment.small.count < adjustment.base.count, 'zoom=0.5 非透明像素數必須減少')
  assert.ok(adjustment.shifted.centerX > adjustment.base.centerX, 'offsetX=100 必須讓影像重心右移')

  const controls11 = await withStore<any>(`async () => {
    const state = window.__smoke.store.getState()
    state.set({ lineTarget: 'emoji', exportWidth: 180, exportHeight: 180, fps: 12 })
    await window.__smoke.waitIdle()
    const emojiState = window.__smoke.store.getState()
    const emoji = { width: emojiState.exportWidth, height: emojiState.exportHeight }
    const numberInput = document.querySelector('.fps-inputs input[type=number]')
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    nativeSetter.call(numberInput, '99')
    numberInput.dispatchEvent(new Event('change', { bubbles: true }))
    await window.__smoke.waitIdle()
    const high = window.__smoke.store.getState().fps
    nativeSetter.call(numberInput, '0')
    numberInput.dispatchEvent(new Event('change', { bubbles: true }))
    await window.__smoke.waitIdle()
    return { emoji, high, low: window.__smoke.store.getState().fps }
  }`)
  assert.deepEqual(controls11.emoji, { width: 180, height: 180 })
  assert.equal(controls11.high, 60)
  assert.equal(controls11.low, 1)
  await window.webContents.executeJavaScript(
    `(async () => { const s = window.__smoke.store.getState(); const c = window.__smoke.getAnimationCels(); s.set({ slots: c.map((x) => ({layerId:x.id})), fps: 6, playCount: 4, lineTarget: 'emoji', exportWidth: 180, exportHeight: 180, format: 'apng' }); await window.__smoke.waitIdle() })()`,
  )
  await assertCaptureState({
    fps: 6,
    exportWidth: 180,
    exportHeight: 180,
    lineTarget: 'emoji',
    playCount: 4,
  })
  await writeFile(join(outputDir, 'ui-emoji.png'), (await window.webContents.capturePage()).toPNG())

  const autofixUi = await window.webContents.executeJavaScript(`(async () => {
    const smoke = window.__smoke, state = smoke.store.getState(), cels = smoke.getAnimationCels()
    state.set({ mode: 'animation', slots: cels.slice(0, 4).map((cel) => ({ layerId: cel.id })), fps: 20, exportWidth: 360, exportHeight: 360, playCount: 1, lineTarget: 'sticker', format: 'apng' })
    window.confirm = () => true
    await smoke.waitIdle()
    document.querySelector('.autofix-button').click()
    await new Promise((resolve) => setTimeout(resolve, 100)); await smoke.waitIdle()
    const after = smoke.store.getState()
    return { slots: after.slots.length, fps: after.fps, width: after.exportWidth, height: after.exportHeight, plays: after.playCount, errors: document.querySelectorAll('.issues .error').length }
  })()`)
  assert.deepEqual(autofixUi, { slots: 6, fps: 6, width: 270, height: 270, plays: 4, errors: 0 })
  await assertCaptureState({
    fps: 6,
    exportWidth: 270,
    exportHeight: 270,
    lineTarget: 'sticker',
    playCount: 4,
  })
  await writeFile(
    join(outputDir, 'ui-autofix.png'),
    (await window.webContents.capturePage()).toPNG(),
  )

  const snapshotResult = await window.webContents.executeJavaScript(`(async () => {
    for (const item of await window.api.listProjects()) await window.api.deleteProject(item.id)
    const target = document.querySelector('.line-targets'); target.value = 'youtubeEmoji'; target.dispatchEvent(new Event('change', { bubbles: true }))
    await window.__smoke.waitIdle()
    window.__smoke.store.getState().set({ staticFrame: 2, gifColors: 64 })
    window.prompt = () => 'Smoke 快照'; window.confirm = () => true
    document.querySelector('.project-heading button').click()
    await new Promise((resolve) => setTimeout(resolve, 100))
    const saved = await window.api.listProjects()
    window.__smoke.store.getState().set({ fps: 33, staticFrame: 0, gifColors: 256 })
    document.querySelector('.project-row').click()
    await new Promise((resolve) => setTimeout(resolve, 300)); await window.__smoke.waitIdle()
    const restored = window.__smoke.store.getState()
    return { count: saved.length, staticFrame: restored.staticFrame, gifColors: restored.gifColors }
  })()`)
  assert.deepEqual(snapshotResult, { count: 1, staticFrame: 2, gifColors: 64 })

  const extremes = await window.webContents.executeJavaScript(`(async () => {
    const smoke = window.__smoke, state = smoke.store.getState(), cels = smoke.getAnimationCels()
    const results = []
    for (const frameCount of [1, 120]) for (const zoom of [0.2, 4]) for (const fps of [1, 60]) {
      state.set({ mode: 'animation', slots: Array.from({ length: frameCount }, (_, index) => ({ layerId: cels[index % cels.length].id })), playhead: 0, selectedSlot: 0, zoom, fps })
      await smoke.waitIdle()
      const canvas = document.querySelector('.stage canvas')
      const values = [canvas.width, canvas.height, state.exportWidth, state.exportHeight, state.zoom, state.fps]
      results.push({ width: canvas.width, height: canvas.height, finite: values.every(Number.isFinite) })
    }
    return results
  })()`)
  // 格數 [1,120] × zoom [0.2,4] × fps [1,60] = 8 種組合
  assert.equal(extremes.length, 8)
  for (const item of extremes) {
    assert.ok(item.width > 0 && item.height > 0, '極端值下預覽 canvas 尺寸必須大於 0')
    assert.equal(item.finite, true, '極端值下不可出現 NaN 或 Infinity')
  }

  const packSource = join(outputDir, 'pack-source')
  await mkdir(packSource, { recursive: true })
  const emptyPackSource = join(outputDir, 'pack-empty')
  await mkdir(emptyPackSource, { recursive: true })
  const emptyImport = await window.webContents.executeJavaScript(`(async () => {
    const result = await window.api.importPackFolder(${JSON.stringify(emptyPackSource)})
    window.__smoke.store.getState().set({ mode: 'pack', packCells: result.cells, notice: window.__smoke.packImportMessage(result) })
    await window.__smoke.waitIdle()
    return { count: result.cells.length, notice: document.querySelector('.toast')?.textContent ?? '' }
  })()`)
  assert.equal(emptyImport.count, 0)
  assert.match(emptyImport.notice, /沒有找到符合命名規則的圖片/)
  const png = (width: number, height: number, value: number): Buffer => {
    const bgra = Buffer.alloc(width * height * 4)
    for (let index = 0; index < bgra.length; index += 4) bgra.set([value, 180, 240, 255], index)
    return nativeImage.createFromBitmap(bgra, { width, height }).toPNG()
  }
  for (let index = 1; index <= 32; index++)
    await writeFile(join(packSource, `${String(index).padStart(2, '0')}.png`), png(370, 320, index))
  await writeFile(join(packSource, 'main.png'), png(240, 240, 80))
  await writeFile(join(packSource, 'tab.png'), png(96, 74, 120))
  await writeFile(join(packSource, '29_3.png'), png(10, 10, 1))
  const packPath = join(outputDir, 'pack.zip')
  const packResult = await window.webContents.executeJavaScript(`(async () => {
    const s = window.__smoke.store.getState(); s.set({ mode: 'pack', packTarget: 'staticSticker', packCount: 32 })
    const imported = await window.api.importPackFolder(${JSON.stringify(packSource)})
    s.set({ packCells: imported.cells }); await window.__smoke.waitIdle()
    const result = await window.api.exportPack(${JSON.stringify(packPath)}, imported.cells)
    return { result, count: imported.cells.length, skipped: imported.skipped, invalid: document.querySelectorAll('.pack-cell.invalid').length, filled: document.querySelectorAll('.pack-cell.filled').length }
  })()`)
  assert.equal(packResult.count, 34)
  assert.deepEqual(packResult.skipped, ['29_3.png'])
  assert.equal(packResult.invalid, 0)
  assert.equal(packResult.filled, 34)
  assert.equal(packResult.result.ok, true, packResult.result.error)
  const missingPackWarning = await window.webContents.executeJavaScript(`(async () => {
    const state = window.__smoke.store.getState()
    state.set({ packCells: state.packCells.filter((cell) => cell.index !== 2 && cell.index !== 7) })
    await window.__smoke.waitIdle()
    let message = ''; window.confirm = (value) => { message = value; return false }
    document.querySelector('.pack-workspace footer button').click()
    await new Promise((resolve) => setTimeout(resolve, 50))
    return message
  })()`)
  assert.match(missingPackWarning, /空格：02、07/)
  assert.match(missingPackWarning, /仍要打包嗎/)
  const zip = await JSZip.loadAsync(await readFile(packPath))
  const expectedNames = [
    ...Array.from({ length: 32 }, (_, index) => `${String(index + 1).padStart(2, '0')}.png`),
    'main.png',
    'tab.png',
  ]
  assert.deepEqual(Object.keys(zip.files).sort(), expectedNames.sort())
  for (const name of expectedNames) {
    const bytes = await zip.file(name)!.async('nodebuffer')
    const image = nativeImage.createFromBuffer(bytes)
    const expected =
      name === 'main.png'
        ? { width: 240, height: 240 }
        : name === 'tab.png'
          ? { width: 96, height: 74 }
          : { width: 370, height: 320 }
    assert.deepEqual(image.getSize(), expected)
  }
  await writeFile(join(outputDir, 'ui-pack.png'), (await window.webContents.capturePage()).toPNG())

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
