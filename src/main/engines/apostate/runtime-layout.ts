import { stat } from 'node:fs/promises'
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
 * Resolve only a bounded set of parents of the selected executable. Apostate
 * packages commonly put chrome.exe beside chrome.dll, but some unpackers add
 * one browser/ directory. We never search the whole drive or copy an
 * unrelated parent directory.
 */
export async function resolveApostateWindowsRuntimeRoot(executable: string): Promise<{ sourceRoot: string; sourceExecutableRelative: string }> {
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
  return { sourceRoot: best.root, sourceExecutableRelative: best.relative }
}
