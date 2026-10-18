import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Crepe, CrepeFeature } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state'
import { closeHistory } from '@milkdown/kit/prose/history'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { DOMSerializer, type Node as ProseNode } from '@milkdown/kit/prose/model'
import { $prose } from '@milkdown/kit/utils'
import { languages } from '@codemirror/language-data'
import DOMPurify from 'dompurify'
import katex from 'katex'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'
import 'katex/dist/katex.min.css'
import type { Theme } from '../../shared/types'
import { centerCursor, matchIndex, richMatches, type Match, type SearchHandle, type SearchResult } from './search'

export interface EditorHandle extends SearchHandle { flush(): string; revealHeading(index: number): void; printDOM(): Promise<HTMLElement> }
interface Props {
  documentId: string
  initial: string
  readonly: boolean
  theme: Theme
  query: string
  caseSensitive?: boolean
  focusMode?: boolean
  typewriter?: boolean
  onSearch?(result: SearchResult): void
  onChange(markdown: string): void
  onError(message: string): void
  onUpload(file: File): Promise<string>
  onReady?(): void
  print?: boolean
}

let mermaidModule: Promise<typeof import('mermaid')> | undefined
let diagramSequence = 0
const pendingRenders = new Set<Promise<unknown>>()
async function renderDiagram(content: string, theme: Theme) {
  mermaidModule ??= import('mermaid')
  const mermaid = (await mermaidModule).default
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', htmlLabels: false, theme: theme === 'dark' ? 'dark' : 'neutral', fontFamily: 'Microsoft YaHei, sans-serif', flowchart: { htmlLabels: false }, suppressErrorRendering: true })
  const { svg } = await mermaid.render(`diagram-${++diagramSequence}`, content)
  const container = document.createElement('div')
  container.className = 'diagram'
  container.dataset.source = content
  container.innerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } })
  return container
}
export async function waitForRichContent(root: HTMLElement) {
  // Source analyzers and diagram imports may enqueue more work while settling.
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  while (pendingRenders.size) await Promise.allSettled([...pendingRenders])
  await Promise.all(Array.from(root.querySelectorAll('img')).map(image => image.complete ? Promise.resolve() : new Promise<void>(resolve => {
    image.addEventListener('load', () => resolve(), { once: true })
    image.addEventListener('error', () => resolve(), { once: true })
    setTimeout(resolve, 12000)
  })))
  await document.fonts.ready
}

export const RichEditor = forwardRef<EditorHandle, Props>((props, ref) => {
  const root = useRef<HTMLDivElement>(null)
  const editor = useRef<Crepe | null>(null)
  const latest = useRef(props)
  latest.current = props
  const [error, setError] = useState('')
  const baseline = useRef({ serialized: '', original: props.initial })
  const findKey = useRef(new PluginKey<DecorationSet>('sujian-find'))
  const searchOptions = () => ({ query: latest.current.query, caseSensitive: !!latest.current.caseSensitive })
  const matchCache = useRef<{ doc: ProseNode; query: string; caseSensitive: boolean; items: Match[] } | null>(null)
  const lastSearch = useRef({ total: -1, index: -1 })
  const getMatches = (doc: ProseNode) => {
    const options = searchOptions()
    if (matchCache.current?.doc !== doc || matchCache.current.query !== options.query || matchCache.current.caseSensitive !== options.caseSensitive)
      matchCache.current = { doc, ...options, items: richMatches(doc, options) }
    return matchCache.current.items
  }
  useImperativeHandle(ref, () => ({
    flush: () => {
      if (!editor.current) return latest.current.initial
      const markdown = editor.current.getMarkdown()
      return markdown === baseline.current.serialized ? baseline.current.original : markdown
    },
    revealHeading: index => root.current?.querySelectorAll('h1,h2,h3,h4,h5,h6')[index]?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    search: (action, replacement = '') => {
      if (!editor.current) return { total: 0, index: 0 }
      return editor.current.editor.action(ctx => {
        const view = ctx.get(editorViewCtx)
        let items = getMatches(view.state.doc)
        let current = items.findIndex(item => item.from === view.state.selection.from && item.to === view.state.selection.to)
        if (!latest.current.readonly && action === 'all' && items.length) {
          const tr = closeHistory(view.state.tr)
          for (const item of [...items].reverse()) tr.insertText(replacement, item.from, item.to)
          view.dispatch(tr)
          view.dispatch(closeHistory(view.state.tr))
          latest.current.onChange(editor.current!.getMarkdown())
          return { total: getMatches(view.state.doc).length, index: 0 }
        }
        if (!latest.current.readonly && action === 'replace' && current >= 0) {
          const item = items[current]
          view.dispatch(closeHistory(view.state.tr).insertText(replacement, item.from, item.to))
          view.dispatch(closeHistory(view.state.tr))
          latest.current.onChange(editor.current!.getMarkdown())
          items = getMatches(view.state.doc)
        }
        current = matchIndex(items, view.state.selection.from, view.state.selection.to, action === 'previous')
        if (current >= 0) view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, items[current].from, items[current].to)).scrollIntoView())
        return { total: items.length, index: current + 1 }
      })
    },
    printDOM: async () => {
      if (!editor.current) throw new Error('打印编辑器尚未准备好。')
      const doc = editor.current.editor.action(ctx => ctx.get(editorViewCtx).state.doc)
      const wrapper = document.createElement('div')
      wrapper.className = 'rich-editor'
      const milkdown = document.createElement('div')
      milkdown.className = 'milkdown'
      const content = document.createElement('div')
      content.className = 'ProseMirror'
      content.append(DOMSerializer.fromSchema(doc.type.schema).serializeFragment(doc.content))
      const blocks: { language: string; text: string }[] = []
      doc.descendants(node => { if (node.type.name === 'code_block') blocks.push({ language: node.attrs.language ?? '', text: node.textContent }) })
      // Serialize the model, not viewport-dependent CodeMirror node views: every
      // off-screen formula and diagram must exist in the PDF as well.
      await Promise.all(Array.from(content.querySelectorAll('pre')).map(async (pre, index) => {
        const block = blocks[index]
        if (!block) return
        const output = document.createElement('div')
        output.className = 'milkdown-code-block'
        if (block.language === 'mermaid') {
          try { output.append(await renderDiagram(block.text, 'light')) }
          catch { const error = document.createElement('small'); error.textContent = '图表语法错误，以下为原始内容。'; output.append(error, pre.cloneNode(true)) }
        } else if (block.language.toLowerCase() === 'latex') {
          output.innerHTML = katex.renderToString(block.text, { displayMode: true, throwOnError: false, trust: false })
        } else output.append(pre.cloneNode(true))
        pre.replaceWith(output)
      }))
      for (const image of content.querySelectorAll('img')) {
        const reference = image.getAttribute('src') ?? ''
        if (!/^(https?:|data:|blob:|pure-asset:)/i.test(reference)) image.src = window.desktop.assetURL(props.documentId, reference)
      }
      milkdown.append(content); wrapper.append(milkdown)
      return wrapper
    },
  }))
  useEffect(() => {
    let disposed = false
    let active = false
    const crepe = new Crepe({
      root: root.current!, defaultValue: props.initial,
      features: { [CrepeFeature.TopBar]: false, [CrepeFeature.AI]: false, [CrepeFeature.Placeholder]: false, [CrepeFeature.BlockEdit]: !props.print },
      featureConfigs: {
        [CrepeFeature.BlockEdit]: {
          textGroup: { label: '文字', text: { label: '正文' }, h1: { label: '一级标题' }, h2: { label: '二级标题' }, h3: { label: '三级标题' }, h4: { label: '四级标题' }, h5: { label: '五级标题' }, h6: { label: '六级标题' }, quote: { label: '引用' }, divider: { label: '分隔线' } },
          listGroup: { label: '列表', bulletList: { label: '无序列表' }, orderedList: { label: '有序列表' }, taskList: { label: '任务列表' } },
          advancedGroup: { label: '插入', image: { label: '图片' }, codeBlock: { label: '代码块' }, table: { label: '表格' }, math: { label: '数学公式' } },
        },
        [CrepeFeature.CodeMirror]: {
          languages, copyText: '复制', searchPlaceholder: '查找语言', noResultText: '没有匹配的语言', previewLabel: '预览', previewLoading: '正在绘制…', previewToggleText: mode => mode ? '编辑' : '收起源码', previewOnlyByDefault: true,
          renderPreview: (language, content, applyPreview) => {
            if (language !== 'mermaid') return null
            const task = renderDiagram(content, latest.current.theme).then(element => { if (!disposed) applyPreview(element) }).catch(e => {
              if (disposed) return
              const fallback = document.createElement('div')
              fallback.className = 'diagram-error'
              const label = document.createElement('small')
              label.textContent = '图表暂时无法绘制，请检查语法。'
              const code = document.createElement('pre')
              code.textContent = content
              fallback.append(label, code)
              fallback.title = String(e)
              applyPreview(fallback)
            })
            pendingRenders.add(task)
            task.finally(() => pendingRenders.delete(task))
            return undefined
          },
        },
        [CrepeFeature.Latex]: { katexOptions: { throwOnError: false, trust: false, strict: 'ignore' } },
        [CrepeFeature.ImageBlock]: {
          onUpload: file => latest.current.onUpload(file),
          proxyDomURL: url => /^(https?:|data:|blob:|pure-asset:)/i.test(url) ? url : window.desktop.assetURL(props.documentId, url),
          inlineUploadButton: '选择图片', inlineUploadPlaceholderText: '或粘贴图片地址', blockUploadButton: '选择图片', blockConfirmButton: '插入', blockCaptionPlaceholderText: '添加说明', blockUploadPlaceholderText: '或粘贴图片地址',
        },
      },
    })
    const find = $prose(() => new Plugin<DecorationSet>({
      key: findKey.current,
      state: {
        init: () => DecorationSet.empty,
        apply(tr, previous) {
          const query = tr.getMeta(findKey.current) ?? (tr.docChanged ? latest.current.query : undefined)
          if (typeof query !== 'string') return previous.map(tr.mapping, tr.doc)
          return DecorationSet.create(tr.doc, getMatches(tr.doc).map(item => Decoration.inline(item.from, item.to, { class: 'search-hit' })))
        },
      },
      props: { decorations: state => findKey.current.getState(state) },
      view: view => ({ update(view, previous) {
        if (view.state.doc !== previous.doc || !view.state.selection.eq(previous.selection) || findKey.current.getState(view.state) !== findKey.current.getState(previous)) {
          const items = getMatches(view.state.doc)
          const index = items.findIndex(item => item.from === view.state.selection.from && item.to === view.state.selection.to)
          const result = { total: items.length, index: index + 1 }
          if (result.total !== lastSearch.current.total || result.index !== lastSearch.current.index) {
            lastSearch.current = result
            queueMicrotask(() => { if (!disposed) latest.current.onSearch?.(result) })
          }
        }
        if (view.state.doc !== previous.doc || !view.state.selection.eq(previous.selection)) {
          if (latest.current.typewriter && !latest.current.readonly && view.hasFocus()) requestAnimationFrame(() => {
            if (disposed) return
            const rect = view.coordsAtPos(view.state.selection.head)
            centerCursor(view.dom, rect.top, rect.bottom)
          })
        }
      } }),
    }))
    const focus = $prose(() => new Plugin({ props: { decorations: state => {
      if (!latest.current.focusMode || latest.current.readonly || !state.selection.$from.depth) return null
      const from = state.selection.$from.before(1)
      return DecorationSet.create(state.doc, [Decoration.node(from, from + state.doc.nodeAt(from)!.nodeSize, { class: 'focus-active' })])
    } } }))
    crepe.editor.use(find).use(focus)
    crepe.on(listener => listener.markdownUpdated((_ctx, markdown) => {
      if (active && !disposed) latest.current.onChange(markdown)
    }))
    const creation = crepe.create().then(async () => {
      if (disposed) return
      editor.current = crepe
      baseline.current = { serialized: crepe.getMarkdown(), original: props.initial }
      crepe.setReadonly(latest.current.readonly)
      active = true
      crepe.editor.action(ctx => { const view = ctx.get(editorViewCtx); view.dispatch(view.state.tr.setMeta(findKey.current, latest.current.query)) })
      latest.current.onReady?.()
    }).catch(e => { if (!disposed) { setError(String(e)); latest.current.onError('编辑器加载失败，可切换到源码模式继续编辑。') } })
    return () => { disposed = true; active = false; editor.current = null; creation.then(() => crepe.destroy()).catch(() => {}) }
  }, [props.documentId])
  useEffect(() => {
    let canceled = false
    for (const diagram of root.current?.querySelectorAll<HTMLElement>('.diagram[data-source]') ?? []) {
      const task = renderDiagram(diagram.dataset.source ?? '', props.theme).then(fresh => {
        if (!canceled && diagram.isConnected) diagram.replaceChildren(...Array.from(fresh.childNodes))
      }).catch(() => {})
      pendingRenders.add(task)
      task.finally(() => pendingRenders.delete(task))
    }
    return () => { canceled = true }
  }, [props.theme])
  useEffect(() => { editor.current?.setReadonly(props.readonly) }, [props.readonly])
  useEffect(() => {
    const timer = setTimeout(() => editor.current?.editor.action(ctx => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.setMeta(findKey.current, props.query))
    }), 50)
    return () => clearTimeout(timer)
  }, [props.query, props.caseSensitive])
  useEffect(() => { editor.current?.editor.action(ctx => { const view = ctx.get(editorViewCtx); view.dispatch(view.state.tr) }) }, [props.focusMode, props.readonly])
  return <div className="rich-editor" ref={root}>{error && <div className="editor-error">加载失败：{error}</div>}</div>
})
