import { describe, expect, it } from 'vitest'
import { assertChromiumVersion, parseChromiumVersion } from './version'

describe('Apostate version parsing', () => {
  it('extracts the Chromium four-part version from Windows metadata', () => {
    expect(parseChromiumVersion('ProductVersion 155.0.8059.31 (Apostate)')).toBe('155.0.8059.31')
    expect(assertChromiumVersion('155.0.8059.31')).toBe('155.0.8059.31')
  })

  it('rejects ambiguous or missing versions', () => {
    expect(parseChromiumVersion('Apostate v0.5.1')).toBeUndefined()
    expect(() => assertChromiumVersion('155')).toThrow('四段式版本')
  })
})
