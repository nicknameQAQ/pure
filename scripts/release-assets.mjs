import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

const { version } = JSON.parse(await fs.readFile('package.json', 'utf8'))
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid release version')
await fs.mkdir('release', { recursive: true })
const source = `pure-${version}-source.zip`
execFileSync('git', ['archive', '--format=zip', `--output=release/${source}`, 'HEAD'], { stdio: 'inherit', windowsHide: true })
const assets = [`pure-${version}-win-x64.zip`, `pure-${version}-x64-portable.exe`, source]
const lines = []
for (const name of assets) {
  const bytes = await fs.readFile(join('release', name))
  lines.push(`${createHash('sha256').update(bytes).digest('hex')}  ${name}`)
}
await fs.writeFile('release/SHA256SUMS.txt', lines.join('\n') + '\n')
console.log('Prepared source archive and SHA256SUMS.txt')
