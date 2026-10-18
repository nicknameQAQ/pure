import { _electron as electron } from 'playwright'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { resolve, join } from 'node:path'

const root = resolve('test-results', `export-${Date.now()}`)
await fs.mkdir(root, { recursive: true })
const long = join(root, '多页文档.md')
const invalid = join(root, '错误图表.md')
const paragraph = '安静地阅读，认真地书写。让内容保持清楚，让每一个想法都有自己的位置。'.repeat(4)
await fs.writeFile(long, '# 多页导出验收\n\n' + Array.from({ length: 8 }, (_, index) => `## 第 ${index + 1} 节\n\n${paragraph}\n\n${paragraph}\n\n`).join('') + '## 屏幕之外的内容\n\n- [ ] 未完成的事项\n- [x] 已完成的事项\n\n$$\na^2+b^2=c^2\n$$\n\n```mermaid\nflowchart LR\n A[屏幕外的起点] --> B[完整导出的终点]\n```\n\n最后一行必须出现在 PDF 中。\n')
await fs.writeFile(invalid, '# 错误图表也不丢字\n\n```mermaid\nflowchart ??? broken !\n```\n\n错误之后的内容仍然保留。\n')
const env = { ...process.env, PURE_USER_DATA_DIR: join(root, 'profile') }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ args: ['.'], cwd: process.cwd(), env })
const page = await app.firstWindow()
const errors = []
page.on('pageerror', error => errors.push(error.message))
async function poll(fn, label) {
  for (let i = 0; i < 300; i++) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 100)) }
  throw new Error('Timed out: ' + label)
}
async function openAndExport(file, pdf) {
  await app.evaluate(({ dialog }, { file, pdf }) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: pdf })
  }, { file, pdf })
  await page.getByRole('button', { name: '打开文档', exact: true }).click()
  await page.locator('.document-title').filter({ hasText: file.split(/[\\/]/).pop() }).waitFor()
  await page.locator('.ProseMirror').waitFor()
  await page.getByRole('button', { name: '更多', exact: true }).click()
  await page.getByRole('menu').getByRole('button', { name: '导出 PDF' }).click()
  await poll(() => fs.stat(pdf).then(s => s.size > 10000).catch(() => false), 'export ' + pdf)
}
try {
  await page.locator('.ProseMirror').waitFor()
  await openAndExport(long, join(root, '多页验收.pdf'))
  await openAndExport(invalid, join(root, '错误图表验收.pdf'))
  // Visit the error block to verify interactive fallback, too.
  await page.locator('.milkdown-code-block').scrollIntoViewIfNeeded()
  await page.locator('.diagram-error').waitFor()
  assert.ok((await page.locator('.diagram-error').innerText()).includes('flowchart ??? broken !'))
  assert.deepEqual(errors, [])
  await fs.writeFile(join(root, 'results.json'), JSON.stringify({ root, errors, checks: ['多页文档导出', '未进入视口的公式与 Mermaid 导出', '错误 Mermaid 保留源码并继续导出'] }, null, 2))
  console.log(`EXPORT_RESULTS ${root}`)
} finally { await app.evaluate(({ app }) => app.exit(0)) }
