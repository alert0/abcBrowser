import { readFile, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

async function hasDirectoryEntry(root: string, name: string): Promise<boolean> {
  try {
    const info = await stat(join(root, name))
    return info.isFile() || info.isDirectory()
  } catch {
    return false
  }
}

/**
 * Chromium's Windows chrome.exe embeds a dependency on a versioned SxS
 * assembly whose external manifest maps that identity to chrome_elf.dll.
 * Never synthesize this file: require the manifest produced by the matching
 * Apostate/Chromium build and fail before an unusable runtime is activated.
 */
export async function assertApostateWindowsSxsManifest(root: string, version: string): Promise<void> {
  const path = join(root, `${version}.manifest`)
  let manifest: string
  try {
    manifest = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Apostate Windows 运行时缺少 ${version}.manifest；该清单必须来自匹配的官方构建，不能手工伪造`)
    }
    throw error
  }

  const escapedVersion = version.replaceAll('.', '\\.').replaceAll('+', '\\+')
  const identity = new RegExp(
    `<assemblyIdentity\\b(?=[^>]*\\bname\\s*=\\s*["']${escapedVersion}["'])(?=[^>]*\\bversion\\s*=\\s*["']${escapedVersion}["'])(?=[^>]*\\btype\\s*=\\s*["']win32["'])[^>]*>`,
    'i'
  )
  const chromeElf = /<file\b(?=[^>]*\bname\s*=\s*["']chrome_elf\.dll["'])[^>]*\/?\s*>/i
  if (!identity.test(manifest) || !chromeElf.test(manifest)) {
    throw new Error(`Apostate Windows 运行时的 ${version}.manifest 与 chrome.exe 的 SxS 依赖不匹配；请使用匹配的官方构建清单`)
  }
  if (!await hasDirectoryEntry(root, 'chrome_elf.dll')) {
    throw new Error(`Apostate Windows 运行时缺少 ${version}.manifest 所映射的 chrome_elf.dll`)
  }
}

/**
 * Resolve only a bounded set of parents of the selected executable. Apostate
 * packages commonly put chrome.exe beside chrome.dll, but some unpackers add
 * one browser/ directory. We never search the whole drive or copy an
 * unrelated parent directory.
 */
export async function resolveApostateWindowsRuntimeRoot(executable: string, version: string): Promise<{ sourceRoot: string; sourceExecutableRelative: string }> {
  const selected = resolve(executable)
  const candidates: string[] = []
  let current = dirname(selected)
  for (let depth = 0; depth < 4; depth += 1) {
    candidates.push(current)
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }

  let best: { root: string; relative: string; score: number } | undefined
  for (const root of candidates) {
    const candidateRelative = relative(root, selected)
    if (!candidateRelative || candidateRelative.startsWith(`..${sep}`) || isAbsolute(candidateRelative)) continue
    const markers = ['chrome.dll', 'resources.pak', 'icudtl.dat', 'locales', 'chrome_elf.dll', 'v8_context_snapshot.bin']
    let score = 0
    for (const marker of markers) {
      if (await hasDirectoryEntry(root, marker)) score += 1
    }
    if (score < 2) continue
    if (!best || score > best.score || (score === best.score && root.length < best.root.length)) {
      best = { root, relative: candidateRelative, score }
    }
  }
  if (!best) {
    throw new Error('所选 chrome.exe 所在目录缺少 Apostate 运行时资源；请选择完整发行目录中的 chrome.exe')
  }
  await assertApostateWindowsSxsManifest(best.root, version)
  return { sourceRoot: best.root, sourceExecutableRelative: best.relative }
}
