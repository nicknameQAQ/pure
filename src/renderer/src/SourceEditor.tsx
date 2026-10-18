import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { oneDark } from '@codemirror/theme-one-dark'
import { SearchQuery, setSearchQuery } from '@codemirror/search'
import { isolateHistory } from '@codemirror/commands'
import type { Theme } from '../../shared/types'
import { centerCursor, matches, matchIndex, type Match, type SearchHandle, type SearchResult } from './search'

export interface SourceHandle extends SearchHandle { flush(): string; revealLine(line: number): void }
interface Props { initial: string; readonly: boolean; theme: Theme; query: string; caseSensitive?: boolean; typewriter?: boolean; onSearch?(result: SearchResult): void; onChange(value: string): void }
export const SourceEditor = forwardRef<SourceHandle, Props>((props, ref) => {
  const root = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const theme = useRef(new Compartment())
  const readonly = useRef(new Compartment())
  const onChange = useRef(props.onChange)
  const latest = useRef(props)
  latest.current = props
  const matchCache = useRef<{ doc: EditorState['doc']; query: string; caseSensitive: boolean; items: Match[] } | null>(null)
  const lastSearch = useRef({ total: -1, index: -1 })
  const getMatches = (state: EditorState) => {
    const options = { query: latest.current.query, caseSensitive: !!latest.current.caseSensitive }
    if (matchCache.current?.doc !== state.doc || matchCache.current.query !== options.query || matchCache.current.caseSensitive !== options.caseSensitive)
      matchCache.current = { doc: state.doc, ...options, items: options.query ? matches(state.doc.toString(), options) : [] }
    return matchCache.current.items
  }
  onChange.current = props.onChange
  useImperativeHandle(ref, () => ({
    flush: () => view.current?.state.doc.toString() ?? props.initial,
    search: (action, replacement = '') => {
      const editor = view.current
      if (!editor) return { total: 0, index: 0 }
      const options = { query: latest.current.query, caseSensitive: !!latest.current.caseSensitive }
      let items = getMatches(editor.state)
      let current = items.findIndex(item => item.from === editor.state.selection.main.from && item.to === editor.state.selection.main.to)
      if (!latest.current.readonly && action === 'all' && items.length) {
        editor.dispatch({ changes: items.map(item => ({ ...item, insert: replacement })), annotations: isolateHistory.of('full'), userEvent: 'input.replace.all' })
        return { total: getMatches(editor.state).length, index: 0 }
      }
      if (!latest.current.readonly && action === 'replace' && current >= 0) {
        const item = items[current]
        editor.dispatch({ changes: { ...item, insert: replacement }, selection: { anchor: item.from + replacement.length }, annotations: isolateHistory.of('full'), userEvent: 'input.replace' })
        items = getMatches(editor.state)
      }
      current = matchIndex(items, editor.state.selection.main.from, editor.state.selection.main.to, action === 'previous')
      if (current >= 0) editor.dispatch({ selection: { anchor: items[current].from, head: items[current].to }, effects: EditorView.scrollIntoView(items[current].from, { y: 'center' }) })
      return { total: items.length, index: current + 1 }
    },
    revealLine: n => {
      if (!view.current) return
      const pos = view.current.state.doc.line(Math.min(n, view.current.state.doc.lines)).from
      view.current.dispatch({ effects: EditorView.scrollIntoView(pos, { y: 'start' }) })
    },
  }))
  useEffect(() => {
    const editor = new EditorView({ parent: root.current!, state: EditorState.create({ doc: props.initial, extensions: [
      basicSetup, markdown({ codeLanguages: languages }), EditorView.lineWrapping,
      readonly.current.of([EditorState.readOnly.of(props.readonly), EditorView.editable.of(!props.readonly)]),
      theme.current.of(props.theme === 'dark' ? oneDark : []),
      EditorView.updateListener.of(update => {
        if (update.docChanged) onChange.current(update.state.doc.toString())
        if (update.docChanged || update.selectionSet) {
          const items = getMatches(update.state)
          const selection = update.state.selection.main
          const result = { total: items.length, index: items.findIndex(item => item.from === selection.from && item.to === selection.to) + 1 }
          if (lastSearch.current.total !== result.total || lastSearch.current.index !== result.index) { lastSearch.current = result; latest.current.onSearch?.(result) }
          if (latest.current.typewriter && !latest.current.readonly && update.view.hasFocus) requestAnimationFrame(() => {
            if (!view.current) return
            const rect = update.view.coordsAtPos(update.view.state.selection.main.head)
            if (rect) centerCursor(update.view.dom, rect.top, rect.bottom)
          })
        }
      }),
    ] }) })
    view.current = editor
    return () => { view.current = null; editor.destroy() }
  }, [])
  useEffect(() => { view.current?.dispatch({ effects: theme.current.reconfigure(props.theme === 'dark' ? oneDark : []) }) }, [props.theme])
  useEffect(() => { view.current?.dispatch({ effects: readonly.current.reconfigure([EditorState.readOnly.of(props.readonly), EditorView.editable.of(!props.readonly)]) }) }, [props.readonly])
  useEffect(() => {
    view.current?.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: props.query, caseSensitive: !!props.caseSensitive, literal: true })) })
    props.onSearch?.({ total: matches(view.current?.state.doc.toString() ?? props.initial, { query: props.query, caseSensitive: !!props.caseSensitive }).length, index: 0 })
  }, [props.query, props.caseSensitive])
  return <div className="source-editor" ref={root} />
})
