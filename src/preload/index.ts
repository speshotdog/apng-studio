import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { Api, ExportPayload, MenuCommand } from './api.js'
const api: Api = {
  openClip: (filePath?: string) => ipcRenderer.invoke('clip:open', filePath),
  openClipBuffer: (bytes) => ipcRenderer.invoke('clip:openBuffer', bytes),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  renderLayer: (filePath, layerId, overrides) =>
    ipcRenderer.invoke('clip:render', filePath, layerId, overrides),
  saveExport: (payload: ExportPayload) => ipcRenderer.invoke('export:save', payload),
  exportTo: (filePath, payload) => ipcRenderer.invoke('export:to', filePath, payload),
  saveMultiExport: (payloads) => ipcRenderer.invoke('export:saveMulti', payloads),
  exportMultiTo: (folderPath, payloads) =>
    ipcRenderer.invoke('export:multiTo', folderPath, payloads),
  saveMultiZip: (payloads) => ipcRenderer.invoke('export:saveMultiZip', payloads),
  listProjects: () => ipcRenderer.invoke('project:list'),
  readProject: (id) => ipcRenderer.invoke('project:read', id),
  createProject: (input) => ipcRenderer.invoke('project:create', input),
  saveProject: (id, state, thumbnailDataUrl) =>
    ipcRenderer.invoke('project:save', id, state, thumbnailDataUrl),
  autosaveProject: (id, state) => ipcRenderer.invoke('project:autosave', id, state),
  readProjectAutosave: (id) => ipcRenderer.invoke('project:readAutosave', id),
  discardProjectAutosave: (id) => ipcRenderer.invoke('project:discardAutosave', id),
  deleteProject: (id) => ipcRenderer.invoke('project:delete', id),
  renameProject: (id, name) => ipcRenderer.invoke('project:rename', id, name),
  duplicateProject: (id, name) => ipcRenderer.invoke('project:duplicate', id, name),
  importPackFolder: (path) => ipcRenderer.invoke('project:importFolder', path),
  scanBatchSourceFolder: (path, packCount) =>
    ipcRenderer.invoke('project:scanBatchSourceFolder', path, packCount),
  hydratePackCells: (cells) => ipcRenderer.invoke('project:hydratePackCells', cells),
  exportPack: (filePath, cells, target) =>
    ipcRenderer.invoke('project:exportPack', filePath, cells, target),
  listDrafts: (folder) => ipcRenderer.invoke('drafts:list', folder),
  pickDraftFolder: () => ipcRenderer.invoke('drafts:pick'),
  encodeForPack: (payload) => ipcRenderer.invoke('pack:encode', payload),
  readPackImage: (source) => ipcRenderer.invoke('pack:readImage', source),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setGiphy: (key, username) => ipcRenderer.invoke('settings:setGiphy', key, username),
  clearGiphy: () => ipcRenderer.invoke('settings:clearGiphy'),
  testGiphy: () => ipcRenderer.invoke('settings:testGiphy'),
  addRecentTags: (tags) => ipcRenderer.invoke('settings:addRecentTags', tags),
  setProgressExpanded: (expanded) => ipcRenderer.invoke('settings:setProgressExpanded', expanded),
  uploadGiphy: (payload) => ipcRenderer.invoke('giphy:upload', payload),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  openPath: (filePath) => ipcRenderer.invoke('shell:openPath', filePath),
  showFrameContextMenu: (targetCount) =>
    ipcRenderer.invoke('timeline:frameContextMenu', targetCount),
  setDirty: (dirty) => ipcRenderer.send('window:dirty', dirty),
  onMenuCommand: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, command: MenuCommand) => callback(command)
    ipcRenderer.on('menu:command', listener)
    return () => ipcRenderer.removeListener('menu:command', listener)
  },
}
contextBridge.exposeInMainWorld('api', api)
