import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { Api, ExportPayload } from './api.js'
const api: Api = {
  openClip: (filePath?: string) => ipcRenderer.invoke('clip:open', filePath),
  openClipBuffer: (bytes) => ipcRenderer.invoke('clip:openBuffer', bytes),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  renderLayer: (layerId, overrides) => ipcRenderer.invoke('clip:render', layerId, overrides),
  saveExport: (payload: ExportPayload) => ipcRenderer.invoke('export:save', payload),
  exportTo: (filePath, payload) => ipcRenderer.invoke('export:to', filePath, payload),
  onMenuCommand: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, command: Parameters<typeof callback>[0]) =>
      callback(command)
    ipcRenderer.on('menu:command', listener)
    return () => ipcRenderer.removeListener('menu:command', listener)
  },
}
contextBridge.exposeInMainWorld('api', api)
