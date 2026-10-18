import { constants, promises as fs } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { DocumentData, DraftData, Settings, TreeEntry } from '../shared/types'

export class FileError extends Error {
  constructor(public code: string, message: string) { super(message) }
}
export const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
export const normalize = (text: string) => text.replace(/\r\n/g, '\n')
export function decode(bytes: Uint8Array) {
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  let text: string
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch { throw new FileError('ENCODING', '无法读取这个文件：首版支持 UTF-8 编码，请先转换编码。') }
  if (text.includes('\0')) throw new FileError('ENCODING', '文件包含二进制或非 UTF-8 文本。')
  return { markdown: normalize(text), bom, eol: (text.includes('\r\n') ? '\r\n' : '\n') as '\n' | '\r\n' }
}
export function encode(markdown: string, bom: boolean, eol: '\n' | '\r\n') {
  return Buffer.from((bom ? '\uFEFF' : '') + normalize(markdown).replace(/\n/g, eol), 'utf8')
}
export async function atomicWrite(path: string, bytes: Uint8Array, expected?: string | null) {
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`)
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined
  try {
    if (expected !== undefined) {
      let current: Buffer
      try { current = await fs.readFile(path) }
      catch { throw new FileError('CONFLICT', '原文件已被删除或无法读取，请另存当前内容。') }
      if (hash(current) !== expected) throw new FileError('CONFLICT', '原文件已在外部修改。请重新载入，或另存当前内容。')
      const stat = await fs.stat(path)
      if (!(stat.mode & 0o222)) throw new FileError('READ_ONLY', '原文件为只读，请另存当前内容。')
    }
    handle = await fs.open(temporary, 'wx')
    await handle.writeFile(bytes)
    await handle.sync()
    await handle.close()
    handle = undefined
    if (expected !== undefined && hash(await fs.readFile(path)) !== expected)
      throw new FileError('CONFLICT', '保存期间原文件发生变化，请另存当前内容。')
    await fs.rename(temporary, path)
  } finally {
    await handle?.close().catch(() => {})
    await fs.unlink(temporary).catch(() => {})
  }
}

export const defaultSettings: Settings = { theme: 'light', sidebar: true, sidebarWidth: 256, sidebarTab: 'files', zoom: 1, focusMode: false, typewriter: false, recentFiles: [] }

export async function migrateUserData(destination: string, legacy: string) {
  // Only application-owned preferences/drafts are copied. Never replace existing pure data.
  try { await fs.access(destination); return false } catch (e: any) { if (e.code !== 'ENOENT') throw e }
  try { await fs.access(legacy) } catch { return false }
  await fs.mkdir(destination, { recursive: true })
  for (const name of ['settings.json', 'drafts']) {
    try { await fs.cp(join(legacy, name), join(destination, name), { recursive: true, force: false, errorOnExist: true }) }
    catch (e: any) { if (e.code !== 'ENOENT') throw e }
  }
  return true
}
export class FileStore {
  documents = new Map<string, DocumentData>()
  buffers = new Map<string, string>()
  settings: Settings = { ...defaultSettings, recentFiles: [] }
  private draftTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private draftQueues = new Map<string, Promise<void>>()
  private settingsQueue: Promise<void> = Promise.resolve()
  constructor(public dataDirectory: string) {}
  async init() {
    await fs.mkdir(join(this.dataDirectory, 'drafts'), { recursive: true })
    try {
      const saved = JSON.parse(await fs.readFile(join(this.dataDirectory, 'settings.json'), 'utf8'))
      this.settings = { ...defaultSettings, ...saved, recentFiles: Array.isArray(saved.recentFiles) ? saved.recentFiles.slice(0, 10) : [] }
      this.settings.sidebarWidth = Number.isFinite(saved.sidebarWidth) ? Math.min(600, Math.max(180, saved.sidebarWidth)) : 256
    } catch { /* First launch or interrupted preferences file. */ }
  }
  async setSettings(patch: Partial<Settings>) {
    this.settings = { ...this.settings, ...patch }
    const data = Buffer.from(JSON.stringify(this.settings, null, 2))
    this.settingsQueue = this.settingsQueue.catch(() => {}).then(() => atomicWrite(join(this.dataDirectory, 'settings.json'), data))
    await this.settingsQueue
    return this.settings
  }
  create(markdown = '') {
    const doc: DocumentData = { id: randomUUID(), path: null, name: '未命名.md', markdown, revision: null, bom: false, eol: '\n', readOnly: false }
    this.documents.set(doc.id, doc)
    this.buffers.set(doc.id, markdown)
    return { ...doc }
  }
  async createFile(directory: string) {
    const target = await fs.realpath(directory)
    for (let n = 1; n < 10000; n++) {
      const path = join(target, n === 1 ? '未命名.md' : `未命名 (${n}).md`)
      let handle
      try { handle = await fs.open(path, 'wx') }
      catch (e: any) { if (e.code === 'EEXIST') continue; throw e }
      try { await handle.sync() } finally { await handle.close() }
      return this.open(path)
    }
    throw new FileError('NAME_LIMIT', '同名文件过多，请先重命名已有文件。')
  }
  async rename(id: string, name: string, expectedRevision: string | null) {
    const old = this.get(id)
    if (!old.path) throw new FileError('NO_PATH', '请先保存文档。')
    if (typeof name !== 'string' || !name.trim() || name !== name.trim() || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))
      throw new FileError('INVALID_NAME', '文件名包含非法字符或 Windows 保留名称。')
    if (!/\.(md|markdown)$/i.test(name)) name += '.md'
    const destination = join(dirname(old.path), name)
    if (destination === old.path) return { ...old }
    if (old.revision !== expectedRevision || hash(await fs.readFile(old.path)) !== old.revision)
      throw new FileError('CONFLICT', '原文件已变化，请重新载入后再重命名。')
    if (!((await fs.stat(old.path)).mode & 0o222)) throw new FileError('READ_ONLY', '原文件为只读，请先解除只读或另存。')
    // Hard-link creation is exclusive: unlike rename(), it never replaces a target.
    // Both names are in the same directory and the old link is removed only after success.
    try {
      try { await fs.link(old.path, destination) }
      catch (e: any) {
        if (!['ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EPERM'].includes(e.code)) throw e
        // FAT/exFAT volumes do not support hard links; exclusive copy retains the same no-overwrite rule.
        await fs.copyFile(old.path, destination, constants.COPYFILE_EXCL)
      }
    } catch (e: any) { if (e.code === 'EEXIST') throw new FileError('EXISTS', '已有同名文件，请使用其他名称。'); throw e }
    try {
      if (hash(await fs.readFile(old.path)) !== old.revision) throw new FileError('CONFLICT', '重命名期间原文件发生变化，已取消重命名。')
      await fs.unlink(old.path)
    }
    catch (e) { await fs.unlink(destination).catch(() => {}); throw e }
    const doc = { ...old, path: destination, name }
    this.documents.set(id, doc)
    await this.setSettings({ recentFiles: [destination, ...this.settings.recentFiles.filter(p => p !== old.path && p !== destination)].slice(0, 10) })
    await this.persistDraft(id)
    return { ...doc }
  }
  get(id: string) {
    const doc = this.documents.get(id)
    if (!doc) throw new FileError('NOT_FOUND', '文档已关闭，请重新打开。')
    return doc
  }
  async release(id: string) {
    this.documents.delete(id)
    this.buffers.delete(id)
    await this.discardDraft(id)
    this.draftQueues.delete(id)
  }
  async read(path: string, id: string = randomUUID()) {
    if (!/\.(md|markdown)$/i.test(path)) throw new FileError('FILE_TYPE', '请选择 .md 或 .markdown 文件。')
    const bytes = await fs.readFile(path)
    const info = decode(bytes)
    const stat = await fs.stat(path)
    return { id, path, name: basename(path), ...info, revision: hash(bytes), readOnly: !(stat.mode & 0o222) } satisfies DocumentData
  }
  async open(path: string) {
    const doc = await this.read(path)
    this.documents.set(doc.id, doc)
    this.buffers.set(doc.id, doc.markdown)
    await this.setSettings({ recentFiles: [path, ...this.settings.recentFiles.filter(p => p !== path)].slice(0, 10) })
    return { ...doc }
  }
  async reload(id: string, onlyIfClean = false) {
    const old = this.get(id)
    if (!old.path) return { ...old }
    const doc = await this.read(old.path, id)
    if (onlyIfClean && this.buffers.get(id) !== old.markdown)
      throw new FileError('LOCAL_CHANGES', '文件在外部发生了变化，当前编辑内容已保留。请重新载入或另存。')
    this.documents.set(id, doc)
    this.buffers.set(id, doc.markdown)
    await this.discardDraft(id)
    return { ...doc }
  }
  async save(id: string, markdown: string, destination?: string) {
    const old = this.get(id)
    const path = destination ?? old.path
    if (!path) throw new FileError('NO_PATH', '请先选择保存位置。')
    const bytes = encode(markdown, old.bom, old.eol)
    await atomicWrite(path, bytes, path === old.path ? old.revision : undefined)
    const doc = { ...old, name: basename(path), path, markdown: normalize(markdown), revision: hash(bytes), readOnly: false }
    this.documents.set(id, doc)
    // A new keystroke may have arrived while the disk write was in flight.
    if (this.buffers.get(id) === markdown) await this.discardDraft(id)
    await this.setSettings({ recentFiles: [path, ...this.settings.recentFiles.filter(p => p !== path)].slice(0, 10) })
    return { ...doc }
  }
  updateBuffer(id: string, markdown: string) {
    const doc = this.get(id)
    this.buffers.set(id, markdown)
    clearTimeout(this.draftTimers.get(id))
    if (markdown === doc.markdown) { this.discardDraft(id).catch(() => {}); return }
    this.draftTimers.set(id, setTimeout(() => { this.persistDraft(id).catch(() => {}) }, 1000))
  }
  private draftPath(id: string) {
    if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new FileError('INVALID_ID', '无效草稿编号。')
    return join(this.dataDirectory, 'drafts', `${id}.json`)
  }
  async persistDraft(id: string) {
    const doc = this.get(id)
    const markdown = this.buffers.get(id) ?? doc.markdown
    if (markdown === doc.markdown) return
    const draft: DraftData = { id, path: doc.path, name: doc.name, markdown, updatedAt: Date.now() }
    const task = (this.draftQueues.get(id) ?? Promise.resolve()).catch(() => {}).then(() => atomicWrite(this.draftPath(id), Buffer.from(JSON.stringify(draft))))
    this.draftQueues.set(id, task)
    await task
  }
  async discardDraft(id: string) {
    clearTimeout(this.draftTimers.get(id))
    this.draftTimers.delete(id)
    await this.draftQueues.get(id)?.catch(() => {})
    await fs.unlink(this.draftPath(id)).catch(e => { if (e.code !== 'ENOENT') throw e })
  }
  async drafts() {
    const drafts: DraftData[] = []
    for (const name of await fs.readdir(join(this.dataDirectory, 'drafts'))) {
      if (!name.endsWith('.json')) continue
      try {
        const d = JSON.parse(await fs.readFile(join(this.dataDirectory, 'drafts', name), 'utf8'))
        if (typeof d.id === 'string' && typeof d.markdown === 'string') drafts.push(d)
      } catch { /* Keep damaged draft files for manual recovery. */ }
    }
    return drafts.sort((a, b) => b.updatedAt - a.updatedAt)
  }
  async recover(id: string) {
    const draft: DraftData = JSON.parse(await fs.readFile(this.draftPath(id), 'utf8'))
    const doc = this.create('')
    // Recovered text is a new document: never silently replace an externally changed original.
    doc.name = `${basename(draft.name, extname(draft.name))}（恢复）.md`
    this.documents.set(doc.id, { ...doc })
    this.updateBuffer(doc.id, draft.markdown)
    await this.persistDraft(doc.id)
    await this.discardDraft(id)
    return { ...doc, markdown: draft.markdown }
  }
  async list(path: string): Promise<TreeEntry[]> {
    const entries = await fs.readdir(path, { withFileTypes: true })
    return entries.filter(e => !e.isSymbolicLink() && !['.git', 'node_modules', '.svn'].includes(e.name) && (e.isDirectory() || /\.(md|markdown)$/i.test(e.name)))
      .map(e => ({ name: e.name, path: join(path, e.name), directory: e.isDirectory() }))
      .sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name, 'zh-CN'))
  }
}
