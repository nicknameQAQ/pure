import { useEffect, useMemo, useRef, useState } from 'react'
import { headings, statistics } from './document'

export function useDocumentMetrics(text: string) {
  const small = useMemo(() => text.length < 20000 ? { outline: headings(text), stats: statistics(text) } : null, [text])
  const [large, setLarge] = useState(() => ({ outline: headings(''), stats: statistics('') }))
  const worker = useRef<Worker | null>(null)
  const version = useRef(0)
  useEffect(() => () => { worker.current?.terminate() }, [])
  useEffect(() => {
    const current = ++version.current
    if (small) return
    const timer = setTimeout(() => {
      if (!worker.current) {
        worker.current = new Worker(new URL('./document.worker.ts', import.meta.url), { type: 'module' })
        worker.current.onmessage = event => { if (event.data.version === version.current) setLarge({ outline: event.data.outline, stats: event.data.stats }) }
      }
      worker.current.postMessage({ version: current, text })
    }, 250)
    return () => clearTimeout(timer)
  }, [text, small])
  return small ?? large
}
