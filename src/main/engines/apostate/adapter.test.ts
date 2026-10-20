import { describe, expect, it } from 'vitest'
import { defaultProfileDraft } from '../../../shared/defaults'
import type { BrowserProfile } from '../../../shared/types'
import { buildApostateLaunchArgs } from './adapter'

function profile(): BrowserProfile {
  const now = new Date().toISOString()
  return {
    ...defaultProfileDraft(1),
    id: 'profile-1',
    serialNumber: 1,
    name: '测试环境',
    createdAt: now,
    updatedAt: now,
    favorite: false,
    status: 'closed'
  }
}

describe('Apostate adapter', () => {
  it('emits only documented Apostate fingerprint switches', () => {
    const args = buildApostateLaunchArgs(profile(), { userDataDir: 'C:\\profiles\\one' })
    expect(args.some((arg) => arg.startsWith('--fingerprint=') && arg.length > '--fingerprint='.length)).toBe(true)
    expect(args.some((arg) => arg.startsWith('--fingerprint-platform='))).toBe(true)
    expect(args.some((arg) => arg.startsWith('--fingerprint-locale='))).toBe(true)
    expect(args).toContain('--fingerprint-webrtc-udp=block')
    expect(args.some((arg) => arg.startsWith('--fingerprint-brand'))).toBe(false)
    expect(args.some((arg) => arg.startsWith('--fingerprint-location'))).toBe(false)
    expect(args.some((arg) => arg.startsWith('--disable-spoofing'))).toBe(false)
  })

  it('does not silently translate public_only WebRTC semantics', () => {
    const next = profile()
    next.fingerprint.webrtcPolicy = 'public_only'
    expect(() => buildApostateLaunchArgs(next, { userDataDir: 'C:\\profiles\\one' })).toThrow('public_only')
  })

  it('rejects old selective spoofing switches instead of claiming support', () => {
    const next = profile()
    next.fingerprint.disabledSpoofing = ['font']
    expect(() => buildApostateLaunchArgs(next, { userDataDir: 'C:\\profiles\\one' })).toThrow('关闭部分伪装')
  })
})
