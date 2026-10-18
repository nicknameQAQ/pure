import { useEffect, useRef, useState } from 'react'
import { RichEditor, waitForRichContent, type EditorHandle } from './Editor'
import type { PrintJob } from '../../shared/types'

export function PrintView({ ticket }: { ticket: string }) {
  const [job, setJob] = useState<PrintJob>()
  const [rendered, setRendered] = useState(false)
  const editor = useRef<EditorHandle>(null)
  const output = useRef<HTMLDivElement>(null)
  useEffect(() => {
    document.documentElement.dataset.theme = 'light'
    document.documentElement.classList.add('printing')
    document.body.classList.add('print-view')
    window.desktop.printJob(ticket).then(result => {
      if (result.ok) { document.title = result.value.title; setJob(result.value) }
      else window.desktop.printReady(ticket, result.error.message)
    }).catch(e => window.desktop.printReady(ticket, String(e)))
  }, [ticket])
  return job ? <main className="print-document"><div ref={output} />{!rendered && <div style={{ display: 'none' }}><RichEditor ref={editor} documentId={job.documentId} initial={job.markdown} readonly theme="light" query="" print onChange={() => {}} onUpload={async () => ''}
    onError={error => window.desktop.printReady(ticket, error)} onReady={() => {
      editor.current!.printDOM().then(async content => {
        output.current!.replaceChildren(content)
        setRendered(true)
        await waitForRichContent(output.current!)
        window.desktop.printReady(ticket)
      }).catch(e => window.desktop.printReady(ticket, String(e)))
    }} /></div>}</main> : null
}
