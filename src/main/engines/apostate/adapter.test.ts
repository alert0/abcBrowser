import { describe, expect, it, vi } from 'vitest'
import { defaultProfileDraft } from '../../../shared/defaults'
import type { BrowserProfile } from '../../../shared/types'
import { buildApostateLaunchArgs } from './adapter'

vi.mock('../../host-hardware', () => ({ hostHardwareSnapshot: () => ({
  platform: 'windows', platformVersion: '10.0.0', hardwareConcurrency: 16, physicalMemoryGb: 64
}) }))

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
    next.fingerprint.hardwareProfileId = process.platform === 'win32' ? 'windows-host' : 'macos-host'
    next.fingerprint.platform = process.platform === 'win32' ? 'windows' : 'macos'
    next.fingerprint.deviceMemoryGb = 16
    next.fingerprint.hardwareConcurrency = 24
    next.fingerprint.screenWidth = 2560
    next.fingerprint.screenHeight = 1440
    next.fingerprint.language = 'fr-FR'
    next.fingerprint.timezone = 'Europe/Paris'
    next.fingerprint.gpuAnchor = 'windows-d3d11-nvidia-0947761dfbe9'
    next.fingerprint.gpuRenderer = 'ANGLE renderer'
    next.fingerprint.canvasWebglNoise = true
    const args = buildApostateLaunchArgs(next, { userDataDir: 'C:\\profiles\\host' })
    expect(args).toContain('--fingerprint=host')
    expect(args.some((arg) => arg.startsWith('--fingerprint-platform='))).toBe(false)
    expect(args.some((arg) => arg.startsWith('--fingerprint-hardware-concurrency='))).toBe(false)
    expect(args.some((arg) => arg.startsWith('--fingerprint-device-memory='))).toBe(false)
    expect(args.some((arg) => arg.startsWith('--fingerprint-screen-'))).toBe(false)
    expect(args.some((arg) => arg.startsWith('--fingerprint-locale='))).toBe(false)
    expect(args.some((arg) => arg.startsWith('--fingerprint-timezone='))).toBe(false)
    expect(args.some((arg) => arg.startsWith('--lang='))).toBe(false)
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

  it('uses an authored Apostate v3 profile instead of seed and per-field switches', () => {
    const next = profile()
    next.fingerprint.hardwareProfileId = 'legacy-custom'
    next.fingerprint.apostateProfileJson = JSON.stringify({
      cpu: { logical_cores: 8 },
      locale: { application: 'en-GB', timezone: 'Europe/London' }
    })
    next.fingerprint.gpuAnchor = 'auto'
    next.fingerprint.gpuRenderer = undefined
    next.fingerprint.canvasWebglNoise = true
    const args = buildApostateLaunchArgs(next, { userDataDir: 'C:\\profiles\\authored' })
    const profileArg = args.find((arg) => arg.startsWith('--apostate-profile='))
    expect(profileArg).toBeDefined()
    expect(Buffer.from(profileArg!.slice('--apostate-profile='.length), 'base64').toString('utf8'))
      .toBe(JSON.stringify(JSON.parse(next.fingerprint.apostateProfileJson!)))
    expect(args.some((arg) => arg.startsWith('--fingerprint=') && arg !== '--fingerprint=host')).toBe(false)
    expect(args.some((arg) => arg.startsWith('--fingerprint-platform='))).toBe(false)
    expect(args.some((arg) => arg.startsWith('--fingerprint-anchor='))).toBe(false)
    expect(args.some((arg) => arg.startsWith('--fingerprint-device-memory='))).toBe(false)
    expect(args.some((arg) => arg.startsWith('--fingerprint-hardware-concurrency='))).toBe(false)
    expect(args.some((arg) => arg.startsWith('--fingerprint-screen-'))).toBe(false)
    expect(args.some((arg) => arg.startsWith('--fingerprint-locale='))).toBe(false)
    expect(args.some((arg) => arg.startsWith('--fingerprint-timezone='))).toBe(false)
    expect(args.some((arg) => arg.startsWith('--fingerprint-gpu-renderer='))).toBe(false)
    expect(args.some((arg) => arg.startsWith('--lang='))).toBe(false)
    expect(args).not.toContain('--fingerprint-noise')
  })

  it('clamps CPU and installed memory in authored profiles to the actual host limits', () => {
    const next = profile()
    next.fingerprint.hardwareProfileId = 'legacy-custom'
    next.fingerprint.apostateProfileJson = JSON.stringify({
      cpu: { logical_cores: 32 },
      memory: { total_bytes: 34359738368 }
    })
    const args = buildApostateLaunchArgs(next, {
      userDataDir: 'C:\\profiles\\authored-clamp',
      hostHardwareConcurrency: 8,
      hostMemoryGb: 8
    })
    const profileArg = args.find((arg) => arg.startsWith('--apostate-profile='))
    expect(profileArg).toBeDefined()
    expect(JSON.parse(Buffer.from(profileArg!.slice('--apostate-profile='.length), 'base64').toString('utf8')))
      .toEqual({ cpu: { logical_cores: 8 }, memory: { total_bytes: 8589934592 } })
  })


  it('inherits OS language in a partial Custom Profile without taking seed language', () => {
    const next = profile()
    next.fingerprint.apostateProfileJson = '{"cpu":{"logical_cores":2}}'
    next.fingerprint.language = 'fr-FR'
    const args = buildApostateLaunchArgs(next, { userDataDir: 'test', hostLocale: 'zh-CN' })
    const encoded = args.find(a => a.startsWith('--apostate-profile='))!.slice('--apostate-profile='.length)
    const decoded = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))
    expect(decoded.locale).toEqual({ application: 'zh-CN', accept_languages: 'zh-CN,zh' })
    expect(args.some(a => a.startsWith('--fingerprint-locale='))).toBe(false)
  })

  it('retains explicit Custom Profile locale and timezone', () => {
    const next = profile()
    next.fingerprint.apostateProfileJson = JSON.stringify({
      cpu: { logical_cores: 2 },
      locale: { application: 'de-DE', accept_languages: 'de-DE,de', timezone: 'Europe/Berlin' }
    })
    const args = buildApostateLaunchArgs(next, { userDataDir: 'test', hostLocale: 'zh-CN' })
    const encoded = args.find(a => a.startsWith('--apostate-profile='))!.slice('--apostate-profile='.length)
    expect(JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')).locale)
      .toEqual({ application: 'de-DE', accept_languages: 'de-DE,de', timezone: 'Europe/Berlin' })
  })

  it('rejects missing Custom Profile language when host locale is unavailable', () => {
    const next = profile()
    next.fingerprint.apostateProfileJson = '{"cpu":{"logical_cores":2}}'
    expect(() => buildApostateLaunchArgs(next, { userDataDir: 'test' })).toThrow('系统语言')
  })

  it('rejects unsupported WebRTC policy in host and authored modes too', () => {
    const authored = profile()
    authored.fingerprint.hardwareProfileId = 'legacy-custom'
    authored.fingerprint.apostateProfileJson = JSON.stringify({ cpu: { logical_cores: 8 } })
    authored.fingerprint.webrtcPolicy = 'public_only'
    expect(() => buildApostateLaunchArgs(authored, { userDataDir: 'C:\\profiles\\authored-webrtc' })).toThrow('public_only')

    const host = profile()
    host.fingerprint.hardwareProfileId = process.platform === 'win32' ? 'windows-host' : 'macos-host'
    host.fingerprint.platform = process.platform === 'win32' ? 'windows' : 'macos'
    host.fingerprint.webrtcPolicy = 'public_only'
    expect(() => buildApostateLaunchArgs(host, { userDataDir: 'C:\\profiles\\host-webrtc' })).toThrow('public_only')
  })

  it.each(['host', 'seed', 'custom'] as const)('keeps %s mode exclusive with either supported WebRTC policy', (mode) => {
    for (const policy of ['default', 'proxy_only'] as const) {
      const next = profile()
      next.fingerprint.hardwareProfileId = mode === 'host'
        ? (process.platform === 'win32' ? 'windows-host' : 'macos-host') : 'legacy-custom'
      next.fingerprint.apostateProfileJson = mode === 'custom' ? '{"cpu":{"logical_cores":2}}' : ''
      next.fingerprint.webrtcPolicy = policy
      const args = buildApostateLaunchArgs(next, { userDataDir: 'test' })
      expect(args.filter(a => a.startsWith('--fingerprint=') || a.startsWith('--apostate-profile='))).toHaveLength(1)
      expect(args.includes('--fingerprint=host')).toBe(mode === 'host')
      expect(args.some(a => a.startsWith('--apostate-profile='))).toBe(mode === 'custom')
      expect(args.includes('--fingerprint-webrtc-udp=block')).toBe(policy === 'proxy_only')
    }
  })

  it.each([1, 42, 0xffffffff])('passes seed %s unchanged despite legacy GPU buckets', seed => {
    const next = profile()
    next.fingerprint.seed = seed
    next.fingerprint.hardwareProfileId = 'windows-11-rtx4060'
    next.fingerprint.gpuBucket = 29
    expect(buildApostateLaunchArgs(next, { userDataDir: 'test' })).toContain(`--fingerprint=${seed}`)
  })

  it('rejects seed zero because Apostate interprets it as host mode', () => {
    const next = profile()
    next.fingerprint.seed = 0
    expect(() => buildApostateLaunchArgs(next, { userDataDir: 'test' })).toThrow('种子')
  })

  it('floors fractional host memory before emitting the integer GiB switch', () => {
    const next = profile()
    next.fingerprint.hardwareProfileId = 'legacy-custom'
    next.fingerprint.deviceMemoryGb = 16
    expect(buildApostateLaunchArgs(next, { userDataDir: 'test', hostMemoryGb: 7.8 }))
      .toContain('--fingerprint-device-memory=7')
  })

  it('rejects a window larger than its claimed screen', () => {
    for (const custom of [false, true]) {
      const next = profile()
      next.fingerprint.hardwareProfileId = 'legacy-custom'
      next.fingerprint.screenWidth = 1024
      next.fingerprint.screenHeight = 768
      next.fingerprint.apostateProfileJson = custom ? '{"screen":{"width":1024,"height":768}}' : ''
      next.window = { mode: 'custom', width: 1200, height: 800, x: 0, y: 0 }
      expect(() => buildApostateLaunchArgs(next, { userDataDir: 'test' })).toThrow('窗口')
    }
  })

  it('rejects an invalid or conflicting locale rather than silently changing navigator.language', () => {
    const next = profile()
    next.fingerprint.hardwareProfileId = 'legacy-custom'
    next.fingerprint.networkIdentityMode = 'manual'
    next.fingerprint.language = 'fr-FR'
    next.fingerprint.acceptLanguages = 'en-US,en'
    expect(() => buildApostateLaunchArgs(next, { userDataDir: 'test' })).toThrow('语言')
    next.fingerprint.language = 'en-US'
    next.fingerprint.acceptLanguages = 'en-US;q=0.9,en'
    expect(() => buildApostateLaunchArgs(next, { userDataDir: 'test' })).toThrow('语言')
  })

  it('validates GPU family at the launch boundary as well as on save', () => {
    const next = profile()
    next.fingerprint.hardwareProfileId = 'legacy-custom'
    next.fingerprint.gpuAnchor = 'auto'
    next.fingerprint.gpuRenderer = 'unmatched renderer'
    expect(() => buildApostateLaunchArgs(next, { userDataDir: 'test' })).toThrow('GPU')
  })

  it.each([0, -1, 1.5, NaN, Infinity, 4097])('rejects invalid CPU or memory %s before spawning', value => {
    for (const field of ['hardwareConcurrency', 'deviceMemoryGb'] as const) {
      const next = profile()
      next.fingerprint.hardwareProfileId = 'legacy-custom'
      next.fingerprint[field] = value
      expect(() => buildApostateLaunchArgs(next, { userDataDir: 'test' })).toThrow('整数')
    }
  })

  it('lets an authored device explicitly take precedence over a host template and seed zero', () => {
    const next = profile()
    next.fingerprint.hardwareProfileId = process.platform === 'win32' ? 'windows-host' : 'macos-host'
    next.fingerprint.seed = 0
    next.fingerprint.apostateProfileJson = '{"cpu":{"logical_cores":2}}'
    const args = buildApostateLaunchArgs(next, { userDataDir: 'test' })
    expect(args.some(a => a.startsWith('--apostate-profile='))).toBe(true)
    expect(args.some(a => a.startsWith('--fingerprint='))).toBe(false)
    expect(JSON.parse(next.fingerprint.apostateProfileJson)).toEqual({ cpu: { logical_cores: 2 } })
  })

  it.each([1, 8, 16, 32])('limits configured CPU %s without exceeding host limits', cores => {
    const next = profile()
    next.fingerprint.hardwareProfileId = 'legacy-custom'
    next.fingerprint.hardwareConcurrency = cores
    expect(buildApostateLaunchArgs(next, { userDataDir: 'test', hostHardwareConcurrency: 8 }))
      .toContain(`--fingerprint-hardware-concurrency=${Math.min(cores, 8)}`)
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
