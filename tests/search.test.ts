import { expect, it } from 'vitest'
import { Schema } from '@milkdown/kit/prose/model'
import { matches, richMatches, matchIndex } from '../src/renderer/src/search'
import { statistics } from '../src/renderer/src/document'

it('查找按字面量匹配，保留 Unicode 的原始位置与大小写选项', () => {
  expect(matches('a.b A.B aXb', { query: 'a.b', caseSensitive: false })).toEqual([{ from: 0, to: 3 }, { from: 4, to: 7 }])
  expect(matches('a.b A.B', { query: 'a.b', caseSensitive: true })).toEqual([{ from: 0, to: 3 }])
  expect(matches('İ i 😀中文😀', { query: '😀', caseSensitive: false })).toEqual([{ from: 4, to: 6 }, { from: 8, to: 10 }])
  expect(matches('文字', { query: '', caseSensitive: false })).toEqual([])
})
it('即时编辑能跨越粗体文本节点查找，不跨越段落或行内公式', () => {
  const schema = new Schema({ nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'inline*' }, text: { group: 'inline' }, math: { group: 'inline', inline: true, atom: true } }, marks: { strong: {} } })
  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, [schema.text('前半'), schema.text('加粗', [schema.mark('strong')]), schema.text('后半')]),
    schema.node('paragraph', null, [schema.text('公式'), schema.node('math'), schema.text('结束')]),
  ])
  expect(richMatches(doc, { query: '半加粗后', caseSensitive: false })).toEqual([{ from: 2, to: 6 }])
  expect(richMatches(doc, { query: '后半公式', caseSensitive: false })).toEqual([])
  expect(richMatches(doc, { query: '公式结束', caseSensitive: false })).toEqual([])
})
it('查找导航前后循环，空结果不产生无效位置', () => {
  const items = [{ from: 1, to: 3 }, { from: 7, to: 9 }]
  expect(matchIndex(items, 1, 3)).toBe(1)
  expect(matchIndex(items, 7, 9)).toBe(0)
  expect(matchIndex(items, 1, 3, true)).toBe(1)
  expect(matchIndex([], 0, 0)).toBe(-1)
})
it('统计按中文字符与英文单词计数，剔除图片和图表源码', () => {
  const value = statistics('# 中文hello 世界\n\n![图片](test.png)\n\n```mermaid\nflowchart LR\n A --> B\n```')
  expect(value.words).toBe(5)
  expect(value.characters).toBe(9)
  expect(value.minutes).toBe(1)
  expect(statistics('').minutes).toBe(0)
})
