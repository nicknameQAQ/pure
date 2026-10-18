import { expect, it, vi } from 'vitest'
import { readDirectory, invalidateDirectories } from '../src/renderer/src/directoryIndex'
it('目录读取共用缓存，变化只使受影响目录失效', async () => {
  const listDirectory = vi.fn(async () => ({ ok: true, value: [] }))
  vi.stubGlobal('window', { desktop: { listDirectory } })
  try {
    await Promise.all([readDirectory('root\\a'), readDirectory('root\\a'), readDirectory('root\\b')])
    expect(listDirectory).toHaveBeenCalledTimes(2)
    invalidateDirectories(['root\\a'])
    await Promise.all([readDirectory('root\\a'), readDirectory('root\\b')])
    expect(listDirectory).toHaveBeenCalledTimes(3)
  } finally { vi.unstubAllGlobals() }
})
