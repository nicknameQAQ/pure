import { _electron as electron } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const output = resolve('test-results')
await mkdir(output, { recursive: true })
const env = { ...process.env, PURE_USER_DATA_DIR: resolve(output, 'inspect-profile') }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ args: ['.'], cwd: process.cwd(), env, timeout: 30000 })
const page = await app.firstWindow()
const errors = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
try {
  await page.locator('.ProseMirror').waitFor({ timeout: 30000 })
  if (process.argv[2]) {
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, resolve(process.argv[2]))
    await page.getByRole('button', { name: '打开文档', exact: true }).click()
    await page.locator('.document-title').filter({ hasText: '第一篇' }).waitFor()
    await page.locator('.ProseMirror').waitFor()
  }
  for (const block of await page.locator('.milkdown-code-block').all()) await block.scrollIntoViewIfNeeded()
  await page.locator('.diagram svg').first().waitFor({ state: 'attached', timeout: 30000 })
  await page.locator('.document-scroll').evaluate(node => { node.scrollTop = 0 })
  await page.waitForTimeout(300)
  await page.screenshot({ path: resolve(output, 'light.png') })
  console.log(JSON.stringify({ title: await page.title(), images: await page.locator('.ProseMirror img').evaluateAll(nodes => nodes.map(n => ({src:n.src,complete:n.complete,width:n.naturalWidth}))), imageBlocks: await page.locator('.milkdown-image-block').evaluateAll(nodes => nodes.map(n=>n.outerHTML.slice(0,1800))), diagrams: await page.locator('.diagram svg').count(), diagramErrors: await page.locator('.diagram-error').evaluateAll(nodes => nodes.map(n => n.title)), math: await page.locator('.katex').count(), errors }, null, 2))
  await writeFile(resolve(output, 'inspect-errors.json'), JSON.stringify(errors, null, 2))
} finally { await app.evaluate(({ app }) => app.exit(0)) }
