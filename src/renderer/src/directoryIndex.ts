import { useSyncExternalStore } from 'react'
import type { TreeEntry } from '../../shared/types'

const cache = new Map<string, Promise<TreeEntry[]>>()
const listeners = new Set<() => void>()
let generation = 0
let timer: ReturnType<typeof setTimeout> | undefined
let snapshot = { root: '', files: [] as TreeEntry[], loading: false, truncated: false, failed: 0 }
function publish(patch: Partial<typeof snapshot>) { snapshot = { ...snapshot, ...patch }; listeners.forEach(fn => fn()) }
export function readDirectory(path: string) {
  let result = cache.get(path)
  if (!result) {
    result = window.desktop.listDirectory(path).then(result => {
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    })
    cache.set(path, result)
    result.catch(() => { if (cache.get(path) === result) cache.delete(path) })
  }
  return result
}
async function scan(root: string) {
  const current = ++generation
  publish({ root, loading: true, failed: 0 })
  const files: TreeEntry[] = []
  const pending = [root]
  let visited = 0
  let failed = 0
  let lastPublished = performance.now()
  while (pending.length && files.length < 5000 && visited < 1000) {
    const paths = pending.splice(0, Math.min(4, 1000 - visited))
    const entries = await Promise.allSettled(paths.map(readDirectory))
    if (current !== generation) return
    visited += paths.length
    for (const result of entries) {
      if (result.status === 'rejected') { failed++; continue }
      for (const entry of result.value) {
        if (entry.directory) pending.push(entry.path)
        else if (files.length < 5000) files.push(entry)
      }
    }
    if (performance.now() - lastPublished > 100) { publish({ files: [...files], failed }); lastPublished = performance.now() }
  }
  if (current === generation) publish({ files, loading: false, truncated: pending.length > 0 || files.length >= 5000, failed })
}
export function setDirectoryRoot(root: string) {
  if (snapshot.root === root) return
  clearTimeout(timer); generation++; cache.clear()
  publish({ root, files: [], loading: !!root, failed: 0, truncated: false })
  if (root) void scan(root)
}
export function invalidateDirectories(paths: string[]) {
  for (const path of paths) for (const key of cache.keys()) if (key === path || key.startsWith(path.replace(/[\\/]+$/, '') + '\\')) cache.delete(key)
  if (snapshot.root) {
    clearTimeout(timer); generation++
    timer = setTimeout(() => { if (snapshot.root) void scan(snapshot.root) }, 100)
  }
}
export function useDirectoryIndex() { return useSyncExternalStore(fn => { listeners.add(fn); return () => listeners.delete(fn) }, () => snapshot) }
