import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveApostateWindowsRuntimeRoot } from './runtime-layout'

describe('Apostate runtime layout', () => {
  it('selects the bounded parent containing the executable and runtime resources', async () => {
    const root = await mkdtemp(join(tmpdir(), 'abcBrowser-apostate-'))
    try {
      const browser = join(root, 'browser')
      await mkdir(join(browser, 'locales'), { recursive: true })
      await Promise.all([
        writeFile(join(browser, 'chrome.exe'), 'exe'),
        writeFile(join(browser, 'chrome.dll'), 'dll'),
        writeFile(join(browser, 'resources.pak'), 'pak'),
        writeFile(join(browser, 'icudtl.dat'), 'icu')
      ])
      await writeFile(join(root, 'unrelated.txt'), 'do not copy')

      await expect(resolveApostateWindowsRuntimeRoot(join(browser, 'chrome.exe'))).resolves.toEqual({
        sourceRoot: browser,
        sourceExecutableRelative: 'chrome.exe'
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects an executable without enough runtime markers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'abcBrowser-apostate-incomplete-'))
    try {
      const executable = join(root, 'chrome.exe')
      await writeFile(executable, 'exe')
      await expect(resolveApostateWindowsRuntimeRoot(executable)).rejects.toThrow('缺少 Apostate 运行时资源')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
