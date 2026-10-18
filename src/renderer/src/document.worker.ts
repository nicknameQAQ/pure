import { headings, statistics } from './document'
self.onmessage = (event: MessageEvent<{ version: number; text: string }>) => {
  const { version, text } = event.data
  self.postMessage({ version, outline: headings(text), stats: statistics(text) })
}
