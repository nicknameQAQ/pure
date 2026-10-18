import { promises as fs } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const stage = resolve(root, 'dist-app')
if (dirname(stage) !== root || !stage.startsWith(root)) throw new Error('Invalid staging path')
// Only this generated, ignored staging directory is replaced.
await fs.rm(stage, { recursive: true, force: true })
await fs.mkdir(stage, { recursive: true })
await fs.cp(join(root, 'out'), join(stage, 'out'), { recursive: true })
const pkg = JSON.parse(await fs.readFile(join(root, 'package.json'), 'utf8'))
const metadata = Object.fromEntries(['name', 'version', 'description', 'productName', 'author', 'license', 'type', 'main'].map(key => [key, pkg[key]]))
await fs.writeFile(join(stage, 'package.json'), JSON.stringify(metadata, null, 2))
await fs.copyFile(join(root, 'LICENSE'), join(stage, 'LICENSE'))
const notices = ['pure - Third-party notices', 'The application bundles open-source components. The following inventory includes installed build and runtime dependencies; not every listed component is included in the executable.', '']
async function scan(modules) {
  let entries
  try { entries = await fs.readdir(modules, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const path = join(modules, entry.name)
    if (entry.name.startsWith('@')) {
      for (const scoped of await fs.readdir(path)) await license(join(path, scoped))
    } else await license(path)
  }
}
async function license(path) {
  try {
    const info = JSON.parse(await fs.readFile(join(path, 'package.json'), 'utf8'))
    const files = await fs.readdir(path)
    const names = files.filter(name => /^(licen[sc]e|copying|notice)(\.|$)/i.test(name))
    notices.push(`\n${'='.repeat(72)}\n${info.name}@${info.version}\nLicense: ${typeof info.license === 'string' ? info.license : JSON.stringify(info.license ?? 'See upstream license')}\n${typeof info.repository === 'string' ? info.repository : info.repository?.url ?? ''}\n`)
    for (const name of names) {
      const stat = await fs.stat(join(path, name))
      if (stat.isFile()) notices.push(await fs.readFile(join(path, name), 'utf8'))
    }
    await scan(join(path, 'node_modules'))
  } catch { /* Non-package directories and platform-only optional dependencies. */ }
}
await scan(join(root, 'node_modules'))
await fs.writeFile(join(stage, 'THIRD_PARTY_NOTICES.txt'), notices.join('\n'))
console.log(`Prepared standalone app in ${stage}; main/preload/renderer dependencies are bundled.`)
