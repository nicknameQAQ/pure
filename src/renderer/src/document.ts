export interface Heading { text: string; level: number; line: number }
export function headings(markdown: string): Heading[] {
  const result: Heading[] = []
  let fence: { marker: string; length: number } | null = null
  const lines = markdown.split('\n')
  lines.forEach((line, index) => {
    const boundary = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
    if (boundary) {
      if (!fence) fence = { marker: boundary[1][0], length: boundary[1].length }
      else if (boundary[1][0] === fence.marker && boundary[1].length >= fence.length && !boundary[2].trim()) fence = null
      return
    }
    if (fence) return
    const match = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (match) result.push({ text: match[2].replace(/[*_`]/g, ''), level: match[1].length, line: index + 1 })
    else if (/^ {0,3}(=+|-+)\s*$/.test(line) && index > 0) {
      const previous = lines[index - 1]
      if (previous.trim() && !/^\s*(#|>|[-*+]\s|\d+[.)]\s|`{3,}|~{3,})/.test(previous) && !/^ {4}/.test(previous))
        result.push({ text: previous.trim().replace(/[*_`]/g, ''), level: line.trim()[0] === '=' ? 1 : 2, line: index })
    }
  })
  return result
}
export function statistics(markdown: string) {
  const plain = markdown
    .replace(/(^|\n) {0,3}(`{3,}|~{3,})(?:mermaid|latex|math)\b[^\n]*\n[\s\S]*?\n {0,3}\2(?=\s|$)/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+(?:\[[ xX]\]\s*)?|\d+[.)]\s+)/gm, '')
    .replace(/^\s*(?:`{3,}|~{3,})[^\n]*$/gm, '')
    .replace(/[*_`~]/g, '')
  const characters = Array.from(plain.replace(/\s/g, '')).length
  const words = plain.replace(/(\p{Script=Han})/gu, ' $1 ').match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0
  return { characters, words, paragraphs: plain.split(/\n\s*\n/).filter(p => p.trim()).length, lines: markdown ? markdown.split('\n').length : 0, minutes: words ? Math.max(1, Math.ceil(words / 300)) : 0 }
}
