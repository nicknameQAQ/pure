import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { FileStore, atomicWrite, decode, hash, migrateUserData } from '../src/main/files'
import { headings } from '../src/renderer/src/document'

let root: string
let store: FileStore
beforeEach(async () => {
  await fs.mkdir(join(process.cwd(), 'test-results'), { recursive: true })
  root = await fs.mkdtemp(join(process.cwd(), 'test-results', 'files-'))
  store = new FileStore(join(root, 'profile'))
  await store.init()
})
afterEach(async () => {
  for (const id of store.documents.keys()) await store.discardDraft(id)
})
describe('文件内容与保存', () => {
  it('立即创建空文件，并发新建自动编号，不覆盖原文件', async () => {
    await fs.mkdir(join(root, '子目录 有空格'))
    const directory = join(root, '子目录 有空格')
    await fs.writeFile(join(directory, '未命名.md'), '原有内容')
    const docs = await Promise.all([store.createFile(directory), store.createFile(directory), store.createFile(directory)])
    expect(new Set(docs.map(doc => doc.path)).size).toBe(3)
    expect(docs.map(doc => doc.name).sort()).toEqual(['未命名 (2).md', '未命名 (3).md', '未命名 (4).md'])
    for (const doc of docs) { expect(await fs.readFile(doc.path!, 'utf8')).toBe(''); expect(doc.revision).toBe(hash(Buffer.alloc(0))) }
    expect(await fs.readFile(join(directory, '未命名.md'), 'utf8')).toBe('原有内容')
    await expect(store.createFile(join(root, '不存在'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('重命名保留未保存缓冲区、草稿、最近文件和原始编码', async () => {
    const path = join(root, '原文件.md')
    await fs.writeFile(path, '\uFEFF# 原文\r\n')
    const doc = await store.open(path)
    store.updateBuffer(doc.id, '# 未保存\n')
    await store.persistDraft(doc.id)
    const renamed = await store.rename(doc.id, '中文 新文件', doc.revision)
    expect(renamed.name).toBe('中文 新文件.md')
    expect(store.buffers.get(doc.id)).toBe('# 未保存\n')
    expect(await fs.readFile(renamed.path!, 'utf8')).toBe('\uFEFF# 原文\r\n')
    await expect(fs.access(path)).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await store.drafts())[0]).toMatchObject({ path: renamed.path, name: renamed.name, markdown: '# 未保存\n' })
    expect(store.settings.recentFiles).toEqual([renamed.path])
  })
  it('拒绝重命名覆盖、非法名称、外部修改和陈旧版本', async () => {
    const doc = await store.createFile(root)
    const target = join(root, '已有.md')
    await fs.writeFile(target, '不可覆盖')
    await expect(store.rename(doc.id, '已有.md', doc.revision)).rejects.toMatchObject({ code: 'EXISTS' })
    for (const name of ['../越界', 'CON', 'NUL.md', '末尾.', '空白 ', 'a:b']) await expect(store.rename(doc.id, name, doc.revision)).rejects.toMatchObject({ code: 'INVALID_NAME' })
    await expect(store.rename(doc.id, '新名', '旧版本')).rejects.toMatchObject({ code: 'CONFLICT' })
    await fs.writeFile(doc.path!, '外部内容')
    await expect(store.rename(doc.id, '新名', doc.revision)).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await fs.readFile(target, 'utf8')).toBe('不可覆盖')
    expect(await fs.readFile(doc.path!, 'utf8')).toBe('外部内容')
  })
  it('不支持硬链接的文件系统使用独占复制，内容不变', async () => {
    const doc = await store.createFile(root)
    const link = vi.spyOn(fs, 'link').mockRejectedValueOnce(Object.assign(new Error('unsupported'), { code: 'ENOTSUP' }))
    try {
      const result = await store.rename(doc.id, '另一名称.md', doc.revision)
      expect(await fs.readFile(result.path!, 'utf8')).toBe('')
      await expect(fs.access(doc.path!)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally { link.mockRestore() }
  })
  it('只读文档拒绝重命名，不留下额外文件', async () => {
    const doc = await store.createFile(root)
    await fs.chmod(doc.path!, 0o444)
    try { await expect(store.rename(doc.id, '另一个.md', doc.revision)).rejects.toMatchObject({ code: 'READ_ONLY' }) }
    finally { await fs.chmod(doc.path!, 0o666) }
    await expect(fs.access(join(root, '另一个.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('首次迁移旧偏好和草稿，已有 pure 数据及旧数据均保留', async () => {
    const legacy = join(root, '旧数据')
    const destination = join(root, 'pure数据')
    await fs.mkdir(join(legacy, 'drafts'), { recursive: true })
    await fs.writeFile(join(legacy, 'settings.json'), JSON.stringify({ theme: 'dark' }))
    await fs.writeFile(join(legacy, 'drafts', 'test.json'), '{"markdown":"旧草稿"}')
    expect(await migrateUserData(destination, legacy)).toBe(true)
    expect(await fs.readFile(join(destination, 'drafts', 'test.json'), 'utf8')).toContain('旧草稿')
    const migrated = new FileStore(destination)
    await migrated.init()
    expect(migrated.settings.theme).toBe('dark')
    expect(migrated.settings.sidebarWidth).toBe(256)
    await fs.writeFile(join(destination, 'settings.json'), '自有设置')
    expect(await migrateUserData(destination, legacy)).toBe(false)
    expect(await fs.readFile(join(destination, 'settings.json'), 'utf8')).toBe('自有设置')
    expect(await fs.readFile(join(legacy, 'settings.json'), 'utf8')).toContain('dark')
  })
  it('保留 UTF-8 BOM、中文和 CRLF，保存重开内容一致', async () => {
    const path = join(root, '中文 有空格.md')
    await fs.writeFile(path, '\uFEFF# 标题\r\n\r\n原始内容\r\n')
    const doc = await store.open(path)
    expect(doc.bom).toBe(true)
    expect(doc.eol).toBe('\r\n')
    expect(doc.markdown).toBe('# 标题\n\n原始内容\n')
    store.updateBuffer(doc.id, '# 标题\n\n修改后的内容\n')
    await store.save(doc.id, '# 标题\n\n修改后的内容\n')
    const bytes = await fs.readFile(path)
    expect([...bytes.subarray(0, 3)]).toEqual([239, 187, 191])
    expect(bytes.toString()).toBe('\uFEFF# 标题\r\n\r\n修改后的内容\r\n')
    expect((await store.open(path)).markdown).toContain('修改后的内容')
  })
  it('拒绝覆盖外部改动，并保留编辑缓冲及恢复草稿', async () => {
    const path = join(root, '冲突.md')
    await fs.writeFile(path, '原内容')
    const doc = await store.open(path)
    store.updateBuffer(doc.id, '我正在写的内容')
    await store.persistDraft(doc.id)
    await fs.writeFile(path, '外部的新内容')
    await expect(store.save(doc.id, '我正在写的内容')).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await fs.readFile(path, 'utf8')).toBe('外部的新内容')
    expect(store.buffers.get(doc.id)).toBe('我正在写的内容')
    expect((await store.drafts())[0].markdown).toBe('我正在写的内容')
  })
  it('写入失败不破坏原文件，临时文件得到清理', async () => {
    const path = join(root, '原始.md')
    await fs.writeFile(path, '不能丢失')
    await expect(atomicWrite(path, Buffer.from('替换'), hash(Buffer.from('错误版本')))).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await fs.readFile(path, 'utf8')).toBe('不能丢失')
    expect((await fs.readdir(root)).filter(name => name.endsWith('.tmp'))).toEqual([])
    await expect(atomicWrite(join(root, '不存在的目录', '文件.md'), Buffer.from('内容'))).rejects.toBeTruthy()
  })
  it('删除原文件后保存返回冲突，恢复草稿作为新文档打开', async () => {
    const path = join(root, '已删除.md')
    await fs.writeFile(path, '原文')
    const doc = await store.open(path)
    store.updateBuffer(doc.id, '未保存的文字')
    await store.persistDraft(doc.id)
    await fs.unlink(path)
    await expect(store.save(doc.id, '未保存的文字')).rejects.toMatchObject({ code: 'CONFLICT' })
    const restarted = new FileStore(store.dataDirectory)
    await restarted.init()
    const recovered = await restarted.recover((await restarted.drafts())[0].id)
    expect(recovered.path).toBeNull()
    expect(recovered.markdown).toBe('未保存的文字')
    const savedPath = join(root, '恢复后.md')
    await restarted.save(recovered.id, recovered.markdown, savedPath)
    expect(await fs.readFile(savedPath, 'utf8')).toBe('未保存的文字')
    expect(await restarted.drafts()).toEqual([])
  })
  it('拒绝非法 UTF-8 与二进制，不用替换字符静默覆盖', () => {
    expect(() => decode(new Uint8Array([0xff, 0xfe, 0x61]))).toThrow()
    expect(() => decode(Buffer.from('a\0b'))).toThrow()
  })
  it('只读文件拒绝覆盖，缓冲内容继续保留', async () => {
    const path = join(root, '只读.md')
    await fs.writeFile(path, '只读原文')
    const doc = await store.open(path)
    store.updateBuffer(doc.id, '待另存的内容')
    await fs.chmod(path, 0o444)
    try {
      await expect(store.save(doc.id, '待另存的内容')).rejects.toMatchObject({ code: 'READ_ONLY' })
      expect(await fs.readFile(path, 'utf8')).toBe('只读原文')
      expect(store.buffers.get(doc.id)).toBe('待另存的内容')
    } finally { await fs.chmod(path, 0o666) }
  })
  it('自动重载遇到并发编辑时保留本地内容、原版本和草稿', async () => {
    const path = join(root, '并发修改.md')
    await fs.writeFile(path, '初始文字')
    const doc = await store.open(path)
    await fs.writeFile(path, '外部文字')
    store.updateBuffer(doc.id, '正在输入的文字')
    await store.persistDraft(doc.id)
    await expect(store.reload(doc.id, true)).rejects.toMatchObject({ code: 'LOCAL_CHANGES' })
    expect(store.get(doc.id).revision).toBe(doc.revision)
    expect(store.buffers.get(doc.id)).toBe('正在输入的文字')
    expect((await store.drafts())[0].markdown).toBe('正在输入的文字')
  })
  it('切换后释放旧文档，迟到的编辑事件不会重新生成已放弃草稿', async () => {
    const doc = store.create()
    store.updateBuffer(doc.id, '放弃的修改')
    await store.persistDraft(doc.id)
    await store.release(doc.id)
    expect(() => store.updateBuffer(doc.id, '迟到的事件')).toThrow()
    expect(await store.drafts()).toEqual([])
    expect(store.documents.size).toBe(0)
  })
  it('目录仅列 Markdown 和文件夹，忽略版本库与符号链接', async () => {
    await fs.writeFile(join(root, '笔记.md'), '# 笔记')
    await fs.writeFile(join(root, '文件.markdown'), '# 文件')
    await fs.writeFile(join(root, '图片.png'), 'not an image')
    await fs.mkdir(join(root, '.git'))
    await fs.mkdir(join(root, '资料'))
    const entries = await store.list(root)
    expect(entries.some(e => e.name === '笔记.md')).toBe(true)
    expect(entries.some(e => e.name === '图片.png' || e.name === '.git')).toBe(false)
    expect(entries[0].directory).toBe(true)
  })
})
it('标题大纲忽略代码块中的伪标题', () => {
  expect(headings('# 标题\n\n```md\n## 代码里的标题\n```\n\n### 真实标题')).toEqual([
    { level: 1, text: '标题', line: 1 }, { level: 3, text: '真实标题', line: 7 },
  ])
})
it('大纲支持 Setext 标题，并按完整围栏长度排除代码', () => {
  expect(headings('文字标题\n===\n\n````md\n```\n# 仍然在代码中\n````\n\n二级标题\n---')).toEqual([
    { level: 1, text: '文字标题', line: 1 }, { level: 2, text: '二级标题', line: 9 },
  ])
})
