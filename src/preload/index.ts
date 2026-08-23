import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { Api, ExportPayload } from './api.js'
const api: Api = {
  openClip: (filePath?: string) => ipcRenderer.invoke('clip:open', filePath),
  openClipBuffer: (bytes) => ipcRenderer.invoke('clip:openBuffer', bytes),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  renderLayer: (layerId, overrides) => ipcRenderer.invoke('clip:render', layerId, overrides),
  saveExport: (payload: ExportPayload) => ipcRenderer.invoke('export:save', payload),
  exportTo: (filePath, payload) => ipcRenderer.invoke('export:to', filePath, payload),
  listProjects: () => ipcRenderer.invoke('project:list'),
  saveProject: (snapshot) => ipcRenderer.invoke('project:save', snapshot),
  deleteProject: (id) => ipcRenderer.invoke('project:delete', id),
  renameProject: (id, name) => ipcRenderer.invoke('project:rename', id, name),
  importPackFolder: (path) => ipcRenderer.invoke('project:importFolder', path),
  hydratePackCells: (cells) => ipcRenderer.invoke('project:hydratePackCells', cells),
  exportPack: (filePath, cells, target) =>
    ipcRenderer.invoke('project:exportPack', filePath, cells, target),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setGiphy: (key, username) => ipcRenderer.invoke('settings:setGiphy', key, username),
  clearGiphy: () => ipcRenderer.invoke('settings:clearGiphy'),
  testGiphy: () => ipcRenderer.invoke('settings:testGiphy'),
  setProgressExpanded: (expanded) => ipcRenderer.invoke('settings:setProgressExpanded', expanded),
  uploadGiphy: (payload) => ipcRenderer.invoke('giphy:upload', payload),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  onMenuCommand: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, command: Parameters<typeof callback>[0]) =>
      callback(command)
    ipcRenderer.on('menu:command', listener)
    return () => ipcRenderer.removeListener('menu:command', listener)
  },
}
contextBridge.exposeInMainWorld('api', api)
