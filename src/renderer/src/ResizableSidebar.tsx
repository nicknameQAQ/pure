import { useEffect, useRef, useState, type ReactNode } from 'react'

export function ResizableSidebar({ width, onWidth, children }: { width: number; onWidth(value: number): void; children: ReactNode }) {
  const root = useRef<HTMLElement>(null)
  const start = useRef<{ x: number; width: number } | null>(null)
  const draft = useRef(width)
  const persist = useRef(onWidth)
  persist.current = onWidth
  const [max, setMax] = useState(() => Math.min(600, window.innerWidth - 360))
  const clamp = (value: number) => Math.round(Math.min(max, Math.max(180, value)))
  useEffect(() => () => { if (start.current) document.body.classList.remove('resizing-sidebar') }, [])
  useEffect(() => {
    const resize = () => setMax(Math.min(600, window.innerWidth - 360))
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  useEffect(() => { if (!start.current) { draft.current = clamp(width); root.current?.style.setProperty('--sidebar-width', `${draft.current}px`) } }, [width, max])
  return <aside className="sidebar" ref={root} style={{ '--sidebar-width': `${clamp(width)}px` } as React.CSSProperties}>
    {children}
    <div className="sidebar-resizer" role="separator" aria-label="调整侧栏宽度" aria-orientation="vertical" aria-valuemin={180} aria-valuemax={max} aria-valuenow={clamp(width)} tabIndex={0}
      onDoubleClick={() => persist.current(256)} onKeyDown={event => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); persist.current(clamp(width + (event.key === 'ArrowLeft' ? -10 : 10))) }
        if (event.key === 'Home') { event.preventDefault(); persist.current(180) }
      }}
      onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); start.current = { x: event.clientX, width: root.current!.getBoundingClientRect().width }; draft.current = start.current.width; event.currentTarget.setPointerCapture(event.pointerId); document.body.classList.add('resizing-sidebar') }}
      onPointerMove={event => { if (!start.current) return; draft.current = clamp(start.current.width + event.clientX - start.current.x); root.current?.style.setProperty('--sidebar-width', `${draft.current}px`); event.currentTarget.setAttribute('aria-valuenow', String(draft.current)) }}
      onPointerUp={event => { if (!start.current) return; start.current = null; document.body.classList.remove('resizing-sidebar'); event.currentTarget.releasePointerCapture(event.pointerId); persist.current(draft.current) }}
      onLostPointerCapture={() => { if (start.current) { start.current = null; document.body.classList.remove('resizing-sidebar'); persist.current(draft.current) } }} />
  </aside>
}
