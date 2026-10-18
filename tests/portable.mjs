import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { promises as fs } from 'node:fs'
import { resolve, join } from 'node:path'
import assert from 'node:assert/strict'

const root = resolve('test-results', `portable-${Date.now()}`)
await fs.mkdir(root, { recursive: true })
const file = join(root, '实际便携版.md')
await fs.writeFile(file, '# Markdown 笔记\n\n这是一篇本地 Markdown 文档。\n\n## 编辑与导航\n\n- Ctrl+H：查找和替换\n- Ctrl+P：快速打开文档\n- F8：焦点模式\n- F9：打字机模式\n\n## 图表与公式\n\n```mermaid\nflowchart LR\n A[开始阅读] --> B[整理想法] --> C[写下答案]\n```\n\n行内公式 $E=mc^2$。\n\n支持手动保存和导出 PDF。\n')
const server = createServer()
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
await new Promise(resolve => server.close(resolve))
const env = { ...process.env, PURE_USER_DATA_DIR: join(root, 'profile') }
delete env.ELECTRON_RUN_AS_NODE
const { version } = JSON.parse(await fs.readFile('package.json', 'utf8'))
const executable = resolve(`release/pure-${version}-x64-portable.exe`)
const child = spawn(executable, [`--remote-debugging-port=${port}`, file], { cwd: process.cwd(), env, windowsHide: true, stdio: 'ignore' })
let browser
let page
try {
  let endpoint = false
  for (let i = 0; i < 200; i++) {
    try { const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) }); if (response.ok) { endpoint = true; break } } catch {}
    await new Promise(resolve => setTimeout(resolve, 150))
  }
  assert.ok(endpoint, 'Portable executable did not start its renderer')
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  page = browser.contexts()[0].pages()[0]
  await page.locator('.document-title').filter({ hasText: '实际便携版.md' }).waitFor()
  await page.bringToFront()
  await page.locator('.ProseMirror > p').last().click()
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Enter')
  await page.keyboard.insertText('免安装 EXE 已完成打开、即时编辑与保存。')
  await page.locator('.dirty-dot[title="尚未保存"]').waitFor()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  let saved = false
  for (let i = 0; i < 80; i++) { if ((await fs.readFile(file, 'utf8')).includes('免安装 EXE 已完成打开、即时编辑与保存。')) { saved = true; break } await new Promise(resolve => setTimeout(resolve, 100)) }
  assert.ok(saved)
  await page.locator('.milkdown-code-block').scrollIntoViewIfNeeded()
  await page.locator('.diagram svg').waitFor({ state: 'attached' })
  assert.ok((await page.locator('.diagram svg').textContent()).includes('开始阅读'))
  await page.locator('.document-scroll').evaluate(node => { node.style.scrollBehavior = 'auto'; node.scrollTop = 0 })
  await page.waitForTimeout(300)
  await page.screenshot({ path: resolve('release/preview.png') })
  await fs.writeFile(join(root, 'results.json'), JSON.stringify({ executable, file, checks: ['实际 portable EXE 解包启动', '命令行打开中文路径', '即时编辑与保存按钮', '公式与 Mermaid 节点文字', '本地预览截图'] }, null, 2))
  console.log(`PORTABLE_RESULTS ${root}`)
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: join(root, 'failure.png') }).catch(() => {})
    await fs.writeFile(join(root, 'failure.json'), JSON.stringify({ error: String(error), body: await page.locator('body').innerText() }, null, 2))
  }
  throw error
} finally {
  if (page && !page.isClosed()) await page.evaluate(() => window.desktop.close()).catch(() => {})
  await browser?.close().catch(() => {})
  if (!child.killed) child.kill()
}
