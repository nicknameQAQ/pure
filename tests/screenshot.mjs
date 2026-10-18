import { _electron as electron } from 'playwright'
import { promises as fs } from 'node:fs'
import { resolve, join } from 'node:path'
const root = resolve('test-results', `screenshot-${Date.now()}`)
const notes = join(root, '笔记')
await fs.mkdir(join(notes, '资料'), { recursive: true })
const file = join(notes, '日常记录.md')
await fs.writeFile(file, '# 日常记录\n\n把今天需要处理的事情记下来。\n\n## 待办\n\n- [x] 整理本地文档\n- [ ] 补充开发笔记\n- [ ] 保存本周的阅读记录\n\n## 一个流程\n\n```mermaid\nflowchart LR\n A[打开文档] --> B[编辑内容] --> C[保存文件]\n```\n\n公式也可以直接写：$E=mc^2$。\n')
await fs.writeFile(join(notes, '开发笔记.md'), '# 开发笔记')
await fs.writeFile(join(notes, '阅读清单.md'), '# 阅读清单')
const env = { ...process.env, PURE_USER_DATA_DIR: join(root, 'profile') }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: resolve('release/win-unpacked/pure.exe'), args: [], env })
try {
  const page = await app.firstWindow()
  await page.locator('.ProseMirror').waitFor()
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }) }, notes)
  await page.getByRole('button', { name: '打开文件夹', exact: true }).first().click()
  await page.getByRole('button', { name: '日常记录.md', exact: true }).click()
  await page.locator('.ProseMirror h1').filter({ hasText: '日常记录' }).waitFor()
  await page.locator('.milkdown-code-block').scrollIntoViewIfNeeded()
  await page.locator('.diagram svg').waitFor({ state: 'attached' })
  await page.locator('.document-scroll').evaluate(node => { node.style.scrollBehavior = 'auto'; node.scrollTop = 0 })
  await page.mouse.move(1100, 40)
  await page.waitForTimeout(300)
  await page.screenshot({ path: resolve('docs/screenshot.png'), scale: 'css' })
} finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}) }
