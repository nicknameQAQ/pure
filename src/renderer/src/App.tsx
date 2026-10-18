import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { PanelLeft, FolderOpen, Save, MoreHorizontal, FileText, Plus, Search, X, Sun, Moon, Code2, Eye, Pencil, Download, ChevronRight, ChevronDown, ArrowUp, ArrowDown, Check, Leaf, Clock3, Folder, ZoomIn, ZoomOut, ListTree, ExternalLink, RotateCcw, AlertCircle, Focus, TextCursor, Maximize, Replace } from 'lucide-react'
import { RichEditor, type EditorHandle } from './Editor'
import type { SourceHandle } from './SourceEditor'
import { useDocumentMetrics } from './useDocumentMetrics'
import { invalidateDirectories, readDirectory, setDirectoryRoot, useDirectoryIndex } from './directoryIndex'
import { ResizableSidebar } from './ResizableSidebar'
import { useTreeWindow } from './useTreeWindow'
import { QuickOpen } from './QuickOpen'
import type { SearchAction, SearchResult } from './search'
import type { DocumentData, DraftData, FileChange, FolderData, Result, Settings, TreeEntry } from '../../shared/types'

const SourceEditor = lazy(() => import('./SourceEditor').then(module => ({ default: module.SourceEditor })))
const defaults: Settings = { theme: 'light', sidebar: true, sidebarWidth: 256, sidebarTab: 'files', zoom: 1, focusMode: false, typewriter: false, recentFiles: [] }
function unwrap<T>(result: Result<T>): T { if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code }); return result.value }
const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path
const parentPath = (path: string) => { const parent = path.replace(/[\\/][^\\/]+$/, ''); return /^[a-z]:$/i.test(parent) ? parent + '\\' : parent }
const inside = (path: string, root: string) => { const base = root.toLowerCase().replace(/[\\/]+$/, ''); return path.toLowerCase().replace(/[\\/]+$/, '') === base || path.toLowerCase().startsWith(base + '\\') }

function Directory({ path, level = 0, activePath, selectedDirectory, revision, reveal, onSelectDirectory, onOpen, onError, renaming, renameValue, onRenameValue, onRenameCommit, onRenameCancel }: { path: string; level?: number; activePath?: string | null; selectedDirectory: string; revision: number; reveal: string; onSelectDirectory(path: string): void; onOpen(path: string): void; onError(message: string): void; renaming: boolean; renameValue: string; onRenameValue(value: string): void; onRenameCommit(): void; onRenameCancel(): void }) {
  const [entries, setEntries] = useState<TreeEntry[]>([])
  const [expanded, setExpanded] = useState(new Set<string>())
  useEffect(() => {
    let live = true
    readDirectory(path).then(entries => { if (live) setEntries(entries) }).catch(error => { if (live) onError(error.message) })
    return () => { live = false }
  }, [path, revision])
  useEffect(() => { if (activePath && inside(activePath, path)) setExpanded(old => { const next = new Set(old); for (const entry of entries) if (entry.directory && inside(activePath, entry.path)) next.add(entry.path); return next }) }, [reveal, entries])
  const windowed = useTreeWindow(entries, reveal, activePath)
  return <div className="tree-branch" ref={windowed.root} style={windowed.style}>{windowed.rows.map(entry => <div key={entry.path}>
    {renaming && entry.path === activePath ? <div className="tree-rename" style={{ paddingLeft: 27 + level * 15 }}><FileText size={14} /><input autoFocus aria-label="文件名" value={renameValue} onFocus={event => { const end = event.currentTarget.value.replace(/\.(md|markdown)$/i, '').length; event.currentTarget.setSelectionRange(0, end) }} onChange={event => onRenameValue(event.target.value)} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Enter') { event.preventDefault(); onRenameCommit() } if (event.key === 'Escape') onRenameCancel() }} /></div> : <button className={`tree-entry ${entry.path === activePath ? 'selected' : ''} ${entry.directory && entry.path === selectedDirectory ? 'current-directory' : ''}`} style={{ paddingLeft: 14 + level * 15 }} title={entry.path} onClick={() => {
      if (entry.directory) { onSelectDirectory(entry.path); setExpanded(old => { const next = new Set(old); if (next.has(entry.path)) next.delete(entry.path); else next.add(entry.path); return next }) }
      else onOpen(entry.path)
    }}>{entry.directory ? <>{expanded.has(entry.path) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<Folder size={15} /></> : <><span className="tree-spacer" /><FileText size={14} /></>}<span>{entry.name}</span></button>}
    {entry.directory && expanded.has(entry.path) && <Directory {...{ activePath, selectedDirectory, revision, reveal, onSelectDirectory, onOpen, onError, renaming, renameValue, onRenameValue, onRenameCommit, onRenameCancel }} path={entry.path} level={level + 1} />}
  </div>)}</div>
}
function FilteredFiles({ query, root, activePath, onOpen }: { query: string; root: string; activePath?: string | null; onOpen(path: string): void }) {
  const index = useDirectoryIndex()
  const files = index.root === root ? index.files.filter(file => file.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0, 100) : []
  return <>{files.map(file => <button key={file.path} className={`tree-entry ${file.path === activePath ? 'selected' : ''}`} title={file.path} onClick={() => onOpen(file.path)}><FileText size={14} /><span>{file.path.slice(root.length + 1)}</span></button>)}{index.loading && <p className="empty-outline">正在读取…</p>}{!index.loading && !files.length && <p className="empty-outline">没有匹配的文件</p>}</>
}

export function App() {
  const [doc, setDoc] = useState<DocumentData | null>(null)
  const [text, setText] = useState('')
  const [initial, setInitial] = useState('')
  const [seed, setSeed] = useState(0)
  const [settings, setSettings] = useState<Settings>(defaults)
  const [sourceMode, setSourceMode] = useState(false)
  const [reading, setReading] = useState(false)
  const [menu, setMenu] = useState(false)
  const [folder, setFolder] = useState<FolderData | null>(null)
  const [selectedDirectory, setSelectedDirectory] = useState('')
  const [reveal, setReveal] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [treeRevision, setTreeRevision] = useState(0)
  const [filter, setFilter] = useState('')
  const [findOpen, setFindOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [searchResult, setSearchResult] = useState<SearchResult>({ total: 0, index: 0 })
  const [replaceOpen, setReplaceOpen] = useState(false)
  const [replacement, setReplacement] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [quickOpen, setQuickOpen] = useState(false)
  const [statsOpen, setStatsOpen] = useState(false)
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null)
  const [conflict, setConflict] = useState<FileChange | null>(null)
  const [drafts, setDrafts] = useState<DraftData[]>([])
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const editor = useRef<EditorHandle>(null)
  const source = useRef<SourceHandle>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const findInput = useRef<HTMLInputElement>(null)
  const docRef = useRef(doc)
  const textRef = useRef(text)
  const baseRef = useRef('')
  const sourceRef = useRef(false)
  const busyRef = useRef(false)
  const actionsRef = useRef<any>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  docRef.current = doc
  sourceRef.current = sourceMode
  const notify = (message: string, error = false) => {
    clearTimeout(toastTimer.current)
    setToast({ text: message, error })
    toastTimer.current = setTimeout(() => setToast(null), error ? 6500 : 2600)
  }
  const change = (value: string) => {
    textRef.current = value
    setText(value)
    if (docRef.current) window.desktop.updateBuffer(docRef.current.id, value)
  }
  const flush = () => {
    if (document.activeElement instanceof HTMLInputElement && document.activeElement.classList.contains('caption-input')) document.activeElement.blur()
    const value = sourceRef.current ? source.current?.flush() ?? textRef.current : editor.current?.flush() ?? textRef.current
    if (value !== textRef.current) change(value)
    return value
  }
  const activate = (value: DocumentData, base = value.markdown) => {
    const previous = docRef.current
    if (previous && previous.id !== value.id) window.desktop.releaseDocument(previous.id).catch(() => {})
    docRef.current = value
    textRef.current = value.markdown
    baseRef.current = base
    setDoc(value); setText(value.markdown); setInitial(value.markdown); setSeed(v => v + 1)
    if (value.path) setSettings(old => ({ ...old, recentFiles: [value.path!, ...old.recentFiles.filter(p => p !== value.path)].slice(0, 10) }))
    setConflict(null); setStatus(''); setSearchResult({ total: 0, index: 0 })
    setRenaming(false)
    if (value.path) { setSelectedDirectory(parentPath(value.path)); setReveal(value.id) }
    scroll.current?.scrollTo({ top: 0 })
    document.title = `${value.name} — pure`
  }
  async function run(fn: () => Promise<unknown>) {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true)
    try { await fn() }
    catch (e: any) { notify(e.message ?? String(e), true) }
    finally { busyRef.current = false; setBusy(false) }
  }
  async function save(saveAs = false) {
    const current = docRef.current
    if (!current) return false
    const markdown = flush()
    window.desktop.updateBuffer(current.id, markdown)
    const result = await window.desktop.save(current.id, markdown, saveAs, current.revision)
    if (!result.ok) {
      if (result.error.code === 'CONFLICT' || result.error.code === 'READ_ONLY') setConflict({ id: current.id, error: result.error.message })
      throw new Error(result.error.message)
    }
    if (!result.value) return false
    baseRef.current = result.value.markdown
    docRef.current = result.value
    setDoc(result.value)
    setSettings(s => ({ ...s, recentFiles: [result.value!.path!, ...s.recentFiles.filter(p => p !== result.value!.path)].slice(0, 10) }))
    setConflict(null); setStatus('已保存')
    document.title = `${result.value.name} — pure`
    return true
  }
  async function canLeave() {
    const current = docRef.current
    if (!current) return true
    if (flush() === baseRef.current) return true
    const choice = unwrap(await window.desktop.confirmUnsaved(current.name))
    if (choice === 'cancel') return false
    if (choice === 'save') return save()
    await window.desktop.discardDraft(current.id)
    return true
  }
  async function open(path?: string) {
    if (!await canLeave()) return
    const result = unwrap(await window.desktop.openFile(path))
    if (result) activate(result)
  }
  async function create() {
    if (!await canLeave()) return
    let directory = selectedDirectory || (docRef.current?.path ? parentPath(docRef.current.path) : '') || folder?.path
    if (!directory) { const chosen = await openFolder(); if (!chosen) return; directory = chosen.path }
    else if (!folder || !inside(directory, folder.path)) await openFolder(directory)
    const created = unwrap(await window.desktop.newDocument(directory))
    invalidateDirectories([directory]); setFilter(''); setTreeRevision(v => v + 1)
    activate(created)
    await preferences({ sidebar: true, sidebarTab: 'files' })
  }
  async function openFolder(path?: string) {
    const result = unwrap(await window.desktop.openFolder(path))
    if (result) {
      setDirectoryRoot(result.path); setFolder(result); setSelectedDirectory(result.path); setFilter(''); setTreeRevision(v => v + 1)
      await preferences({ sidebar: true, sidebarTab: 'files' })
    }
    return result
  }
  async function startRename() {
    const current = docRef.current
    if (!current?.path) { notify('请先保存文档。'); return }
    if (!folder || !inside(current.path, folder.path)) await openFolder(parentPath(current.path))
    await preferences({ sidebar: true, sidebarTab: 'files' })
    setFilter(''); setReveal(`${current.id}-${Date.now()}`); setRenameValue(current.name); setRenaming(true); setMenu(false)
  }
  async function commitRename() {
    const current = docRef.current
    if (!current?.path) return
    flush()
    const result = unwrap(await window.desktop.renameDocument(current.id, renameValue, current.revision))
    docRef.current = result; setDoc(result); setRenaming(false); setReveal(`${result.id}-${Date.now()}`)
    setSettings(old => ({ ...old, recentFiles: [result.path!, ...old.recentFiles.filter(path => path !== current.path && path !== result.path)].slice(0, 10) }))
    invalidateDirectories([parentPath(result.path!)]); setTreeRevision(v => v + 1)
    document.title = `${result.name} — pure`
  }
  async function preferences(patch: Partial<Settings>) {
    setSettings(old => ({ ...old, ...patch }))
    const result = unwrap(await window.desktop.setSettings(patch))
    setSettings(result)
  }
  const remount = () => { const value = flush(); setInitial(value); setSeed(v => v + 1) }
  async function theme() { await preferences({ theme: settings.theme === 'light' ? 'dark' : 'light' }); setMenu(false) }
  function toggleSource() { remount(); setSourceMode(v => !v); setMenu(false) }
  function toggleReading() { flush(); setReading(v => !v); setMenu(false) }
  async function toggleFocus() { await preferences({ focusMode: !settings.focusMode }); setMenu(false) }
  async function toggleTypewriter() { await preferences({ typewriter: !settings.typewriter }); setMenu(false) }
  function showFind(replace = false) { flush(); setFindOpen(true); setReplaceOpen(replace); setMenu(false); setTimeout(() => findInput.current?.focus(), 0) }
  async function pdf() {
    if (!docRef.current) return
    setMenu(false); setStatus('正在准备 PDF…')
    const path = unwrap(await window.desktop.exportPDF(docRef.current.id, flush()))
    if (path) { notify(`PDF 已导出至 ${path}`); setStatus('PDF 已导出') } else setStatus('')
  }
  async function upload(file: File) {
    try {
      if (!docRef.current?.path && !await save()) throw new Error('保存文档后即可插入图片。')
      return unwrap(await window.desktop.importImage(docRef.current!.id, new Uint8Array(await file.arrayBuffer()), file.name))
    } catch (e: any) { notify(e.message, true); throw e }
  }
  async function reload() {
    if (!docRef.current || !await canLeave()) return
    activate(unwrap(await window.desktop.reload(docRef.current.id)))
  }
  function nextMatch(direction = 1) {
    search(direction < 0 ? 'previous' : 'next')
  }
  function search(action: SearchAction) {
    const handle = sourceRef.current ? source.current : editor.current
    if (!handle || !query) return
    const count = searchResult.total
    setSearchResult(handle.search(action, replacement))
    flush()
    if (action === 'all') notify(`已替换 ${count} 处`)
  }
  async function recover(id: string) {
    if (!await canLeave()) return
    const recovered = unwrap(await window.desktop.recoverDraft(id))
    activate(recovered, '')
    setDrafts(old => old.filter(d => d.id !== id))
    notify('草稿已恢复，可另存为 Markdown 文档。')
  }
  actionsRef.current = { open, create, save, openFolder, startRename, toggleSource, toggleReading, toggleFocus, toggleTypewriter, preferences, settings, showFind, pdf, theme, run, canLeave, reload, activate, flush, notify }
  useEffect(() => {
    let alive = true
    Promise.all([window.desktop.settings(), window.desktop.newDocument()]).then(([s, d]) => {
      if (!alive) return
      setSettings(unwrap(s))
      const blank = unwrap(d)
      activate(blank)
      window.desktop.ready()
      window.desktop.drafts().then(recovery => { if (alive) setDrafts(unwrap(recovery)) }).catch(e => notify(String(e), true))
    }).catch(e => notify(String(e), true))
    const removeCommand = window.desktop.onCommand(command => {
      const actions = actionsRef.current
      if (command.type === 'open-path') actions.run(() => actions.open(command.path))
      else actions.run(async () => { if (await actions.canLeave()) window.desktop.close() })
    })
    const removeFile = window.desktop.onFileChange(change => {
      if (change.id !== docRef.current?.id) return
      const current = actionsRef.current.flush()
      if (change.document && current === baseRef.current) {
        // Reload through the main process to advance the expected disk revision.
        window.desktop.reload(change.id, true).then(result => {
          if (docRef.current?.id !== change.id) return
          if (!result.ok) { setConflict({ id: change.id, error: result.error.message }); return }
          if (actionsRef.current.flush() === baseRef.current) { actionsRef.current.activate(result.value); setStatus('已同步外部修改') }
          else {
            window.desktop.updateBuffer(change.id, actionsRef.current.flush())
            setConflict(change)
          }
        })
      } else setConflict(change)
    })
    const removeTree = window.desktop.onTreeChange(change => { invalidateDirectories(change?.directories ?? []); setTreeRevision(v => v + 1) })
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing) return
      if (event.key === 'Escape') { setMenu(false); setFindOpen(false); setQuery(''); setQuickOpen(false); setStatsOpen(false); setRenaming(false); return }
      const a = actionsRef.current
      if (event.key === 'F2') { event.preventDefault(); a.run(a.startRename); return }
      if (event.key === 'F8') { event.preventDefault(); a.run(a.toggleFocus); return }
      if (event.key === 'F9') { event.preventDefault(); a.run(a.toggleTypewriter); return }
      if (event.key === 'F11') { event.preventDefault(); a.run(async () => unwrap(await window.desktop.toggleFullscreen())); return }
      if (!(event.ctrlKey || event.metaKey)) return
      const key = event.key.toLowerCase()
      if (key === 's') { event.preventDefault(); a.run(() => a.save(event.shiftKey)) }
      else if (key === 'o') { event.preventDefault(); a.run(() => event.shiftKey ? a.openFolder() : a.open()) }
      else if (key === 'n') { event.preventDefault(); a.run(() => a.create()) }
      else if (key === 'f' || key === 'h') { event.preventDefault(); a.showFind(key === 'h') }
      else if (key === 'p') { event.preventDefault(); setMenu(false); setQuickOpen(true) }
      else if (event.shiftKey && key === 'l') { event.preventDefault(); a.run(() => a.preferences({ sidebar: !a.settings.sidebar })) }
      else if (event.shiftKey && (event.code === 'Digit1' || event.code === 'Digit2')) { event.preventDefault(); a.run(() => a.preferences({ sidebar: true, sidebarTab: event.code === 'Digit1' ? 'outline' : 'files' })) }
      else if (['=', '+', '-', '0'].includes(key)) { event.preventDefault(); a.run(() => a.preferences({ zoom: key === '0' ? 1 : a.settings.zoom + (key === '-' ? -0.1 : 0.1) })) }
      else if (key === '/') { event.preventDefault(); a.toggleSource() }
      else if (key === 'e') { event.preventDefault(); a.toggleReading() }
    }
    window.addEventListener('keydown', keydown, true)
    return () => { alive = false; removeCommand(); removeFile(); removeTree(); window.removeEventListener('keydown', keydown, true); clearTimeout(toastTimer.current) }
  }, [])
  useEffect(() => { document.documentElement.dataset.theme = settings.theme }, [settings.theme])
  useEffect(() => { if (findOpen) findInput.current?.focus() }, [findOpen])
  const { outline, stats } = useDocumentMetrics(text)
  const dirty = text !== baseRef.current
  useEffect(() => {
    if (!doc?.path || !settings.sidebar) return
    const timer = setTimeout(() => document.querySelector('.tree-entry.selected')?.scrollIntoView({ block: 'nearest' }), 100)
    return () => clearTimeout(timer)
  }, [reveal, treeRevision, settings.sidebar, settings.sidebarTab])

  return <div className="app" data-testid="app" aria-busy={busy}>
    <header className="titlebar">
      <button className="icon-button" title="切换侧栏 · Ctrl+Shift+L" aria-label="切换侧栏" onClick={() => run(() => preferences({ sidebar: !settings.sidebar }))}><PanelLeft size={18} /></button>
      <span className="titlebar-brand"><Leaf size={17} /> pure</span>
      <span className="title-separator" />
      <span className="document-title" title={doc?.path ?? '未保存的文档'}>{doc?.name ?? '正在打开…'}{dirty && <span className="dirty-dot" title="尚未保存" />}{reading && <span className="mode-label">阅读</span>}</span>
      <div className="titlebar-actions">
        <button className="icon-button" title="打开文档 · Ctrl+O" aria-label="打开文档" disabled={busy} onClick={() => run(() => open())}><FolderOpen size={18} /></button>
        <button className="icon-button" title="保存 · Ctrl+S" aria-label="保存" disabled={busy || !doc} onClick={() => run(() => save())}><Save size={17} /></button>
        <div className="menu-anchor"><button className={`icon-button ${menu ? 'active' : ''}`} aria-label="更多" title="更多" onClick={() => setMenu(v => !v)}><MoreHorizontal size={20} /></button>
          {menu && <><div className="menu-dismiss" onClick={() => setMenu(false)} /><div className="dropdown" role="menu">
            <button onClick={() => { setMenu(false); run(create) }}><Plus size={16} />新建文档<kbd>Ctrl N</kbd></button>
            <button onClick={() => { setMenu(false); run(openFolder) }}><FolderOpen size={16} />打开文件夹<kbd>Ctrl ⇧ O</kbd></button>
            <button onClick={() => { setMenu(false); run(() => save(true)) }}><Save size={16} />另存为<kbd>Ctrl ⇧ S</kbd></button>
            <button disabled={!doc?.path} onClick={() => run(startRename)}><Pencil size={16} />重命名文件<kbd>F2</kbd></button>
            <button onClick={() => { setMenu(false); setQuickOpen(true) }}><Search size={16} />快速打开<kbd>Ctrl P</kbd></button>
            <hr />
            <button onClick={() => showFind(true)}><Replace size={16} />查找与替换<kbd>Ctrl H</kbd></button>
            <button onClick={toggleSource}><Code2 size={16} />{sourceMode ? '返回即时编辑' : 'Markdown 源码'}<kbd>Ctrl /</kbd></button>
            <button onClick={toggleReading}>{reading ? <Pencil size={16} /> : <Eye size={16} />}{reading ? '返回编辑' : '专注阅读'}<kbd>Ctrl E</kbd></button>
            <button role="menuitemcheckbox" aria-checked={settings.focusMode} onClick={() => run(toggleFocus)}><Focus size={16} />焦点模式{settings.focusMode && <Check size={12} />}<kbd>F8</kbd></button>
            <button role="menuitemcheckbox" aria-checked={settings.typewriter} onClick={() => run(toggleTypewriter)}><TextCursor size={16} />打字机模式{settings.typewriter && <Check size={12} />}<kbd>F9</kbd></button>
            <button onClick={() => { setMenu(false); run(async () => unwrap(await window.desktop.toggleFullscreen())) }}><Maximize size={16} />切换全屏<kbd>F11</kbd></button>
            <button onClick={() => run(theme)}>{settings.theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}{settings.theme === 'light' ? '深色模式' : '浅色模式'}</button>
            <div className="zoom-controls"><span>正文字号</span><button aria-label="缩小正文" onClick={() => run(() => preferences({ zoom: settings.zoom - 0.1 }))}><ZoomOut size={15} /></button><span>{Math.round(settings.zoom * 100)}%</span><button aria-label="放大正文" onClick={() => run(() => preferences({ zoom: settings.zoom + 0.1 }))}><ZoomIn size={15} /></button></div>
            <hr /><button onClick={() => run(pdf)}><Download size={16} />导出 PDF<ExternalLink size={12} className="trailing-icon" /></button>
          </div></>}
        </div>
      </div>
    </header>
    <div className="workspace">
      {settings.sidebar && <ResizableSidebar width={settings.sidebarWidth} onWidth={width => { preferences({ sidebarWidth: width }).catch(e => notify(e.message, true)) }}>
        <div className="sidebar-heading"><span>工作空间</span><button className="icon-button small" aria-label="打开文件夹" title="打开文件夹" onClick={() => run(openFolder)}><FolderOpen size={16} /></button><button className="icon-button small" aria-label="新建文档" title="新建文档" onClick={() => run(create)}><Plus size={17} /></button></div>
        <div className="sidebar-tabs"><button className={settings.sidebarTab === 'files' ? 'selected' : ''} onClick={() => run(() => preferences({ sidebarTab: 'files' }))}><Folder size={14} />文件</button><button className={settings.sidebarTab === 'outline' ? 'selected' : ''} onClick={() => run(() => preferences({ sidebarTab: 'outline' }))}><ListTree size={15} />大纲<span>{outline.length}</span></button></div>
        {settings.sidebarTab === 'files' ? <>
          {folder ? <><div className="file-filter"><Search size={14} /><input aria-label="筛选文件" placeholder="筛选文件…" value={filter} onChange={event => setFilter(event.target.value)} /></div><button className={`folder-label ${selectedDirectory === folder.path ? 'current-directory' : ''}`} title={folder.path} onClick={() => setSelectedDirectory(folder.path)}><ChevronDown size={12} />{folder.name}</button><div className="sidebar-scroll">{filter ? <FilteredFiles query={filter} root={folder.path} activePath={doc?.path} onOpen={path => run(() => open(path))} /> : <Directory path={folder.path} activePath={doc?.path} selectedDirectory={selectedDirectory} revision={treeRevision} reveal={reveal} onSelectDirectory={setSelectedDirectory} onOpen={path => run(() => open(path))} onError={message => notify(message, true)} renaming={renaming} renameValue={renameValue} onRenameValue={setRenameValue} onRenameCommit={() => run(commitRename)} onRenameCancel={() => setRenaming(false)} />}</div></> : <div className="sidebar-scroll">
            <div className="folder-placeholder"><button className="secondary-button" onClick={() => run(openFolder)}><FolderOpen size={15} />打开文件夹</button></div>
            {settings.recentFiles.length > 0 && <div className="recent-files"><div className="section-label"><Clock3 size={12} />最近打开</div>{settings.recentFiles.map(path => <button key={path} title={path} onClick={() => run(() => open(path))}><FileText size={14} /><span>{baseName(path)}</span></button>)}</div>}
          </div>}
        </> : <div className="sidebar-scroll outline">{outline.length ? outline.map((heading, index) => <button key={`${index}-${heading.text}`} style={{ paddingLeft: 16 + (heading.level - 1) * 12 }} onClick={() => sourceMode ? source.current?.revealLine(heading.line) : editor.current?.revealHeading(index)}><span className="heading-level">{heading.level === 1 ? 'H1' : '·'}</span><span>{heading.text}</span></button>) : <p className="empty-outline">添加标题后，大纲会出现在这里。</p>}</div>}
      </ResizableSidebar>}
      <main className="main-pane">
        {conflict && <div className="conflict-banner" role="alert"><AlertCircle size={16} /><span>{conflict.missing ? '原文件已被移除，当前内容仍然保留。' : conflict.error ?? '文件在外部发生了变化，请选择如何继续。'}</span>{!conflict.missing && <button onClick={() => run(reload)}>重新载入</button>}<button onClick={() => run(() => save(true))}>另存当前内容</button></div>}
        {findOpen && <div className="find-bar" role="search">
          <div className="find-row"><Search size={15} /><input ref={findInput} aria-label="查找文字" placeholder="查找…" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); nextMatch(event.shiftKey ? -1 : 1) } }} /><span className="find-count" aria-live="polite">{searchResult.index ? `${searchResult.index}/` : ''}{searchResult.total}</span><button className={`icon-button small ${caseSensitive ? 'active' : ''}`} aria-label="区分大小写" aria-pressed={caseSensitive} title="区分大小写" onClick={() => setCaseSensitive(v => !v)}>Aa</button><button className="icon-button small" aria-label="上一个匹配" onClick={() => nextMatch(-1)}><ArrowUp size={15} /></button><button className="icon-button small" aria-label="下一个匹配" onClick={() => nextMatch()}><ArrowDown size={15} /></button><button className="icon-button small" aria-label="关闭查找" onClick={() => { setFindOpen(false); setQuery('') }}><X size={16} /></button></div>
          {replaceOpen ? <div className="find-row replace-row"><Replace size={15} /><input aria-label="替换为" placeholder="替换为…" value={replacement} onChange={event => setReplacement(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !reading) { event.preventDefault(); search('replace') } }} /><button disabled={reading || !searchResult.total} onClick={() => search('replace')}>替换</button><button disabled={reading || !searchResult.total} onClick={() => search('all')}>全部替换</button></div> : <button className="expand-replace" onClick={() => setReplaceOpen(true)}>显示替换</button>}
        </div>}
        <div className={`document-scroll ${settings.focusMode && !reading ? 'focus-mode' : ''} ${settings.typewriter && !reading ? 'typewriter-mode' : ''}`} ref={scroll} onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault() }} onDrop={event => {
          const files = Array.from(event.dataTransfer.files)
          const markdown = files.find(file => /\.(md|markdown)$/i.test(file.name))
          if (markdown) { event.preventDefault(); event.stopPropagation(); run(() => open(window.desktop.droppedPath(markdown))) }
        }} onClick={event => {
          const anchor = (event.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null
          if (!anchor || !doc) return
          event.preventDefault()
          const href = anchor.getAttribute('href') ?? ''
          if (href.startsWith('#')) {
            const name = decodeURIComponent(href.slice(1)).toLocaleLowerCase()
            const target = Array.from(scroll.current!.querySelectorAll('h1,h2,h3,h4,h5,h6')).find(h => (h.textContent ?? '').trim().toLocaleLowerCase().replace(/\s+/g, '-') === name)
            target?.scrollIntoView({ behavior: 'smooth' })
          } else run(async () => unwrap(await window.desktop.openLink(doc.id, href)))
        }}>
          <div className={`document-paper ${sourceMode ? 'source-paper' : ''} ${reading ? 'reading' : ''}`} style={{ '--reader-font-size': `${17 * settings.zoom}px` } as React.CSSProperties}>
            <Suspense fallback={<div className="editor-loading">正在加载编辑器…</div>}>{doc && (sourceMode ? <SourceEditor key={`${doc.id}-${seed}`} ref={source} initial={initial} readonly={reading} theme={settings.theme} query={query} caseSensitive={caseSensitive} typewriter={settings.typewriter} onSearch={setSearchResult} onChange={change} /> : <RichEditor key={`${doc.id}-${seed}`} ref={editor} documentId={doc.id} initial={initial} readonly={reading} theme={settings.theme} query={query} caseSensitive={caseSensitive} focusMode={settings.focusMode} typewriter={settings.typewriter} onSearch={setSearchResult} onChange={change} onUpload={upload} onError={message => notify(message, true)} />)}</Suspense>
          </div>
        </div>
        <footer className="statusbar"><span className="status-left">{busy ? <><span className="busy-dot" />正在处理…</> : dirty ? <><span className="dirty-dot" />尚未保存</> : status ? <><Check size={12} />{status}</> : null}</span>{settings.focusMode && <button onClick={() => run(toggleFocus)} title="关闭焦点模式 · F8">焦点</button>}{settings.typewriter && <button onClick={() => run(toggleTypewriter)} title="关闭打字机模式 · F9">打字机</button>}<div className="stats-anchor"><button aria-label="字数统计" aria-expanded={statsOpen} onClick={() => setStatsOpen(v => !v)}>{stats.characters.toLocaleString()} 字</button>{statsOpen && <div className="stats-popover" role="dialog" aria-label="字数统计"><div className="stats-title">字数统计<button className="icon-button small" aria-label="关闭字数统计" onClick={() => setStatsOpen(false)}><X size={14} /></button></div><dl><dt>字符（不含空白）</dt><dd>{stats.characters.toLocaleString()}</dd><dt>字词</dt><dd>{stats.words.toLocaleString()}</dd><dt>段落</dt><dd>{stats.paragraphs}</dd><dt>源码行数</dt><dd>{stats.lines}</dd><dt>预计阅读</dt><dd>{stats.minutes} 分钟</dd></dl><small>中文按字、英文按词；不计图表源码。</small></div>}</div><span className="status-divider" /><button title="切换源码" onClick={toggleSource}>{sourceMode ? '源码' : '即时编辑'}</button><span className="status-divider" /><span>UTF-8</span></footer>
      </main>
    </div>
    {toast && <div className={`toast ${toast.error ? 'error' : ''}`} role="status">{toast.error ? <AlertCircle size={17} /> : <Check size={17} />}<span>{toast.text}</span><button aria-label="关闭提示" onClick={() => setToast(null)}><X size={14} /></button></div>}
    {quickOpen && <QuickOpen folder={folder} recent={settings.recentFiles} onClose={() => setQuickOpen(false)} onOpen={path => { setQuickOpen(false); run(() => open(path)) }} />}
    {drafts.length > 0 && <div className="modal-backdrop"><section className="recovery-dialog" role="dialog" aria-label="恢复草稿"><div className="recovery-icon"><RotateCcw size={24} /></div><h2>发现未保存的草稿</h2><p>选择恢复或丢弃。恢复后可另存文档。</p><div className="draft-list">{drafts.map(draft => <div key={draft.id}><FileText size={17} /><div><strong>{draft.name}</strong><span>{new Date(draft.updatedAt).toLocaleString('zh-CN')}</span></div><button className="text-button" onClick={() => run(async () => { unwrap(await window.desktop.discardDraft(draft.id)); setDrafts(old => old.filter(d => d.id !== draft.id)) })}>丢弃</button><button className="secondary-button" onClick={() => run(() => recover(draft.id))}>恢复</button></div>)}</div><button className="text-button later" onClick={() => setDrafts([])}>稍后处理</button></section></div>}
  </div>
}
