import { _electron as electron, chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { promises as fs } from 'node:fs'
import { resolve, join } from 'node:path'
import { performance } from 'node:perf_hooks'
import os from 'node:os'

const [label = 'current', direct, portable] = process.argv.slice(2)
if (!direct || !portable) throw new Error('Usage: node tests/benchmark.mjs label direct.exe portable.exe')
const root = resolve('test-results', `benchmark-${label}-${Date.now()}`)
await fs.mkdir(join(root, 'notes'), { recursive: true })
const text = '# 性能测试\n\n' + Array.from({ length: 400 }, (_, i) => `第${i}段，测试本地文档编辑、查找和输入响应。`.repeat(12) + '\n\n').join('')
const files = {}
for (const size of [20000, 100000]) {
  files[size] = join(root, `document-${size}.md`)
  await fs.writeFile(files[size], text.slice(0, size))
}
for (let offset = 0; offset < 1000; offset += 50) await Promise.all(Array.from({ length: 50 }, (_, i) => fs.writeFile(join(root, 'notes', `${String(offset + i).padStart(4, '0')}.md`), '# 笔记')))
const envFor = profile => {
  const env = { ...process.env, PURE_USER_DATA_DIR: profile, SUJIAN_USER_DATA_DIR: profile }
  delete env.ELECTRON_RUN_AS_NODE
  return env
}
const samples = []
for (let i = 0; i < 10; i++) {
  const started = performance.now()
  const app = await electron.launch({ executablePath: resolve(direct), args: [], env: envFor(join(root, `direct-${i}`)), timeout: 45000 })
  const page = await app.firstWindow()
  const windowMs = performance.now() - started
  try {
    await page.locator('.ProseMirror[contenteditable="true"]').waitFor()
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const readyMs = performance.now() - started
    const memoryMB = await app.evaluate(({ app }) => app.getAppMetrics().reduce((sum, p) => sum + p.memory.workingSetSize, 0) / 1024)
    const documents = []
    for (const size of [20000, 100000]) {
      await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); dialog.showMessageBox = async () => ({ response: 1 }) }, files[size])
      const opening = performance.now()
      await page.getByRole('button', { name: '打开文档', exact: true }).click()
      await page.locator('.document-title').filter({ hasText: `document-${size}.md` }).waitFor()
      await page.locator('.ProseMirror > h1').filter({ hasText: '性能测试' }).waitFor()
      const openMs = performance.now() - opening
      await page.locator('.ProseMirror > p').first().click()
      const input = []
      for (let j = 0; j < 10; j++) {
        const start = performance.now()
        await page.keyboard.insertText('字')
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)))
        input.push(performance.now() - start)
      }
      await page.keyboard.press('Control+f')
      const start = performance.now()
      await page.getByRole('textbox', { name: '查找文字', exact: true }).fill('本地文档')
      await page.locator('.search-hit').first().waitFor()
      const searchMs = performance.now() - start
      await page.keyboard.press('Escape')
      documents.push({ size, openMs, inputMs: input, searchMs })
    }
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }) }, join(root, 'notes'))
    await page.getByRole('button', { name: '打开文件夹', exact: true }).first().click()
    const quickMs = []
    for (let j = 0; j < 2; j++) {
      const start = performance.now()
      await page.keyboard.press('Control+p')
      await page.getByRole('textbox', { name: '快速打开文件', exact: true }).fill('0999')
      await page.getByRole('option').filter({ hasText: '0999.md' }).waitFor()
      quickMs.push(performance.now() - start)
      await page.keyboard.press('Escape')
    }
    samples.push({ kind: 'direct', run: i + 1, windowMs, readyMs, memoryMB, documents, quickMs })
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}) }
  console.log(`${label} direct ${i + 1}/10`)
}
for (let i = 0; i < 10; i++) {
  const server = createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  const started = performance.now()
  const child = spawn(resolve(portable), [`--remote-debugging-port=${port}`], { env: envFor(join(root, `portable-${i}`)), windowsHide: true, stdio: 'ignore' })
  let browser
  try {
    let endpoint = false
    while (performance.now() - started < 60000) {
      try { const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(300) }); if (r.ok) { endpoint = true; break } } catch {}
      await new Promise(resolve => setTimeout(resolve, 30))
    }
    if (!endpoint) throw new Error('Portable startup timeout')
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    const page = browser.contexts()[0].pages()[0]
    const windowMs = performance.now() - started
    await page.locator('.ProseMirror[contenteditable="true"]').waitFor()
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    samples.push({ kind: 'portable', run: i + 1, windowMs, readyMs: performance.now() - started })
    await page.evaluate(() => window.desktop.close())
  } finally { await browser?.close().catch(() => {}); child.kill() }
  console.log(`${label} portable ${i + 1}/10`)
}
const percentile = (items, p) => [...items].sort((a, b) => a - b)[Math.min(items.length - 1, Math.ceil(items.length * p) - 1)]
const summary = {}
for (const kind of ['direct', 'portable']) {
  const rows = samples.filter(s => s.kind === kind)
  summary[kind] = Object.fromEntries(['windowMs', 'readyMs', ...(kind === 'direct' ? ['memoryMB'] : [])].map(key => [key, { median: percentile(rows.map(r => r[key]), .5), p95: percentile(rows.map(r => r[key]), .95) }]))
}
for (const size of [20000, 100000]) {
  const docs = samples.filter(s => s.kind === 'direct').map(s => s.documents.find(d => d.size === size))
  summary[size] = Object.fromEntries(['openMs', 'searchMs', 'inputMs'].map(key => { const values = docs.flatMap(d => d[key]); return [key, { median: percentile(values, .5), p95: percentile(values, .95) }] }))
}
summary.quickMs = [0, 1].map(i => { const values = samples.filter(s => s.kind === 'direct').map(s => s.quickMs[i]); return { median: percentile(values, .5), p95: percentile(values, .95) } })
await fs.writeFile(join(root, 'results.json'), JSON.stringify({ label, platform: os.version(), cpu: os.cpus()[0].model, memoryGB: os.totalmem() / 2 ** 30, samples, summary }, null, 2))
console.log(JSON.stringify({ root, summary }, null, 2))
