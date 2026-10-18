import { useEffect, useRef, useState } from 'react'
import { FileText, Search, X } from 'lucide-react'
import type { FolderData } from '../../shared/types'
import { useDirectoryIndex } from './directoryIndex'

export function QuickOpen({ folder, recent, onOpen, onClose }: { folder: FolderData | null; recent: string[]; onOpen(path: string): void; onClose(): void }) {
  const indexData = useDirectoryIndex()
  const current = folder?.path === indexData.root
  const paths = [...new Set([...recent, ...(current ? indexData.files.map(file => file.path) : [])])]
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const status = !folder ? '最近打开的文档' : !current || indexData.loading ? '正在读取文件夹…' : `${paths.length} 个文档${indexData.truncated ? ' · 已达扫描上限' : ''}${indexData.failed ? ` · ${indexData.failed} 个目录无法读取` : ''}`
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    input.current?.focus()
  }, [folder?.path])
  const label = (path: string) => folder && path.startsWith(folder.path + '\\') ? path.slice(folder.path.length + 1) : path
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)
  const results = paths.filter(path => words.every(word => label(path).toLocaleLowerCase().includes(word))).slice(0, 100)
  const selected = Math.min(index, Math.max(0, results.length - 1))
  useEffect(() => { document.getElementById(`quick-file-${selected}`)?.scrollIntoView({ block: 'nearest' }) }, [selected])
  return <div className="modal-backdrop quick-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="quick-open" role="dialog" aria-label="快速打开" onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose() }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setIndex((selected + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % (results.length || 1)) }
      if (event.key === 'Enter' && results[selected]) { event.preventDefault(); onOpen(results[selected]) }
    }}>
      <div className="quick-input"><Search size={18} /><input ref={input} aria-label="快速打开文件" placeholder="输入文件名或路径…" value={query} onChange={event => { setQuery(event.target.value); setIndex(0) }} /><button className="icon-button small" aria-label="关闭快速打开" onClick={onClose}><X size={16} /></button></div>
      <div className="quick-results" role="listbox" aria-label="文档列表">{results.map((path, i) => <button id={`quick-file-${i}`} key={path} role="option" aria-selected={i === selected} className={i === selected ? 'selected' : ''} onClick={() => onOpen(path)}><FileText size={17} /><span><strong>{path.split(/[\\/]/).pop()}</strong><small>{label(path)}</small></span></button>)}{!results.length && <p>没有匹配的文档</p>}</div>
      <div className="quick-footer"><span>{status}</span><span>↑ ↓ 选择 · Enter 打开</span></div>
    </section>
  </div>
}
