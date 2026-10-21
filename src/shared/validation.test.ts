import { describe, expect, it } from 'vitest'
import { defaultProfileDraft } from './defaults'
import { normalizeUrl, validateProfileDraft } from './validation'

describe('profile validation', () => {
  it('normalizes start pages to HTTPS URLs', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com/')
  })

  it('rejects non-web start page protocols', () => {
    expect(() => normalizeUrl('file:///etc/passwd')).toThrow('HTTP 或 HTTPS')
  })

  it('rejects invalid proxy ports', () => {
    const draft = defaultProfileDraft()
    draft.proxy = { protocol: 'socks5', host: '127.0.0.1', port: 70000, username: '', password: '' }
    expect(() => validateProfileDraft(draft)).toThrow('代理端口')
  })

  it('normalizes DNS and IPv6 proxy hosts while rejecting pasted proxy URLs', () => {
    const dnsDraft = defaultProfileDraft()
    dnsDraft.proxy = { protocol: 'https', host: 'BÜCHER.example', port: 8443, username: '', password: '' }
    expect(validateProfileDraft(dnsDraft).proxy.host).toBe('xn--bcher-kva.example')

    const ipv6Draft = defaultProfileDraft()
    ipv6Draft.proxy = { protocol: 'socks5', host: '[2001:db8::15]', port: 1080, username: '', password: '' }
    expect(validateProfileDraft(ipv6Draft).proxy.host).toBe('2001:db8::15')

    const urlDraft = defaultProfileDraft()
    urlDraft.proxy = { protocol: 'http', host: 'http://proxy.example.com:8080', port: 8080, username: '', password: '' }
    expect(() => validateProfileDraft(urlDraft)).toThrow('只能填写主机名或 IP')
  })

  it('removes stale proxy endpoints and credentials when switching to direct mode', () => {
    const draft = defaultProfileDraft()
    draft.proxy = {
      protocol: 'direct',
      host: 'old-proxy.example.com',
      port: 8080,
      username: 'old-user',
      password: 'old-secret',
      passwordStored: true
    }
    expect(validateProfileDraft(draft).proxy).toEqual({
      protocol: 'direct',
      host: '',
      username: '',
      password: ''
    })
  })

  it('keeps fingerprint inputs stable', () => {
    const draft = defaultProfileDraft()
    draft.fingerprint.seed = 123456
    const result = validateProfileDraft(draft)
    expect(result.fingerprint.seed).toBe(123456)
  })

  it('normalizes every hardware field from a coherent preset', () => {
    const draft = defaultProfileDraft()
    draft.fingerprint.hardwareProfileId = 'windows-11-rtx4070'
    draft.fingerprint.platform = 'macos'
    draft.fingerprint.hardwareConcurrency = 2
    draft.fingerprint.screenWidth = 800
    const result = validateProfileDraft(draft)

    expect(result.fingerprint).toMatchObject({
      hardwareProfileId: 'windows-11-rtx4070',
      platform: 'windows',
      platformVersion: '10.0.0',
      hardwareConcurrency: 16,
      screenWidth: 2560,
      screenHeight: 1440
    })
  })

  it('rejects unknown hardware templates', () => {
    const draft = defaultProfileDraft()
    draft.fingerprint.hardwareProfileId = 'macos-impossible' as typeof draft.fingerprint.hardwareProfileId
    expect(() => validateProfileDraft(draft)).toThrow('硬件模板')
  })

  it('rejects malformed browser brand versions', () => {
    const draft = defaultProfileDraft()
    draft.fingerprint.brandVersion = 'Chrome 148'
    expect(() => validateProfileDraft(draft)).toThrow('品牌版本')
  })

  it('accepts an exact managed kernel version and rejects ambiguous versions', () => {
    const draft = defaultProfileDraft()
    draft.kernelVersion = ' 144.0.7559.132 '
    expect(validateProfileDraft(draft).kernelVersion).toBe('144.0.7559.132')
    draft.kernelVersion = '144'
    expect(() => validateProfileDraft(draft)).toThrow('绑定内核版本')
  })

  it('rejects invalid timezone and WebRTC values', () => {
    const timezoneDraft = defaultProfileDraft()
    timezoneDraft.fingerprint.timezone = 'Moon/Sea_of_Tranquility'
    expect(() => validateProfileDraft(timezoneDraft)).toThrow('IANA 时区')

    const webrtcDraft = defaultProfileDraft()
    webrtcDraft.fingerprint.webrtcPolicy = 'leaky' as typeof webrtcDraft.fingerprint.webrtcPolicy
    expect(() => validateProfileDraft(webrtcDraft)).toThrow('WebRTC')
  })

  it('rejects invalid network identity and exit policies', () => {
    const identityDraft = defaultProfileDraft()
    identityDraft.fingerprint.networkIdentityMode = 'random' as typeof identityDraft.fingerprint.networkIdentityMode
    expect(() => validateProfileDraft(identityDraft)).toThrow('网络身份')

    const exitDraft = defaultProfileDraft()
    exitDraft.fingerprint.proxyExitPolicy = 'ignore' as typeof exitDraft.fingerprint.proxyExitPolicy
    expect(() => validateProfileDraft(exitDraft)).toThrow('出口变化')
  })

  it('stores a validated Apostate v3 profile as compact JSON', () => {
    const draft = defaultProfileDraft()
    draft.fingerprint.apostateProfileJson = '{ "cpu": { "logical_cores": 8 } }'
    expect(validateProfileDraft(draft).fingerprint.apostateProfileJson).toBe('{"cpu":{"logical_cores":8}}')
  })

  it('validates Apostate memory, GPU family, renderer and noise settings', () => {
    const draft = defaultProfileDraft()
    draft.fingerprint.hardwareProfileId = 'legacy-custom'
    draft.fingerprint.platform = 'windows'
    draft.fingerprint.deviceMemoryGb = 16
    draft.fingerprint.gpuAnchor = 'windows-d3d11-nvidia-0947761dfbe9'
    draft.fingerprint.gpuRenderer = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4060)'
    draft.fingerprint.canvasWebglNoise = true
    expect(validateProfileDraft(draft).fingerprint).toMatchObject({
      deviceMemoryGb: 16,
      gpuAnchor: 'windows-d3d11-nvidia-0947761dfbe9',
      gpuRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4060)',
      canvasWebglNoise: true
    })

    const badMemory = defaultProfileDraft()
    badMemory.fingerprint.hardwareProfileId = 'legacy-custom'
    badMemory.fingerprint.deviceMemoryGb = 0
    expect(() => validateProfileDraft(badMemory)).toThrow('设备内存')

    const badAnchor = defaultProfileDraft()
    badAnchor.fingerprint.hardwareProfileId = 'legacy-custom'
    badAnchor.fingerprint.gpuAnchor = 'invalid-anchor' as unknown as typeof badAnchor.fingerprint.gpuAnchor
    expect(() => validateProfileDraft(badAnchor)).toThrow('GPU 家族')

    const rendererWithoutAnchor = defaultProfileDraft()
    rendererWithoutAnchor.fingerprint.hardwareProfileId = 'legacy-custom'
    rendererWithoutAnchor.fingerprint.gpuAnchor = 'auto'
    rendererWithoutAnchor.fingerprint.gpuRenderer = 'ANGLE renderer'
    expect(() => validateProfileDraft(rendererWithoutAnchor)).toThrow('固定 GPU 家族')
  })

  it('normalizes duplicate groups and tags', () => {
    const draft = defaultProfileDraft()
    draft.group = '  美国店铺  '
    draft.tags = [' 重点 ', '重点', '', '广告']
    const result = validateProfileDraft(draft)
    expect(result.group).toBe('美国店铺')
    expect(result.tags).toEqual(['重点', '广告'])
  })
})
