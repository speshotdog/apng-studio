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

// 煙霧測試會清 GIPHY 金鑰、建立與刪除專案。以前它跑在真正的 userData 上，
// 等於每跑一次就把使用者存的金鑰洗掉一次 —— 一定要先改到獨立的暫存目錄。
// 這行必須在 app ready 之前、在任何 settings/projects 模組讀路徑之前執行。
app.setPath('userData', join(projectRoot, 'out', 'smoke-userdata'))

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
  await rm(app.getPath('userData'), { recursive: true, force: true })
  await mkdir(outputDir, { recursive: true })
  await mkdir(app.getPath('userData'), { recursive: true })
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
  window.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2) console.error(`[renderer] ${message}`)
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
    store.getState().set({ lineTarget: 'sticker', targetSettings: {}, fps: 17, playCount: 3, exportWidth: 300, exportHeight: 270 }); smoke.setAdjust({ zoom: 0.8 })
    await smoke.waitIdle()
    const before = store.getState()
    const original = { fps: before.fps, playCount: before.playCount, zoom: smoke.getAdjust().zoom, width: before.exportWidth, height: before.exportHeight }
    const errorsBefore = document.querySelectorAll('.issues .error').length
    await select('twitchEmoteAnimated'); const twitch = store.getState()
    await select('youtubeEmoji'); const youtube = store.getState()
    await select('sticker'); const restored = store.getState()
    return {
      original, twitch: { fps: twitch.fps, playCount: twitch.playCount },
      youtube: { format: youtube.format, staticFrame: youtube.staticFrame },
      restored: { fps: restored.fps, playCount: restored.playCount, zoom: smoke.getAdjust().zoom, width: restored.exportWidth, height: restored.exportHeight },
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
    store.getState().set({ doc: { ...originalDoc, canvas: { width: 400, height: 300 } }, lineTarget: 'sticker', targetSettings: {} }); smoke.setAdjust({ zoom: 1 })
    await smoke.waitIdle()
    const select = async (value) => { const element = document.querySelector('.line-targets'); element.value = value; element.dispatchEvent(new Event('change', { bubbles: true })); await smoke.waitIdle() }
    await select('plurkEmoticon'); const plurkZoom = smoke.getAdjust().zoom
    await select('sticker'); const stickerZoom = smoke.getAdjust().zoom
    store.getState().set({ doc: originalDoc }); await smoke.waitIdle()
    return { plurkZoom, stickerZoom }
  })()`)
  assert.ok(nonSquareMemory.plurkZoom > 1)
  assert.equal(nonSquareMemory.stickerZoom, 1)

  // —— 存檔機制：存回目前專案、自動存檔、復原 ——
  const saveProgress = await window.webContents.executeJavaScript(`(async () => {
    const smoke = window.__smoke, store = smoke.store
    const project = store.getState().project
    if (!project) return { error: '編輯器沒有綁定專案' }
    store.getState().set({ fps: 17 })
    const dirtyAfterEdit = store.getState().dirty
    document.querySelector('.project-bar .save-button').click()
    await new Promise((resolve) => setTimeout(resolve, 300))
    const saved = await window.api.readProject(project.id)
    const list = await window.api.listProjects()
    return {
      dirtyAfterEdit,
      dirtyAfterSave: store.getState().dirty,
      savedFps: saved?.state?.fps,
      hasTracks: Boolean(saved?.state?.tracks?.length),
      listed: list.some((item) => item.id === project.id),
      thumbnail: Boolean(list.find((item) => item.id === project.id)?.thumbnail),
      toast: document.querySelector('.toast-success p')?.textContent ?? '',
    }
  })()`)
  assert.equal(saveProgress.error, undefined, saveProgress.error)
  assert.equal(saveProgress.dirtyAfterEdit, true, '改了 FPS 之後應該要被視為有未存檔變更')
  assert.equal(saveProgress.dirtyAfterSave, false, '存檔後不應再被視為有未存檔變更')
  assert.equal(saveProgress.savedFps, 17, '存進專案的內容不是當下的狀態')
  assert.ok(saveProgress.hasTracks, '存下來的專案沒有帶到圖層軌道')
  assert.ok(saveProgress.listed, '專案沒有出現在清單裡')
  assert.ok(saveProgress.thumbnail, '專案沒有存到縮圖')
  assert.match(saveProgress.toast, /已儲存/)

  // 自動存檔不可以蓋掉正式存檔，而且正式存檔一次就要把它清掉。
  const autosaveFlow = await window.webContents.executeJavaScript(`(async () => {
    const smoke = window.__smoke, store = smoke.store
    const id = store.getState().project.id
    store.getState().set({ fps: 23 })
    await window.api.autosaveProject(id, smoke.captureBlob())
    const pending = await window.api.readProjectAutosave(id)
    const stillSaved = await window.api.readProject(id)
    const listedDuring = (await window.api.listProjects()).find((item) => item.id === id)
    document.querySelector('.project-bar .save-button').click()
    await new Promise((resolve) => setTimeout(resolve, 300))
    return {
      pendingFps: pending?.state?.state?.fps,
      untouchedFps: stillSaved?.state?.fps,
      flagged: listedDuring?.hasAutosave,
      clearedAfterSave: await window.api.readProjectAutosave(id),
      savedFps: (await window.api.readProject(id))?.state?.fps,
    }
  })()`)
  assert.equal(autosaveFlow.pendingFps, 23, '自動存檔沒有存到當下狀態')
  assert.equal(autosaveFlow.untouchedFps, 17, '自動存檔不可以動到正式存檔')
  assert.equal(autosaveFlow.flagged, true, '專案清單沒有標示出有較新的自動存檔')
  assert.equal(autosaveFlow.clearedAfterSave, null, '正式存檔後應該清掉自動存檔')
  assert.equal(autosaveFlow.savedFps, 23, '正式存檔沒有寫入最新狀態')

  // 有未存檔變更時離開編輯器要被攔下來。
  const leaveGuard = await window.webContents.executeJavaScript(`(async () => {
    const store = window.__smoke.store
    store.getState().set({ fps: 11 })
    document.querySelector('.project-bar .project-buttons button:last-child').click()
    await new Promise((resolve) => requestAnimationFrame(resolve))
    const asked = Boolean(document.querySelector('.text-prompt'))
    document.querySelector('.text-prompt footer button')?.click()
    await new Promise((resolve) => setTimeout(resolve, 200))
    const screenAfterCancel = store.getState().screen
    store.getState().set({ fps: 17, dirty: false })
    return { asked, screenAfterCancel }
  })()`)
  assert.equal(leaveGuard.asked, true, '有未存檔變更時離開編輯器必須先問')
  assert.equal(leaveGuard.screenAfterCancel, 'editor', '按取消不該離開編輯器')

  const badPath = join(outputDir, 'broken.clip')
  await writeFile(badPath, (await readFile(samplePath)).subarray(0, 5000))
  const badClip = await window.webContents.executeJavaScript(`(async () => {
    const before = window.__smoke.store.getState().doc.filePath
    window.__smoke.store.getState().set({ dirty: false })
    // 換來源檔會先跳自製確認框，測試要自己按下去。
    const pending = window.__smoke.openClipUi(${JSON.stringify(badPath)})
    await new Promise((resolve) => requestAnimationFrame(resolve))
    document.querySelector('.text-prompt .prompt-confirm')?.click()
    await pending
    await window.__smoke.waitIdle()
    return { before, after: window.__smoke.store.getState().doc.filePath, error: document.querySelector('.toast-error p')?.textContent ?? '', root: Boolean(document.querySelector('#root .app')) }
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
    return { celNames: cels.map((cel) => cel.name), celIds: cels.map((cel) => cel.id), slots: smoke.getSlots(), inheritedId: state.resolveSlot(3)?.layerId ?? null, sourceId: smoke.getSlots()[2].layerId, timelineFrameCount: Number(stats[0]), actualFrameCount: Number(stats[1]), opaquePixels }
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
    const smoke = window.__smoke, store = smoke.store
    const beforePlayCount = store.getState().playCount
    const originalSlots = smoke.getSlots()
    document.querySelector('.transport button[title="循環預覽"]').click()
    const loop = store.getState().previewLoop
    store.getState().set({ selectedSlot: 7, playhead: 7 })
    await window.__smoke.waitIdle()
    document.querySelector('.timeline-tools .frame-remove').click()
    const shrunk = store.getState()
    smoke.setSlots(originalSlots); store.getState().set({ selectedSlot: 0, playhead: 0, previewLoop: true })
    return { beforePlayCount, afterPlayCount: store.getState().playCount, loop, selectedSlot: shrunk.selectedSlot, playhead: shrunk.playhead }
  })()`)
  assert.equal(controls.afterPlayCount, controls.beforePlayCount, '預覽循環不可改變匯出播放次數')
  assert.equal(controls.loop, false)
  assert.equal(controls.selectedSlot, 6)
  assert.equal(controls.playhead, 6)

  const visibilityChanged = await window.webContents.executeJavaScript(`(async () => {
    const before = [...document.querySelector('.stage canvas').getContext('2d').getImageData(0, 0, 360, 360).data]
    const id = window.__smoke.store.getState().resolveSlot(0)?.layerId
    const node = [...document.querySelectorAll('.layer-row')].find((row) => row.querySelector('.thumb')?.dataset.layerId === String(id))
    if (!node) throw new Error('找不到對應的圖層列，layerId=' + String(id))
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
    return { result, width: state.exportWidth, height: state.exportHeight, format: state.format, zoom: window.__smoke.getAdjust().zoom }
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
    window.__smoke.setSlots(cels.map((cel) => ({ layerId: cel.id }))); window.__smoke.store.getState().set({ fps: 6, playCount: 4, format: 'apng' })
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

  await window.webContents.executeJavaScript(`(async () => {
    const smoke = window.__smoke
    smoke.setSlots(Array.from({ length: 8 }, () => ({ layerId: null }))); smoke.store.getState().set({ playCount: 4, format: 'apng' })
    // 等 React 重繪，否則 Timeline 還握著舊的軌道內容，會誤判成「已有內容」跳確認框。
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    document.querySelector('.timeline-tools .import-timeline').click()
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
      slots: window.__smoke.getSlots(),
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
    store.getState().set({ playhead: 0, selectedSlot: 0, exportWidth: 270, exportHeight: 270 }); smoke.setAdjust({ zoom: 1, offsetX: 0, offsetY: 0 })
    await smoke.waitIdle()
    const pixels = (zoom, offsetX = 0) => { smoke.setAdjust({ zoom, offsetX, offsetY: 0 }); return smoke.composeFrame(0, 270, 270, 'smooth') }
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
    `(async () => { const s = window.__smoke.store.getState(); const c = window.__smoke.getAnimationCels(); window.__smoke.setSlots(c.map((x) => ({layerId:x.id}))); s.set({ fps: 6, playCount: 4, lineTarget: 'emoji', exportWidth: 180, exportHeight: 180, format: 'apng' }); await window.__smoke.waitIdle() })()`,
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
    window.__smoke.setSlots(cels.slice(0, 4).map((cel) => ({ layerId: cel.id }))); state.set({ mode: 'animation', fps: 20, exportWidth: 360, exportHeight: 360, playCount: 1, lineTarget: 'sticker', format: 'apng' })
    await smoke.waitIdle()
    document.querySelector('.autofix-button').click()
    // 確認框是自己畫的（不是原生 confirm），要真的去按下「套用」。
    await new Promise((resolve) => requestAnimationFrame(resolve))
    const accept = document.querySelector('.text-prompt .prompt-confirm')
    if (!accept) return { error: '一鍵符合規範沒有跳出確認框' }
    accept.click()
    await new Promise((resolve) => setTimeout(resolve, 200)); await smoke.waitIdle()
    const after = smoke.store.getState()
    return { slots: window.__smoke.getSlots().length, fps: after.fps, width: after.exportWidth, height: after.exportHeight, plays: after.playCount, errors: document.querySelectorAll('.issues .error').length }
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
    const smoke = window.__smoke, store = smoke.store
    const id = store.getState().project.id
    const target = document.querySelector('.line-targets'); target.value = 'youtubeEmoji'; target.dispatchEvent(new Event('change', { bubbles: true }))
    await smoke.waitIdle()
    store.getState().set({ staticFrame: 2, gifColors: 64 })
    document.querySelector('.project-bar .save-button').click()
    await new Promise((resolve) => setTimeout(resolve, 300))
    // 亂改一通之後，把存檔讀回來必須還原成存檔當下的樣子。
    store.getState().set({ fps: 33, staticFrame: 0, gifColors: 256 })
    const blob = await window.api.readProject(id)
    await smoke.applyBlob(blob)
    await smoke.waitIdle()
    const restored = store.getState()
    return { staticFrame: restored.staticFrame, gifColors: restored.gifColors, dirty: restored.dirty }
  })()`)
  assert.deepEqual(snapshotResult, { staticFrame: 2, gifColors: 64, dirty: false })

  const extremes = await window.webContents.executeJavaScript(`(async () => {
    const smoke = window.__smoke, state = smoke.store.getState(), cels = smoke.getAnimationCels()
    const results = []
    for (const frameCount of [1, 120]) for (const zoom of [0.2, 4]) for (const fps of [1, 60]) {
      window.__smoke.setSlots(Array.from({ length: frameCount }, (_, index) => ({ layerId: cels[index % cels.length].id }))); state.set({ mode: 'animation', playhead: 0, selectedSlot: 0, fps }); window.__smoke.setAdjust({ zoom })
      await smoke.waitIdle()
      const canvas = document.querySelector('.stage canvas')
      const values = [canvas.width, canvas.height, state.exportWidth, state.exportHeight, window.__smoke.getAdjust().zoom, state.fps]
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
    window.__smoke.store.getState().set({ mode: 'pack', packCells: result.cells }); window.__smoke.store.getState().toast('info', window.__smoke.packImportMessage(result))
    await window.__smoke.waitIdle()
    return { count: result.cells.length, notice: document.querySelector('.toast-info p, .toast-success p')?.textContent ?? '' }
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
    document.querySelector('.pack-workspace footer button').click()
    await new Promise((resolve) => requestAnimationFrame(resolve))
    const dialog = document.querySelector('.text-prompt')
    const message = dialog?.querySelector('.prompt-message')?.textContent ?? ''
    dialog?.querySelectorAll('footer button')[0]?.click()
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

  // renderer 端的 gifenc build 跟主程序不同；GIPHY 上傳走的是這一條，
  // 之前 default import 的形狀不對，一按就炸 GIFEncoder is not a function。
  const rendererGif = await window.webContents.executeJavaScript(`(async () => {
    const smoke = window.__smoke, cels = smoke.getAnimationCels()
    smoke.setSlots(cels.map((cel) => ({ layerId: cel.id })))
    smoke.store.getState().set({ lineTarget: 'sticker', format: 'apng', exportWidth: 270, exportHeight: 270 })
    await smoke.waitIdle()
    try {
      return { bytes: await smoke.encodeGifHere() }
    } catch (error) {
      return { error: String(error && error.message ? error.message : error) }
    }
  })()`)
  assert.equal(rendererGif.error, undefined, `renderer 端 GIF 編碼失敗：${rendererGif.error}`)
  assert.ok(rendererGif.bytes > 1000, 'renderer 端 GIF 編碼出來的位元組太少')

  // 點貼圖組空格建立文件，之後右側面板必須還能操作。
  await window.webContents.executeJavaScript(
    `window.addEventListener('error', (e) => { window.__smokeLastError = String(e.message) }); window.addEventListener('unhandledrejection', (e) => { window.__smokeLastError = String(e.reason && e.reason.message ? e.reason.message : e.reason) })`,
  )
  const packRoundTrip = await window.webContents.executeJavaScript(`(async () => {
    const smoke = window.__smoke, store = smoke.store
    window.confirm = () => { throw new Error('不該再用原生 confirm') }
    store.getState().set({ mode: 'pack', packTarget: 'sticker', packCount: 8, packCells: [] })
    await new Promise((resolve) => requestAnimationFrame(resolve))
    const emptyCell = document.querySelector('.pack-cell.empty.clickable')
    if (!emptyCell) return { error: '找不到可建立文件的貼圖組空格' }
    emptyCell.click()
    await new Promise((resolve) => setTimeout(resolve, 100))
    const saved = store.getState().packCells.length
    store.getState().set({ mode: 'pack' })
    await new Promise((resolve) => requestAnimationFrame(resolve))
    const cell = document.querySelector('.pack-cell.clickable.filled')
    if (!cell) return { saved, error: '貼圖組裡沒有文件格' }
    cell.click()
    await new Promise((resolve) => setTimeout(resolve, 600))
    // 剛存進去的就是目前這份狀態，不該再跳「會覆蓋進度」的確認框。
    const strayDialog = document.querySelector('.text-prompt')
    if (strayDialog) return { saved, error: '點回同一份狀態不該再跳確認框' }
    const select = document.querySelector('.line-targets')
    if (!select)
      return {
        saved,
        error:
          '回到動畫頁後找不到輸出目標下拉選單｜mode=' +
          store.getState().mode +
          '｜appClass=' +
          (document.querySelector('.app')?.className ?? '無') +
          '｜hasExportPanel=' +
          Boolean(document.querySelector('.panel.export')) +
          '｜lastError=' +
          (window.__smokeLastError ?? '無') +
          '｜docPath=' +
          (store.getState().doc?.filePath ?? '無') +
          '｜documentId=' +
          (store.getState().packCells[0]?.documentId ?? '無') +
          '｜dirty=' +
          store.getState().dirty +
          '｜toasts=' +
          store.getState().toasts.map((t) => t.level + ':' + t.text).join(' / '),
      }
    const box = select.getBoundingClientRect()
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    const style = getComputedStyle(select)
    return {
      saved,
      mode: store.getState().mode,
      width: Math.round(box.width),
      height: Math.round(box.height),
      disabled: select.disabled,
      pointerEvents: style.pointerEvents,
      visibility: style.visibility,
      covered: hit === select ? null : (hit ? hit.className || hit.tagName : 'nothing'),
    }
  })()`)
  assert.equal(packRoundTrip.error, undefined, packRoundTrip.error)
  assert.equal(packRoundTrip.saved, 1, '點空格沒有建立文件格')
  assert.equal(packRoundTrip.mode, 'animation', '點貼圖組格子應該回到單張動畫頁')
  assert.equal(packRoundTrip.disabled, false, '輸出目標下拉選單被停用')
  assert.equal(packRoundTrip.pointerEvents, 'auto', '輸出目標下拉選單收不到滑鼠事件')
  assert.equal(packRoundTrip.covered, null, `輸出目標下拉選單被 ${packRoundTrip.covered} 蓋住`)
  assert.ok(packRoundTrip.width > 100, `輸出目標下拉選單只有 ${packRoundTrip.width}px 寬`)

  // —— 素材庫：一個專案掛多個來源檔 ——
  // 複製一份樣本當第二個來源（不同路徑 = 主程序會當成不同的文件）。
  await writeFile(join(outputDir, 'second-source.clip'), await readFile(samplePath))
  const multiSource = await window.webContents.executeJavaScript(`(async () => {
    const smoke = window.__smoke, store = smoke.store
    store.getState().set({ mode: 'animation' })
    await new Promise((resolve) => requestAnimationFrame(resolve))
    const first = store.getState().activeSourceId
    const firstCount = store.getState().sources.length
    // 直接呼叫 store 加第二個來源（UI 那條要開檔案對話框，測不了）。
    const second = await window.api.openClip(${JSON.stringify(join(outputDir, 'second-source.clip'))})
    if (!second) return { error: '第二個來源檔開不起來' }
    const asset = { id: 'smoke-source-2', path: second.filePath, name: '12.clip' }
    store.getState().addSource(asset, second)
    await smoke.waitIdle()
    const afterAdd = {
      count: store.getState().sources.length,
      active: store.getState().activeSourceId,
      docSwitched: store.getState().doc?.filePath === second.filePath,
      listed: document.querySelectorAll('.source-list .source-item').length,
    }
    // 在第二個來源上放一格，確認影格記得自己的來源。
    const cels2 = smoke.getAnimationCels()
    if (!cels2.length) return { error: '第二個來源沒有動畫 cel' }
    store.getState().setSlot(0, cels2[0].id)
    const slot0 = store.getState().tracks[store.getState().activeTrack].slots[0]
    // 切回第一個來源，那一格仍然要指向第二個來源
    store.getState().setActiveSource(first)
    await smoke.waitIdle()
    const afterSwitch = {
      active: store.getState().activeSourceId,
      slotSource: store.getState().tracks[store.getState().activeTrack].slots[0].sourceId,
    }
    // 移除第二個來源：用到它的格子要被清空，其他來源不受影響
    store.getState().removeSource('smoke-source-2')
    await smoke.waitIdle()
    const afterRemove = {
      count: store.getState().sources.length,
      slot0: store.getState().tracks[store.getState().activeTrack].slots[0],
      stillHasFirst: store.getState().sources.some((item) => item.id === first),
    }
    return { firstCount, slot0Source: slot0.sourceId, afterAdd, afterSwitch, afterRemove }
  })()`)
  assert.equal(multiSource.error, undefined, multiSource.error)
  assert.equal(multiSource.firstCount, 1, '一開始應該只有一個來源')
  assert.equal(multiSource.afterAdd.count, 2, '加入第二個來源後素材庫應該有兩筆')
  assert.equal(multiSource.afterAdd.active, 'smoke-source-2', '加入後應該切成新的來源')
  assert.equal(multiSource.afterAdd.docSwitched, true, 'doc 沒有跟著切到新來源')
  assert.equal(multiSource.afterAdd.listed, 2, '素材面板沒有列出兩筆')
  assert.equal(multiSource.slot0Source, 'smoke-source-2', '影格沒有記住自己的來源')
  assert.notEqual(multiSource.afterSwitch.active, 'smoke-source-2', '沒有切回第一個來源')
  assert.equal(
    multiSource.afterSwitch.slotSource,
    'smoke-source-2',
    '切換 active 來源不該改掉影格既有的來源綁定',
  )
  assert.equal(multiSource.afterRemove.count, 1, '移除後素材庫應該剩一筆')
  assert.deepEqual(
    multiSource.afterRemove.slot0,
    { sourceId: null, layerId: null },
    '移除素材後，用到它的影格必須被清空',
  )
  assert.equal(multiSource.afterRemove.stillHasFirst, true, '不該連別的來源一起移除')

  // —— 專案選擇畫面：整趟走一次「離開 → 從列表點回來」——
  const startScreen = await window.webContents.executeJavaScript(`(async () => {
    const smoke = window.__smoke, store = smoke.store
    const id = store.getState().project.id
    const projectName = store.getState().project.name
    store.getState().set({ mode: 'animation', fps: 19 })
    document.querySelector('.project-bar .save-button').click()
    await new Promise((resolve) => setTimeout(resolve, 300))
    // 已存檔就不該再攔人。
    document.querySelector('.project-bar .project-buttons button:last-child').click()
    await new Promise((resolve) => setTimeout(resolve, 300))
    const blockedByDialog = Boolean(document.querySelector('.text-prompt'))
    const onStart = Boolean(document.querySelector('.start-screen'))
    const projectCleared = store.getState().project === null
    const cardCount = document.querySelectorAll('.start-card').length
    const named = [...document.querySelectorAll('.start-card .start-meta b')].map((n) => n.textContent)
    const thumbs = document.querySelectorAll('.start-card .start-thumb img').length
    // 從列表點回去，狀態要跟存檔當下一樣。
    const cards = [...document.querySelectorAll('.start-card')]
    cards[named.indexOf(projectName)]?.click()
    await new Promise((resolve) => setTimeout(resolve, 800))
    await smoke.waitIdle()
    return {
      blockedByDialog,
      onStart,
      cards: cardCount,
      thumbs,
      backInEditor: Boolean(document.querySelector('.app .project-bar')),
      fps: store.getState().fps,
      dirty: store.getState().dirty,
      clearedOnLeave: projectCleared,
      sameProject: store.getState().project?.id === id,
    }
  })()`)
  assert.equal(startScreen.blockedByDialog, false, '已存檔還被攔下來問要不要存')
  assert.equal(startScreen.onStart, true, '離開編輯器後沒有回到專案選擇畫面')
  assert.ok(startScreen.cards >= 1, '專案選擇畫面沒有列出任何專案')
  assert.ok(startScreen.thumbs >= 1, '專案卡片沒有縮圖')
  assert.equal(startScreen.backInEditor, true, '點專案卡片沒有進到編輯器')
  assert.equal(startScreen.clearedOnLeave, true, '回到專案列表時應該放掉目前專案')
  assert.equal(startScreen.sameProject, true, '點回來的不是同一個專案')
  assert.equal(startScreen.fps, 19, '從專案列表開回來的狀態不是存檔當下的內容')
  assert.equal(startScreen.dirty, false, '剛開啟的專案不該是未存檔狀態')

  const startVisible = await window.webContents.executeJavaScript(`(async () => {
    const store = window.__smoke.store
    store.getState().set({ screen: 'start', toasts: [] })
    await new Promise((resolve) => setTimeout(resolve, 400))
    // 整棵樹換掉之後畫面要真的重繪過，不然 capturePage 會拍到上一張。
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    return Boolean(document.querySelector('.start-screen .start-card'))
  })()`)
  assert.equal(startVisible, true, '切到專案列表後畫面上沒有專案卡片')
  await new Promise((resolve) => setTimeout(resolve, 600))
  await writeFile(join(outputDir, 'ui-start.png'), (await window.webContents.capturePage()).toPNG())
  await window.webContents.executeJavaScript(
    `window.__smoke.store.getState().set({ screen: 'editor' })`,
  )

  // —— GIPHY 標籤編輯器：真的打開上傳 modal 操作一輪 ——
  await window.webContents.executeJavaScript(
    `window.api.setGiphy('smoke-tag-key', '').then(() => window.api.addRecentTags(['以前用過的']))`,
  )
  const tagEditor = await window.webContents.executeJavaScript(`(async () => {
    const smoke = window.__smoke, store = smoke.store
    // App 的 settings 是進編輯器時抓的；剛設好金鑰要來回切一次畫面讓它重抓。
    store.getState().set({ screen: 'start' })
    await new Promise((resolve) => setTimeout(resolve, 250))
    store.getState().set({ screen: 'editor', mode: 'animation', lineTarget: 'sticker', format: 'apng' })
    await new Promise((resolve) => setTimeout(resolve, 400))
    document.querySelector('.giphy-button').click()
    await new Promise((resolve) => setTimeout(resolve, 800))
    const modal = document.querySelector('.giphy-confirm')
    if (!modal) return { error: 'GIPHY 上傳 modal 沒打開' }
    const input = modal.querySelector('.tag-input-row input')
    if (!input) return { error: 'modal 裡沒有標籤編輯器' }
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    const type = (text) => { setter.call(input, text); input.dispatchEvent(new Event('input', { bubbles: true })) }
    // 逗號直接切 chip；Enter 也要能收
    type('第一個, 第二個')
    type('第三個')
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    // 重複的不收
    type('第一個')
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await new Promise((resolve) => requestAnimationFrame(resolve))
    const chips = [...modal.querySelectorAll('.tag-chip')].map((chip) => chip.textContent.replace('✕', '').trim())
    // 建議 chip 點了要加入
    const suggestion = modal.querySelector('.tag-suggestions button')
    suggestion?.click()
    await new Promise((resolve) => requestAnimationFrame(resolve))
    const afterSuggestion = modal.querySelectorAll('.tag-chip').length
    // ✕ 移除
    modal.querySelector('.tag-chip button').click()
    await new Promise((resolve) => requestAnimationFrame(resolve))
    const afterRemove = modal.querySelectorAll('.tag-chip').length
    modal.querySelector('footer button').click()
    await new Promise((resolve) => requestAnimationFrame(resolve))
    return { chips, hadSuggestion: Boolean(suggestion), afterSuggestion, afterRemove, closed: !document.querySelector('.giphy-confirm') }
  })()`)
  assert.equal(tagEditor.error, undefined, tagEditor.error)
  assert.deepEqual(
    tagEditor.chips,
    ['第一個', '第二個', '第三個'],
    '標籤 chip 內容不對（逗號切割／Enter／去重其中一個壞了）',
  )
  assert.equal(tagEditor.hadSuggestion, true, '沒有顯示「最近用過」的建議標籤')
  assert.equal(tagEditor.afterSuggestion, 4, '點建議標籤沒有加入')
  assert.equal(tagEditor.afterRemove, 3, '按 ✕ 沒有移除標籤')
  assert.equal(tagEditor.closed, true, '取消沒有關掉 modal')
  await window.webContents.executeJavaScript(`(async () => {
    document.querySelector('.giphy-button').click()
    await new Promise((resolve) => setTimeout(resolve, 800))
    const input = document.querySelector('.giphy-confirm .tag-input-row input')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, '狗勾, 貼圖')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })()`)
  await new Promise((resolve) => setTimeout(resolve, 300))
  await writeFile(
    join(outputDir, 'ui-giphy-tags.png'),
    (await window.webContents.capturePage()).toPNG(),
  )
  await window.webContents.executeJavaScript(
    `document.querySelector('.giphy-confirm footer button')?.click()`,
  )
  await window.webContents.executeJavaScript(`window.api.clearGiphy()`)

  // 煙霧測試用的是真正的 userData，收工前要把自己建的專案清乾淨。
  const leftovers = await window.webContents.executeJavaScript(`(async () => {
    const list = await window.api.listProjects()
    const mine = list.filter((item) => /^smoke-/.test(item.name) || item.name === 'Smoke 快照')
    for (const item of mine) await window.api.deleteProject(item.id)
    return { removed: mine.length, remaining: (await window.api.listProjects()).length }
  })()`)
  assert.equal(leftovers.remaining, 0, `煙霧測試留下了 ${leftovers.remaining} 個專案沒清掉`)

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
