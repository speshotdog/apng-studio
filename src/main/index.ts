import { app, BrowserWindow, dialog, Menu, ipcMain } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { registerIpc } from './ipc.js'
import { migrateLegacyProjects } from './projects.js'
import type { MenuCommand } from '../preload/api.js'
let mainWindow: BrowserWindow | null = null
/** renderer 隨時回報有沒有未存檔的變更，關視窗前才問得出正確的問題。 */
let hasUnsaved = false
let allowClose = false
let closePromptOpen = false
let closeSaveFailed = false
function send(command: MenuCommand): void {
  mainWindow?.webContents.send('menu:command', command)
}
function argument(name: string): string | undefined {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
}
async function createWindow(): Promise<void> {
  hasUnsaved = false
  allowClose = false
  closePromptOpen = false
  closeSaveFailed = false
  const smokeClip = argument('smoke-clip')
  const smokeOutput = argument('smoke-output')
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    icon: join(__dirname, '../../assets/icon.png'),
    minWidth: 1024,
    minHeight: 640,
    show: !smokeClip,
    backgroundColor: '#171816',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  if (process.env.ELECTRON_RENDERER_URL) void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else
    await mainWindow.loadFile(
      join(__dirname, '../renderer/index.html'),
      smokeClip ? { query: { smoke: '1' } } : undefined,
    )
  if (smokeClip && smokeOutput) {
    const exportPath = join(smokeOutput, 'packaged-export.png')
    await mainWindow.webContents.executeJavaScript(`(async () => {
      const smoke = window.__smoke
      if (!smoke) throw new Error('找不到 packaged smoke 測試鉤子')
      await smoke.openClip(${JSON.stringify(smokeClip)})
      const cels = smoke.getAnimationCels()
      ;[0, 1, 2, 4, 6, 7].forEach((slot, index) => smoke.store.getState().setSlot(slot, cels[index].id))
      smoke.store.getState().set({ playhead: 0, selectedSlot: 0, playCount: 2, format: 'apng' })
      await smoke.waitIdle()
      const result = await smoke.exportTo(${JSON.stringify(exportPath)})
      if (!result.ok) throw new Error(result.error)
    })()`)
    await writeFile(
      join(smokeOutput, 'ui-packaged.png'),
      (await mainWindow.webContents.capturePage()).toPNG(),
    )
    app.quit()
  }
  mainWindow.on('close', (event) => {
    const target = mainWindow
    if (!target || allowClose || !hasUnsaved) return
    // 只用 beforeUnload 擋的話視窗會「按了沒反應」，使用者根本不知道發生什麼事。
    event.preventDefault()
    if (closePromptOpen) return
    closePromptOpen = true
    void dialog
      .showMessageBox(target, {
        type: 'warning',
        buttons: closeSaveFailed
          ? ['再次儲存', '放棄變更直接關閉', '取消']
          : ['儲存後關閉', '不儲存直接關閉', '取消'],
        defaultId: 0,
        cancelId: 2,
        message: closeSaveFailed ? '剛才的存檔失敗，變更尚未儲存' : '有未儲存的變更',
        detail: closeSaveFailed
          ? '可以再次儲存，或放棄變更直接關閉。'
          : '要先存回目前的專案再關閉嗎？',
      })
      .then(async ({ response }) => {
        if (response === 2) return
        if (response === 0) {
          const saved = await target.webContents
            .executeJavaScript('window.__saveBeforeClose && window.__saveBeforeClose()')
            .then((value: unknown) => value === true)
            .catch((error: unknown) => {
              console.warn(`關閉前存檔失敗：${String(error)}`)
              return false
            })
          if (!saved) {
            closeSaveFailed = true
            return
          }
        }
        closeSaveFailed = false
        allowClose = true
        target.close()
      })
      .finally(() => {
        closePromptOpen = false
      })
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}
app.whenReady().then(() => {
  ipcMain.on('window:dirty', (_event, value: boolean) => {
    hasUnsaved = value
  })
  registerIpc(() => mainWindow)
  void migrateLegacyProjects().then((count) => {
    if (count) console.log(`已把 ${count} 筆舊版進度匯入新的專案結構`)
  })
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: '檔案',
        submenu: [
          { label: '新專案', accelerator: 'CmdOrCtrl+N', click: () => send('new') },
          {
            label: '開啟檔案…（.clip / .procreate / .psd）',
            accelerator: 'CmdOrCtrl+O',
            click: () => send('open'),
          },
          { label: '草稿資料夾…', accelerator: 'CmdOrCtrl+D', click: () => send('drafts') },
          { type: 'separator' },
          { label: '儲存專案', accelerator: 'CmdOrCtrl+S', click: () => send('save') },
          { label: '回到專案列表', click: () => send('projects') },
          { type: 'separator' },
          { label: '匯出 APNG', accelerator: 'CmdOrCtrl+E', click: () => send('export-apng') },
          { label: '匯出 GIF', click: () => send('export-gif') },
          { type: 'separator' },
          { label: '結束', role: 'quit' },
        ],
      },
      { label: '設定', click: () => send('settings') },
    ]),
  )
  void createWindow().catch((error) => {
    console.error(error)
    app.exit(1)
  })
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
