import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertApostateWindowsSxsManifest, resolveApostateWindowsRuntimeRoot } from './runtime-layout'

const version = '155.0.8059.31'
const sxsManifest = `<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0"><assemblyIdentity name="${version}" version="${version}" type="win32"/><file name="chrome_elf.dll"/></assembly>`

describe('Apostate runtime layout', () => {
  it('selects the bounded parent containing the executable and runtime resources', async () => {
    const root = await mkdtemp(join(tmpdir(), 'abcBrowser-apostate-'))
    try {
      const browser = join(root, 'browser')
      await mkdir(join(browser, 'locales'), { recursive: true })
      await Promise.all([
        writeFile(join(browser, 'chrome.exe'), 'exe'),
        writeFile(join(browser, 'chrome.dll'), 'dll'),
        writeFile(join(browser, 'chrome_elf.dll'), 'elf'),
        writeFile(join(browser, 'resources.pak'), 'pak'),
        writeFile(join(browser, 'icudtl.dat'), 'icu'),
        writeFile(join(browser, `${version}.manifest`), sxsManifest)
      ])
      await writeFile(join(root, 'unrelated.txt'), 'do not copy')

      await expect(resolveApostateWindowsRuntimeRoot(join(browser, 'chrome.exe'), version)).resolves.toEqual({
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
      await expect(resolveApostateWindowsRuntimeRoot(executable, version)).rejects.toThrow('缺少 Apostate 运行时资源')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects a Windows package missing the build-produced SxS manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'abcBrowser-apostate-no-sxs-'))
    try {
      await expect(assertApostateWindowsSxsManifest(root, version)).rejects.toThrow('不能手工伪造')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects a mismatched external assembly identity or chrome_elf mapping', async () => {
    const root = await mkdtemp(join(tmpdir(), 'abcBrowser-apostate-wrong-sxs-'))
    try {
      await writeFile(join(root, `${version}.manifest`), sxsManifest.replace('chrome_elf.dll', 'other.dll'))
      await expect(assertApostateWindowsSxsManifest(root, version)).rejects.toThrow('不匹配')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects an external manifest for a different Chromium version', async () => {
    const root = await mkdtemp(join(tmpdir(), 'abcBrowser-apostate-wrong-version-'))
    try {
      const wrongVersionManifest = sxsManifest.replaceAll(version, '154.0.0.0')
      await writeFile(join(root, `${version}.manifest`), wrongVersionManifest)
      await expect(assertApostateWindowsSxsManifest(root, version)).rejects.toThrow('不匹配')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects a valid manifest when its mapped chrome_elf.dll is absent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'abcBrowser-apostate-no-chrome-elf-'))
    try {
      await writeFile(join(root, `${version}.manifest`), sxsManifest)
      await expect(assertApostateWindowsSxsManifest(root, version)).rejects.toThrow('缺少')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
