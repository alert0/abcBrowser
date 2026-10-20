import type { HardwareProfile } from '../../../shared/hardware-profiles'

export const APOSTATE_ENGINE_ID = 'apostate' as const
export const APOSTATE_ENGINE_RELEASE = 'v0.5.1' as const
export const APOSTATE_CHROMIUM_VERSION = '155.0.8059.31' as const

export type ApostateCapabilityStatus = 'supported' | 'unsupported' | 'unverified' | 'not-applicable'

export interface ApostateCapability {
  key: string
  status: ApostateCapabilityStatus
  switchName?: string
  note: string
}

export const APOSTATE_CAPABILITIES: readonly ApostateCapability[] = [
  { key: 'fingerprint', status: 'supported', switchName: '--fingerprint', note: '稳定的环境种子' },
  { key: 'platform', status: 'supported', switchName: '--fingerprint-platform', note: '仅允许 windows、macos 或 linux' },
  { key: 'hardwareConcurrency', status: 'supported', switchName: '--fingerprint-hardware-concurrency', note: '受主机逻辑核心数限制' },
  { key: 'screen', status: 'supported', switchName: '--fingerprint-screen-width/height', note: '受实际窗口和屏幕边界限制' },
  { key: 'locale', status: 'supported', switchName: '--fingerprint-locale', note: '使用单标签或逗号分隔的语言列表' },
  { key: 'timezone', status: 'supported', switchName: '--fingerprint-timezone', note: '必须是 IANA 时区名' },
  { key: 'webrtc', status: 'supported', switchName: '--fingerprint-webrtc-udp', note: 'proxy_only 映射为 block；default 保持内核默认' },
  { key: 'gpuAnchor', status: 'unverified', switchName: '--fingerprint-anchor', note: '仅按已知 GPU 家族映射，不能替代旧版 bucket' },
  { key: 'deviceMemory', status: 'unverified', switchName: '--fingerprint-device-memory', note: '当前环境模型尚未保存该字段' },
  { key: 'brandVersion', status: 'unsupported', note: '品牌版本由实际 Apostate 二进制决定' },
  { key: 'platformVersion', status: 'unsupported', note: '没有确认的等效启动参数' },
  { key: 'renderIdentity', status: 'unsupported', note: '不透传 Prism render identity 版本' },
  { key: 'location', status: 'unsupported', note: '未实现浏览器 Geolocation API 模拟' },
  { key: 'disabledSpoofing', status: 'unsupported', note: '不透传旧版 selective spoofing 开关' },
  { key: 'webrtcPublicOnly', status: 'unverified', note: '没有经过验证的 public_only 等价语义' }
]

export function apostateCapabilities(): readonly ApostateCapability[] {
  return APOSTATE_CAPABILITIES
}

/**
 * Apostate uses a family anchor instead of Prism's numeric GPU bucket. The
 * mapping is deliberately narrow; unknown or host-native templates inherit
 * Apostate's own catalogue and are not guessed here.
 */
export function apostateAnchorForHardwareProfile(profile: HardwareProfile | undefined): string | undefined {
  if (!profile || profile.hostMatched) return undefined
  if (profile.platform === 'windows' && /nvidia|rtx/i.test(profile.gpuModel)) {
    return 'windows-d3d11-nvidia-0947761df4f3'
  }
  if (profile.platform === 'macos' && /apple/i.test(profile.gpuModel)) {
    return 'macos-metal-apple-850a91233555'
  }
  return undefined
}
