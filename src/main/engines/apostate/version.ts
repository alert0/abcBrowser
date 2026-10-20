export const APOSTATE_VERSION_PATTERN = /^\d+(?:\.\d+){3}$/

export function parseChromiumVersion(value: string): string | undefined {
  const match = value.match(/\d+(?:\.\d+){3}/)
  return match?.[0]
}

export function assertChromiumVersion(value: string): string {
  const normalized = parseChromiumVersion(value.trim())
  if (!normalized || !APOSTATE_VERSION_PATTERN.test(normalized)) {
    throw new Error('无法识别 Apostate Chromium 四段式版本')
  }
  return normalized
}
