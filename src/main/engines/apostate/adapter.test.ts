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
  it('emits documented Apostate switches and never forwards legacy-only flags', () => {
    const next = profile()
    next.fingerprint.hardwareProfileId = 'legacy-custom'
    next.fingerprint.platform = 'windows'
    next.fingerprint.gpuAnchor = 'windows-d3d11-nvidia-0947761dfbe9'
    const args = buildApostateLaunchArgs(next, { userDataDir: 'C:\\profiles\\one' })
    expect(args.some((arg) => arg.startsWith('--fingerprint=') && arg.length > '--fingerprint='.length)).toBe(true)
    expect(args.some((arg) => arg.startsWith('--fingerprint-platform='))).toBe(true)
    expect(args.some((arg) => arg.startsWith('--fingerprint-locale='))).toBe(true)
    expect(args).toContain('--fingerprint-anchor=windows-d3d11-nvidia-0947761dfbe9')
    expect(args).toContain('--fingerprint-webrtc-udp=block')
    expect(args.some((arg) => arg.startsWith('--fingerprint-brand'))).toBe(false)
    expect(args.some((arg) => arg.startsWith('--fingerprint-location'))).toBe(false)
    expect(args.some((arg) => arg.startsWith('--disable-spoofing'))).toBe(false)
  })

  it('uses Apostate host mode without contradictory per-field overrides', () => {
    const next = profile()
    next.fingerprint.deviceMemoryGb = 16
    next.fingerprint.gpuAnchor = 'windows-d3d11-nvidia-0947761dfbe9'
    next.fingerprint.gpuRenderer = 'ANGLE renderer'
    next.fingerprint.canvasWebglNoise = true
    const args = buildApostateLaunchArgs(next, { userDataDir: 'C:\\profiles\\host' })
    expect(args).toContain('--fingerprint=host')
    expect(args.some((arg) => arg.startsWith('--fingerprint-platform='))).toBe(false)
    expect(args.some((arg) => arg.startsWith('--fingerprint-hardware-concurrency='))).toBe(false)
    expect(args.some((arg) => arg.startsWith('--fingerprint-device-memory='))).toBe(false)
    expect(args.some((arg) => arg.startsWith('--fingerprint-anchor='))).toBe(false)
    expect(args.some((arg) => arg.startsWith('--fingerprint-gpu-renderer='))).toBe(false)
    expect(args).not.toContain('--fingerprint-noise')
    expect(args).toContain('--fingerprint-webrtc-udp=block')
  })

  it('adds memory, a pinned GPU family, an optional renderer and readback noise in seed mode', () => {
    const next = profile()
    next.fingerprint.hardwareProfileId = 'legacy-custom'
    next.fingerprint.platform = 'windows'
    next.fingerprint.hardwareConcurrency = 12
    next.fingerprint.deviceMemoryGb = 16
    next.fingerprint.gpuAnchor = 'windows-d3d11-nvidia-0947761dfbe9'
    next.fingerprint.gpuRenderer = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4060)'
    next.fingerprint.canvasWebglNoise = true
    const args = buildApostateLaunchArgs(next, {
      userDataDir: 'C:\\profiles\\one',
      hostHardwareConcurrency: 8,
      hostMemoryGb: 8
    })
    expect(args).toContain('--fingerprint-hardware-concurrency=8')
    expect(args).toContain('--fingerprint-device-memory=8')
    expect(args).toContain('--fingerprint-anchor=windows-d3d11-nvidia-0947761dfbe9')
    expect(args).toContain('--fingerprint-gpu-renderer=ANGLE (NVIDIA, NVIDIA GeForce RTX 4060)')
    expect(args).toContain('--fingerprint-noise')
  })

  it('lets Apostate choose the GPU family when anchor is auto', () => {
    const next = profile()
    next.fingerprint.hardwareProfileId = 'legacy-custom'
    next.fingerprint.platform = 'windows'
    next.fingerprint.gpuAnchor = 'auto'
    const args = buildApostateLaunchArgs(next, { userDataDir: 'C:\\profiles\\auto' })
    expect(args.some((arg) => arg.startsWith('--fingerprint-anchor='))).toBe(false)
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
