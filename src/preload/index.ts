import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { DesktopAPI } from '../shared/types'

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args)
const subscribe = (channel: string, fn: (value: any) => void) => {
  const listener = (_event: unknown, value: unknown) => fn(value)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}
const api: DesktopAPI = {
  settings: () => invoke('settings:get'),
  setSettings: patch => invoke('settings:set', patch),
  toggleFullscreen: () => invoke('window:fullscreen'),
  newDocument: directory => invoke('document:new', directory),
  renameDocument: (id, name, expectedRevision) => invoke('document:rename', id, name, expectedRevision),
  releaseDocument: id => invoke('document:release', id),
  openFile: path => invoke('document:open', path),
  openFolder: path => invoke('folder:open', path),
  listDirectory: path => invoke('folder:list', path),
  save: (id, markdown, saveAs, expectedRevision) => invoke('document:save', id, markdown, saveAs, expectedRevision),
  reload: (id, onlyIfClean) => invoke('document:reload', id, onlyIfClean),
  updateBuffer: (id, markdown) => ipcRenderer.send('document:buffer', id, markdown),
  discardDraft: id => invoke('draft:discard', id),
  drafts: () => invoke('draft:list'),
  recoverDraft: id => invoke('draft:recover', id),
  confirmUnsaved: name => invoke('document:confirm', name),
  importImage: (id, bytes, name) => invoke('image:import', id, bytes, name),
  assetURL: (id, reference) => `pure-asset://${id}/?ref=${encodeURIComponent(reference)}`,
  droppedPath: file => webUtils.getPathForFile(file),
  openLink: (id, href) => invoke('link:open', id, href),
  exportPDF: (id, markdown) => invoke('pdf:export', id, markdown),
  printJob: ticket => invoke('pdf:job', ticket),
  printReady: (ticket, error) => ipcRenderer.send('pdf:ready', ticket, error),
  ready: () => ipcRenderer.send('app:ready'),
  close: () => ipcRenderer.send('app:close'),
  onFileChange: fn => subscribe('document:changed', fn),
  onTreeChange: fn => subscribe('folder:changed', fn),
  onCommand: fn => subscribe('app:command', fn),
}
contextBridge.exposeInMainWorld('desktop', api)
