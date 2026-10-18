import type { Node } from '@milkdown/kit/prose/model'

export interface Match { from: number; to: number }
export interface SearchResult { total: number; index: number }
export type SearchAction = 'next' | 'previous' | 'replace' | 'all'
export interface SearchOptions { query: string; caseSensitive: boolean }
export interface SearchHandle { search(action: SearchAction, replacement?: string): SearchResult }
export function matches(text: string, options: SearchOptions): Match[] {
  if (!options.query) return []
  const pattern = options.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const expression = new RegExp(pattern, options.caseSensitive ? 'gu' : 'giu')
  return Array.from(text.matchAll(expression), match => ({ from: match.index!, to: match.index! + match[0].length }))
}
// Textblock offsets also cover adjacent text nodes with different formatting.
// Inline atoms occupy one position and cannot be accidentally matched through.
export function richMatches(doc: Node, options: SearchOptions): Match[] {
  const result: Match[] = []
  if (!options.query) return result
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return
    const text = node.textBetween(0, node.content.size, '', '\ufffc')
    for (const match of matches(text, options)) result.push({ from: pos + 1 + match.from, to: pos + 1 + match.to })
    return false
  })
  return result
}
export function matchIndex(items: Match[], from: number, to: number, backwards = false) {
  if (!items.length) return -1
  if (backwards) {
    for (let index = items.length - 1; index >= 0; index--) if (items[index].to <= from && items[index].from !== from) return index
    return items.length - 1
  }
  const index = items.findIndex(item => item.from >= to && !(item.from === from && item.to === to))
  return index < 0 ? 0 : index
}
export function centerCursor(element: HTMLElement, top: number, bottom: number) {
  const scroll = element.closest<HTMLElement>('.document-scroll')
  if (!scroll) return
  const target = scroll.getBoundingClientRect().top + scroll.clientHeight * 0.45
  scroll.scrollBy({ top: (top + bottom) / 2 - target, behavior: 'instant' })
}
