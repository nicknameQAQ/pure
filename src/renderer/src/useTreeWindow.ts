import { useEffect, useRef, useState } from 'react'
import type { TreeEntry } from '../../shared/types'

// A folder containing only files has fixed-height rows, so large lists can be
// windowed without guessing expanded subfolder heights.
export function useTreeWindow(entries: TreeEntry[], reveal: string, activePath?: string | null) {
  const root = useRef<HTMLDivElement>(null)
  const virtual = entries.length > 100 && entries.every(entry => !entry.directory)
  const [range, setRange] = useState({ start: 0, end: 60 })
  useEffect(() => {
    if (!virtual || !root.current) return
    const node = root.current
    const scroll = node.closest<HTMLElement>('.sidebar-scroll')!
    const offset = () => node.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop
    const update = () => {
      const start = Math.max(0, Math.floor((scroll.scrollTop - offset()) / 33) - 8)
      const end = Math.min(entries.length, start + Math.ceil(scroll.clientHeight / 33) + 18)
      setRange(old => old.start === start && old.end === end ? old : { start, end })
    }
    const index = entries.findIndex(entry => entry.path === activePath)
    if (index >= 0) scroll.scrollTo({ top: offset() + index * 33 - scroll.clientHeight / 3, behavior: 'instant' })
    update()
    scroll.addEventListener('scroll', update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(scroll)
    return () => { scroll.removeEventListener('scroll', update); observer.disconnect() }
  }, [entries, virtual, reveal])
  const start = virtual ? Math.min(range.start, entries.length) : 0
  const end = virtual ? Math.min(range.end, entries.length) : entries.length
  return { root, rows: entries.slice(start, end), style: virtual ? { paddingTop: start * 33, paddingBottom: (entries.length - end) * 33 } : undefined }
}
