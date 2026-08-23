import { app, BrowserWindow, Menu } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { registerIpc } from './ipc.js'
let mainWindow: BrowserWindow | null = null
function send(command: 'open' | 'export-apng' | 'export-gif'): void {
  mainWindow?.webContents.send('menu:command', command)
}
function argument(name: string): string | undefined {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
}
async function createWindow(): Promise<void> {
  const smokeClip = argument('smoke-clip')
  const smokeOutput = argument('smoke-output')
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
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
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}
app.whenReady().then(() => {
  registerIpc(() => mainWindow)
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: '檔案',
        submenu: [
          { label: '開啟 .clip', accelerator: 'CmdOrCtrl+O', click: () => send('open') },
          { type: 'separator' },
          { label: '匯出 APNG', accelerator: 'CmdOrCtrl+E', click: () => send('export-apng') },
          { label: '匯出 GIF', click: () => send('export-gif') },
          { type: 'separator' },
          { label: '結束', role: 'quit' },
        ],
      },
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
