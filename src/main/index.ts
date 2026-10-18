import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, shell } from 'electron'
import { promises as fs } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { watch, type FSWatcher } from 'chokidar'
import { FileError, FileStore, hash, migrateUserData } from './files'
import type { PrintJob, Settings } from '../shared/types'

const here = dirname(fileURLToPath(import.meta.url))
app.setName('pure')
const explicitData = process.env.PURE_USER_DATA_DIR || process.env.SUJIAN_USER_DATA_DIR
const dataDirectory = explicitData ? resolve(explicitData) : join(app.getPath('appData'), 'pure')
if (!explicitData) await migrateUserData(dataDirectory, join(app.getPath('appData'), '素笺 MD'))
app.setPath('userData', dataDirectory)
protocol.registerSchemesAsPrivileged([{ scheme: 'pure-asset', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }])
const single = app.requestSingleInstanceLock()
if (!single) app.quit()
let win: BrowserWindow
let store: FileStore
let folder: string | null = null
let folderWatcher: FSWatcher | undefined
const documentWatchers = new Map<string, FSWatcher>()
let allowClose = false
let uiReady = false
let pendingPath = process.argv.find(a => /\.(md|markdown)$/i.test(a))
const pdfJobs = new Map<string, { job: PrintJob; window: BrowserWindow; resolve: () => void; reject: (e: Error) => void }>()
const send = (channel: string, value?: unknown) => { if (win && !win.isDestroyed()) win.webContents.send(channel, value) }
const mainOnly = (senderId: number) => { if (!win || senderId !== win.webContents.id) throw new FileError('DENIED', '此操作只允许在主窗口执行。') }
const inFolder = (candidate: string, parent: string) => { const p = relative(parent, candidate); return p === '' || (!p.startsWith('..') && !isAbsolute(p)) }
const ipc = (channel: string, fn: (...args: any[]) => unknown) => ipcMain.handle(channel, async (event, ...args) => {
  try { mainOnly(event.sender.id); return { ok: true, value: await fn(...args) } }
  catch (e: any) { return { ok: false, error: { code: e.code ?? 'IO_ERROR', message: e instanceof FileError ? e.message : friendlyError(e) } } }
})
function friendlyError(e: any) {
  if (e.code === 'EACCES' || e.code === 'EPERM') return '没有读写权限，请检查文件权限或另存到其他文件夹。'
  if (e.code === 'ENOENT') return '文件或文件夹已不存在。当前编辑内容会继续保留。'
  if (e.code === 'ENOSPC') return '磁盘空间不足，当前编辑内容仍保留在窗口中。请清理空间后重试或另存。'
  return e.message || '操作失败，请重试。'
}
function loadWindow(window: BrowserWindow, query: Record<string, string> = {}) {
  if (process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL)
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
    return window.loadURL(url.toString())
  }
  return window.loadFile(join(here, '../renderer/index.html'), { query })
}
async function watchDocument(id: string) {
  await documentWatchers.get(id)?.close()
  const doc = store.get(id)
  if (!doc.path) return
  const watcher = watch(doc.path, { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 60 } })
  documentWatchers.set(id, watcher)
  const notify = async () => {
    try {
      const current = store.get(id)
      if (!current.path) return
      const next = await store.read(current.path, id)
      if (next.revision !== current.revision) send('document:changed', { id, document: next })
    } catch (e: any) { send('document:changed', { id, missing: e.code === 'ENOENT', error: friendlyError(e) }) }
  }
  watcher.on('change', notify).on('add', notify).on('unlink', notify).on('error', e => send('document:changed', { id, error: friendlyError(e) }))
}
async function exportPDF(id: string, markdown: string) {
  const doc = store.get(id)
  const { canceled, filePath } = await dialog.showSaveDialog(win, { title: '导出 PDF', defaultPath: join(doc.path ? dirname(doc.path) : app.getPath('documents'), `${basename(doc.name, extname(doc.name))}.pdf`), filters: [{ name: 'PDF 文档', extensions: ['pdf'] }] })
  if (canceled || !filePath) return null
  const ticket = randomUUID()
  const print = new BrowserWindow({ show: false, width: 1000, height: 800, webPreferences: { preload: join(here, '../preload/index.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } })
  let timer: ReturnType<typeof setTimeout> | undefined
  const ready = new Promise<void>((resolveReady, rejectReady) => {
    pdfJobs.set(ticket, { job: { ticket, documentId: id, markdown, title: doc.name }, window: print, resolve: resolveReady, reject: rejectReady })
    timer = setTimeout(() => rejectReady(new Error('导出准备超时，请检查图片或图表后重试。')), 45000)
    print.webContents.once('render-process-gone', () => rejectReady(new Error('打印窗口意外退出，文档内容已保留。')))
  })
  // Attach a rejection handler before navigation, so navigation errors cannot leak it.
  ready.catch(() => {})
  try {
    await loadWindow(print, { print: ticket })
    await ready
    const pdf = await print.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false, margins: { top: 18 / 25.4, bottom: 18 / 25.4, left: 18 / 25.4, right: 18 / 25.4 } })
    const temporary = `${filePath}.${randomUUID()}.tmp`
    try { await fs.writeFile(temporary, pdf, { flag: 'wx' }); await fs.rename(temporary, filePath) }
    finally { await fs.unlink(temporary).catch(() => {}) }
    return filePath
  } finally {
    clearTimeout(timer)
    pdfJobs.delete(ticket)
    if (!print.isDestroyed()) print.destroy()
  }
}
function handlers() {
  ipc('settings:get', () => store.settings)
  ipc('settings:set', async (patch: Partial<Settings>) => {
    const safe: Partial<Settings> = {}
    if (patch.theme === 'light' || patch.theme === 'dark') safe.theme = patch.theme
    if (typeof patch.sidebar === 'boolean') safe.sidebar = patch.sidebar
    if (typeof patch.sidebarWidth === 'number' && Number.isFinite(patch.sidebarWidth)) safe.sidebarWidth = Math.min(600, Math.max(180, Math.round(patch.sidebarWidth)))
    if (typeof patch.focusMode === 'boolean') safe.focusMode = patch.focusMode
    if (typeof patch.typewriter === 'boolean') safe.typewriter = patch.typewriter
    if (patch.sidebarTab === 'files' || patch.sidebarTab === 'outline') safe.sidebarTab = patch.sidebarTab
    if (typeof patch.zoom === 'number') safe.zoom = Math.min(1.5, Math.max(0.75, patch.zoom))
    const settings = await store.setSettings(safe)
    win.setTitleBarOverlay({ color: settings.theme === 'dark' ? '#1e211f' : '#faf8f3', symbolColor: settings.theme === 'dark' ? '#e5e5dd' : '#2d302e', height: 47 })
    return settings
  })
  ipc('window:fullscreen', () => { win.setFullScreen(!win.isFullScreen()); return win.isFullScreen() })
  ipc('document:new', async (directory?: string) => {
    if (directory === undefined) return store.create()
    if (typeof directory !== 'string') throw new FileError('INVALID_PATH', '无效目录。')
    const doc = await store.createFile(directory)
    await watchDocument(doc.id)
    send('folder:changed', { directories: [dirname(doc.path!)] })
    return doc
  })
  ipc('document:rename', async (id: string, name: string, expectedRevision: string | null) => {
    await documentWatchers.get(id)?.close()
    try {
      const doc = await store.rename(id, name, expectedRevision)
      send('folder:changed', { directories: [dirname(doc.path!)] })
      return doc
    } finally { await watchDocument(id) }
  })
  ipc('document:release', async (id: string) => {
    await store.release(id)
    await documentWatchers.get(id)?.close()
    documentWatchers.delete(id)
  })
  ipc('document:open', async (path?: string) => {
    if (!path) {
      const result = await dialog.showOpenDialog(win, { title: '打开 Markdown', properties: ['openFile'], filters: [{ name: 'Markdown 文档', extensions: ['md', 'markdown'] }] })
      if (result.canceled) return null
      path = result.filePaths[0]
    }
    if (typeof path !== 'string') throw new FileError('INVALID_PATH', '无效文件路径。')
    const doc = await store.open(resolve(path))
    await watchDocument(doc.id)
    return doc
  })
  ipc('document:reload', (id: string, onlyIfClean?: boolean) => store.reload(id, onlyIfClean))
  ipc('document:save', async (id: string, markdown: string, saveAs = false, expectedRevision?: string | null) => {
    if (typeof markdown !== 'string') throw new FileError('INVALID_TEXT', '无效文档内容。')
    const doc = store.get(id)
    let destination: string | undefined
    if (saveAs || !doc.path) {
      const result = await dialog.showSaveDialog(win, { title: '保存 Markdown', defaultPath: doc.path ?? join(folder ?? app.getPath('documents'), doc.name), filters: [{ name: 'Markdown 文档', extensions: ['md', 'markdown'] }] })
      if (result.canceled || !result.filePath) return null
      destination = result.filePath
      if (!/\.(md|markdown)$/i.test(destination)) destination += '.md'
    }
    if ((!destination || destination === doc.path) && expectedRevision !== doc.revision)
      throw new FileError('CONFLICT', '文档版本已变化，请重新载入或另存当前内容。')
    const saved = await store.save(id, markdown, destination)
    await watchDocument(id)
    return saved
  })
  ipcMain.on('document:buffer', (event, id: string, markdown: string) => {
    if (event.sender.id !== win.webContents.id || typeof markdown !== 'string') return
    try { store.updateBuffer(id, markdown) } catch { /* Stale event from a replaced document. */ }
  })
  ipc('folder:open', async (path?: string) => {
    if (path === undefined) {
      const result = await dialog.showOpenDialog(win, { title: '打开文件夹', properties: ['openDirectory'] })
      if (result.canceled) return null
      path = result.filePaths[0]
    }
    if (typeof path !== 'string') throw new FileError('INVALID_PATH', '无效目录。')
    const selected = await fs.realpath(path)
    if (!(await fs.stat(selected)).isDirectory()) throw new FileError('INVALID_PATH', '请选择文件夹。')
    await folderWatcher?.close()
    folder = selected
    let timer: ReturnType<typeof setTimeout>
    folderWatcher = watch(selected, { ignoreInitial: true, ignored: p => /(^|[\\/])(node_modules|\.git|\.svn)([\\/]|$)/.test(p), followSymlinks: false })
    const changed = new Set<string>()
    folderWatcher.on('all', (event, path) => {
      if (event === 'change') return
      changed.add(dirname(path))
      if (event === 'unlinkDir') changed.add(path)
      clearTimeout(timer)
      timer = setTimeout(() => { send('folder:changed', { directories: [...changed] }); changed.clear() }, 200)
    })
    folderWatcher.on('error', () => send('folder:changed', { directories: [selected] }))
    return { path: selected, name: basename(selected) }
  })
  ipc('folder:list', async (path: string) => {
    if (!folder || !inFolder(await fs.realpath(path), folder)) throw new FileError('DENIED', '请选择文件夹内的目录。')
    return store.list(path)
  })
  ipc('draft:list', () => store.drafts())
  ipc('draft:discard', (id: string) => store.discardDraft(id))
  ipc('draft:recover', (id: string) => store.recover(id))
  ipc('document:confirm', async (name: string) => {
    const result = await dialog.showMessageBox(win, { type: 'question', title: '保存修改', message: `要保存“${basename(name)}”的修改吗？`, detail: '保存后继续，或放弃此次编辑。取消将留在当前文档。', buttons: ['保存', '放弃修改', '取消'], defaultId: 0, cancelId: 2, noLink: true })
    return (['save', 'discard', 'cancel'] as const)[result.response]
  })
  ipc('image:import', async (id: string, bytes: Uint8Array, name: string) => {
    const doc = store.get(id)
    if (!doc.path) throw new FileError('NO_PATH', '请先保存文档，再插入本地图片。')
    const ext = extname(name).toLowerCase()
    if (!['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.avif'].includes(ext)) throw new FileError('FILE_TYPE', '请选择常见图片格式。')
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > 25 * 1024 * 1024) throw new FileError('IMAGE_SIZE', '图片不能超过 25 MB。')
    const assetsName = `${basename(doc.path, extname(doc.path))}.assets`
    const assets = join(dirname(doc.path), assetsName)
    await fs.mkdir(assets, { recursive: true })
    const filename = `${hash(bytes).slice(0, 20)}${ext}`
    await fs.writeFile(join(assets, filename), bytes)
    return `${encodeURIComponent(assetsName)}/${filename}`
  })
  ipc('link:open', async (id: string, href: string) => {
    if (/^https?:\/\//i.test(href)) { await shell.openExternal(href); return }
    const doc = store.get(id)
    if (!doc.path || /^[a-z]+:/i.test(href)) throw new FileError('LINK', '只支持网页链接和相对 Markdown 文档链接。')
    const path = resolve(dirname(doc.path), decodeURIComponent(href.split('#')[0]))
    if (!/\.(md|markdown)$/i.test(path)) throw new FileError('LINK', '此链接不是 Markdown 文档。')
    send('app:command', { type: 'open-path', path })
  })
  ipc('pdf:export', exportPDF)
  ipcMain.handle('pdf:job', (event, ticket: string) => {
    const entry = pdfJobs.get(ticket)
    return entry && entry.window.webContents.id === event.sender.id ? { ok: true, value: entry.job } : { ok: false, error: { code: 'DENIED', message: '打印会话已结束。' } }
  })
  ipcMain.on('pdf:ready', (event, ticket: string, error?: string) => {
    const entry = pdfJobs.get(ticket)
    if (!entry || entry.window.webContents.id !== event.sender.id) return
    if (error) entry.reject(new Error(error)); else entry.resolve()
  })
  ipcMain.on('app:ready', event => {
    if (event.sender.id !== win.webContents.id) return
    uiReady = true
    if (pendingPath) { send('app:command', { type: 'open-path', path: pendingPath }); pendingPath = undefined }
  })
  ipcMain.on('app:close', event => { if (event.sender.id === win.webContents.id) { allowClose = true; win.close() } })
}

if (single) app.whenReady().then(async () => {
  store = new FileStore(app.getPath('userData'))
  await store.init()
  protocol.handle('pure-asset', async request => {
    try {
      const url = new URL(request.url)
      const doc = store.get(url.hostname)
      const reference = url.searchParams.get('ref') ?? ''
      if (!doc.path || !reference || reference.includes('\0')) return new Response('Not found', { status: 404 })
      const clean = decodeURIComponent(reference)
      const path = clean.startsWith('file:') ? fileURLToPath(clean) : resolve(dirname(doc.path), clean)
      if (!/\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i.test(path)) return new Response('Unsupported image', { status: 403 })
      return await net.fetch(pathToFileURL(path).toString())
    } catch { return new Response('Image unavailable', { status: 404 }) }
  })
  const dark = store.settings.theme === 'dark'
  app.setAppUserModelId('local.pure.editor')
  win = new BrowserWindow({ width: 1180, height: 820, minWidth: 700, minHeight: 480, title: 'pure', backgroundColor: dark ? '#1e211f' : '#faf8f3', titleBarStyle: 'hidden', titleBarOverlay: { color: dark ? '#1e211f' : '#faf8f3', symbolColor: dark ? '#e5e5dd' : '#2d302e', height: 47 }, webPreferences: { preload: join(here, '../preload/index.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false } })
  Menu.setApplicationMenu(null)
  win.setIcon(join(here, '../renderer/icon.ico'))
  handlers()
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', event => event.preventDefault())
  win.on('close', event => { if (!allowClose) { event.preventDefault(); send('app:command', { type: 'close' }) } })
  await loadWindow(win)
}).catch(error => { dialog.showErrorBox('pure 无法启动', String(error)); app.quit() })
app.on('second-instance', (_event, argv) => {
  const path = argv.find(a => /\.(md|markdown)$/i.test(a))
  if (win) { if (win.isMinimized()) win.restore(); win.focus() }
  if (path) { if (uiReady) send('app:command', { type: 'open-path', path }); else pendingPath = path }
})
app.on('window-all-closed', () => {
  folderWatcher?.close()
  for (const watcher of documentWatchers.values()) watcher.close()
  app.quit()
})
