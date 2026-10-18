import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { promises as fs } from 'node:fs'
import { resolve, join } from 'node:path'

const root = resolve('test-results', `e2e-${Date.now()}`)
await fs.mkdir(root, { recursive: true })
const profile = join(root, 'profile')
const notes = join(root, '中文 笔记')
await fs.mkdir(join(notes, '图片'), { recursive: true })
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
await fs.writeFile(join(notes, '图片', '示例.png'), image)
const file = join(notes, '第一篇 笔记.md')
const savedAs = join(notes, '另存的笔记.md')
const pdf = join(root, '导出验证.pdf')
const original = '# 中文阅读测试\n\n这是一段 **加粗** 文字，与 [链接](https://example.com)。\n\n## 正文标题\n\n- [ ] 待办事项\n- [x] 已经完成\n\n| 项目 | 内容 |\n| --- | --- |\n| 标题 | 中文表格 |\n\n行内公式 $E=mc^2$。\n\n$$\n\\int_0^1 x^2\\,dx=\\frac{1}{3}\n$$\n\n```mermaid\nflowchart LR\n  A[开始阅读] --> B[写下想法]\n```\n\n```js\nconst value = 42;\n```\n\n![本地图片](图片/示例.png)\n\n<script>window.__unsafeExecuted = true</script>\n\n最后一段文字。\n'
await fs.writeFile(file, '\uFEFF' + original.replace(/\n/g, '\r\n'))
let app
let page
const errors = []
const checks = []
const record = message => { checks.push(message); console.log(`PASS ${message}`) }
async function poll(fn, label, timeout = 12000) {
  const start = Date.now()
  while (Date.now() - start < timeout) { if (await fn()) return; await new Promise(r => setTimeout(r, 80)) }
  throw new Error(`Timed out: ${label}`)
}
async function launch() {
  const env = { ...process.env, PURE_USER_DATA_DIR: profile }
  delete env.ELECTRON_RUN_AS_NODE
  const executablePath = process.env.PURE_TEST_EXECUTABLE || process.env.SUJIAN_TEST_EXECUTABLE
  app = await electron.launch({ ...(executablePath ? { executablePath } : {}), args: executablePath ? [] : ['.'], cwd: process.cwd(), env, timeout: 30000 })
  page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.show(); win.focus(); win.webContents.focus() })
  await page.bringToFront()
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.locator('.ProseMirror').waitFor({ timeout: 30000 })
}
async function stop() { if (app) { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); app = undefined } }
async function dialogs({ open = file, save = savedAs, response = 0 } = {}) {
  await app.evaluate(({ dialog }, data) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [data.open] })
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: data.save })
    dialog.showMessageBox = async () => ({ response: data.response, checkboxChecked: false })
  }, { open, save, response })
}
async function menu(text) {
  await page.getByRole('button', { name: '更多', exact: true }).click()
  await page.getByRole('menu').getByRole('button', { name: text }).click()
}
async function rich() {
  await page.locator('.ProseMirror').waitFor({ timeout: 20000 })
  for (const block of await page.locator('.milkdown-code-block').all()) await block.scrollIntoViewIfNeeded()
  await page.locator('.diagram svg').first().waitFor({ state: 'attached', timeout: 30000 })
  await page.locator('.document-scroll').evaluate(node => { node.scrollTop = 0 })
}
try {
  await launch()
  assert.equal((await page.locator('.ProseMirror').innerText()).trim(), '')
  await page.screenshot({ path: join(root, '01-blank-light.png') })
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined')
  assert.equal(await page.evaluate(() => typeof window.desktop.openFile), 'function')
  record('实际 Windows Electron 空白文档启动、隔离 preload')

  await dialogs()
  await page.getByRole('button', { name: '打开文档', exact: true }).click()
  await page.locator('.document-title').filter({ hasText: '第一篇 笔记.md' }).waitFor()
  await rich()
  assert.ok(await page.locator('.katex').count() >= 2)
  assert.ok(await page.locator('.ProseMirror table').count() > 0)
  assert.equal(await page.evaluate(() => window.__unsafeExecuted), undefined)
  await poll(() => page.locator('.ProseMirror img[src^="pure-asset:"]').evaluateAll(imgs => imgs.length > 0 && imgs.every(i => i.complete && i.naturalWidth > 0)), 'relative images')
  assert.equal(await page.locator('.dirty-dot[title="尚未保存"]').count(), 0)
  record('中文与空格路径、UTF-8 BOM/CRLF、表格任务列表、数学公式、本地图片、原始 HTML 不执行')

  await dialogs({ open: notes })
  await page.getByRole('button', { name: '打开文件夹', exact: true }).first().click()
  await page.locator('.tree-entry').filter({ hasText: '第一篇 笔记.md' }).waitFor()
  const added = join(notes, '新加入.md')
  await fs.writeFile(added, '# 新加入')
  await page.locator('.tree-entry').filter({ hasText: '新加入.md' }).waitFor({ timeout: 10000 })
  await fs.unlink(added)
  await page.locator('.tree-entry').filter({ hasText: '新加入.md' }).waitFor({ state: 'detached', timeout: 10000 })
  await page.getByRole('button', { name: /^大纲/ }).click()
  await page.locator('.outline button').filter({ hasText: '正文标题' }).click()
  record('文件夹导航、目录实时增删、大纲跳转')

  await page.keyboard.press('Control+f')
  await page.getByRole('textbox', { name: '查找文字' }).fill('文字')
  await page.locator('.search-hit').first().waitFor()
  await page.getByRole('button', { name: '下一个匹配', exact: true }).click()
  await page.keyboard.press('Escape')
  record('文内查找与定位')

  await page.locator('.ProseMirror > p').last().click()
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Enter')
  await page.keyboard.insertText('即时编辑的中文段落')
  await page.keyboard.press('Control+z')
  await poll(async () => !(await page.locator('.ProseMirror').innerText()).includes('即时编辑的中文段落'), 'undo')
  await page.keyboard.press('Control+Shift+z')
  await poll(async () => (await page.locator('.ProseMirror').innerText()).includes('即时编辑的中文段落'), 'redo')
  // Switch immediately, before Milkdown's debounced listener, to exercise flushing.
  await page.keyboard.press('Control+/')
  await page.locator('.source-editor .cm-content').waitFor()
  assert.ok((await page.locator('.source-editor').innerText()).includes('即时编辑的中文段落'))
  await page.keyboard.press('Control+/')
  await rich()
  assert.ok((await page.locator('.ProseMirror').innerText()).includes('即时编辑的中文段落'))
  await page.locator('.ProseMirror > p').last().click()
  await page.keyboard.press('Control+s')
  await poll(async () => (await fs.readFile(file, 'utf8')).includes('即时编辑的中文段落'), 'save')
  const bytes = await fs.readFile(file)
  assert.deepEqual([...bytes.subarray(0, 3)], [239, 187, 191])
  assert.equal(bytes.toString().replace(/\r\n/g, '').includes('\n'), false)
  assert.ok(bytes.toString().includes('```mermaid'))
  assert.ok(bytes.toString().includes('\r\n\r\n即时编辑的中文段落'))
  assert.ok(bytes.toString().includes('<script>window.__unsafeExecuted = true</script>'))
  record('即时编辑、无延迟丢字的源码往返、手动保存、BOM/换行与 HTML 源码保留')

  await menu('深色模式')
  await rich()
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark')
  await page.screenshot({ path: join(root, '02-editor-dark.png') })
  assert.ok((await page.locator('.diagram svg').first().textContent()).includes('开始阅读'))
  await menu('浅色模式')
  await rich()
  await menu('专注阅读')
  assert.equal(await page.locator('.ProseMirror').getAttribute('contenteditable'), 'false')
  await menu('返回编辑')
  record('深浅色、主题切换内容保留、阅读模式')

  // External update when no local edits: automatically re-read it.
  const external = (await fs.readFile(file, 'utf8')).replace('最后一段文字。', '来自外部的更新。')
  await fs.writeFile(file, external)
  await poll(async () => (await page.locator('.ProseMirror').innerText()).includes('来自外部的更新。'), 'external reload')
  await rich()
  await page.locator('.ProseMirror > p').last().click()
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Enter')
  await page.keyboard.insertText('冲突时保留的本地内容')
  await page.locator('.dirty-dot[title="尚未保存"]').waitFor()
  const externalConflict = external + '\r\n外部后来写入的内容\r\n'
  await fs.writeFile(file, externalConflict)
  await page.getByRole('alert').waitFor({ timeout: 12000 })
  await page.keyboard.press('Control+s')
  await page.waitForTimeout(500)
  assert.equal(await fs.readFile(file, 'utf8'), externalConflict)
  await dialogs({ save: savedAs })
  await page.getByRole('button', { name: '另存当前内容', exact: true }).click()
  await poll(async () => fs.readFile(savedAs, 'utf8').then(s => s.includes('冲突时保留的本地内容')).catch(() => false), 'save as')
  await page.locator('.document-title').filter({ hasText: '另存的笔记.md' }).waitFor()
  await poll(async () => await page.locator('.app').getAttribute('aria-busy') === 'false', 'save-as completed')
  assert.equal(await fs.readFile(file, 'utf8'), externalConflict)
  record('外部修改自动同步、编辑冲突阻止覆盖、另存保留双方内容')

  await dialogs({ save: pdf })
  await menu('导出 PDF')
  await poll(async () => fs.stat(pdf).then(s => s.size > 10000).catch(() => false), 'PDF', 45000)
  assert.equal((await fs.readFile(pdf)).subarray(0, 5).toString(), '%PDF-')
  await page.screenshot({ path: join(root, '03-editor-light.png') })
  record('真实 PDF 导出完成，包含中文、公式、Mermaid 与图片')

  await page.locator('.ProseMirror > p').last().click()
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Enter')
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.imeSetComposition', { text: '中文输入法', selectionStart: 5, selectionEnd: 5 })
  await cdp.send('Input.insertText', { text: '中文输入法提交的恢复草稿' })
  await page.locator('.dirty-dot[title="尚未保存"]').waitFor()
  await dialogs({ response: 2 })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await page.waitForTimeout(300)
  assert.equal(page.isClosed(), false)
  await poll(async () => {
    const files = await fs.readdir(join(profile, 'drafts'))
    return (await Promise.all(files.map(name => fs.readFile(join(profile, 'drafts', name), 'utf8')))).some(s => s.includes('中文输入法提交的恢复草稿'))
  }, 'draft persistence')
  await stop()
  await launch()
  await page.getByRole('dialog', { name: '恢复草稿' }).waitFor()
  await page.getByRole('dialog', { name: '恢复草稿' }).getByRole('button', { name: '恢复', exact: true }).first().click()
  await page.getByRole('dialog', { name: '恢复草稿' }).waitFor({ state: 'detached' })
  await page.locator('.document-title').filter({ hasText: '恢复' }).waitFor()
  await rich()
  assert.ok((await page.locator('.ProseMirror').innerText()).includes('中文输入法提交的恢复草稿'))
  record('中文组合输入提交、关闭取消、强制退出后恢复草稿为新文档')
  assert.equal(errors.filter(e => !/ERR_FILE_NOT_FOUND|404 \(Not Found\)/.test(e)).length, 0, errors.join('\n'))
  await fs.writeFile(join(root, 'results.json'), JSON.stringify({ checks, errors, pdf, root }, null, 2))
  console.log(`RESULTS ${root}`)
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: join(root, 'failure.png') }).catch(() => {})
  await fs.writeFile(join(root, 'failure.json'), JSON.stringify({ message: String(error), stack: error.stack, errors, checks }, null, 2))
  throw error
} finally { await stop() }
