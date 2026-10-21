import type { HardwareProfile } from '../../../shared/hardware-profiles'
import type { ApostateGpuAnchor } from '../../../shared/types'

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
  { key: 'hostMode', status: 'supported', switchName: '--fingerprint=host', note: '真实主机模式；不组合 persona，也不应用逐字段覆盖' },
  { key: 'fingerprint', status: 'supported', switchName: '--fingerprint', note: '稳定的环境种子；同一宿主 CPU 家族下可复现' },
  { key: 'platform', status: 'supported', switchName: '--fingerprint-platform', note: 'abcBrowser 当前提供 windows、macos；内核另支持 linux' },
  { key: 'hardwareConcurrency', status: 'supported', switchName: '--fingerprint-hardware-concurrency', note: '不能超过宿主逻辑核心数；启动前会保守限制' },
  { key: 'deviceMemory', status: 'supported', switchName: '--fingerprint-device-memory', note: '按 GiB 设置并限制在宿主物理内存范围内' },
  { key: 'screen', status: 'supported', switchName: '--fingerprint-screen-width/height', note: '受窗口和桌面区域约束' },
  { key: 'locale', status: 'supported', switchName: '--fingerprint-locale', note: '使用单标签或逗号分隔的语言列表' },
  { key: 'timezone', status: 'supported', switchName: '--fingerprint-timezone', note: '必须是 IANA 时区名' },
  { key: 'gpuAnchor', status: 'supported', switchName: '--fingerprint-anchor', note: '使用 Apostate 官方 GPU 家族 ID；auto 交由种子选择' },
  { key: 'gpuRenderer', status: 'supported', switchName: '--fingerprint-gpu-renderer', note: '精确 renderer 必须属于所选 GPU 家族，内核会校验' },
  { key: 'canvasWebglNoise', status: 'supported', switchName: '--fingerprint-noise', note: '可选、默认关闭；主机模式下无效' },
  { key: 'fingerprintExplain', status: 'supported', switchName: '--fingerprint-explain', note: 'Host/Seed 打印组合报告后退出；Custom Profile 不保证输出或退出，必须使用 API 验证' },
  { key: 'customProfile', status: 'supported', switchName: '--apostate-profile', note: '官方 v3 JSON schema；明确优先于 Host/Seed，忽略其逐字段设置。省略字段原则上继承宿主，但本地 155.0.8059.31 省略语言时实测回退 en-US，应显式填写 locale' },
  { key: 'webrtc', status: 'supported', switchName: '--fingerprint-webrtc-udp', note: 'proxy_only 映射为 block；default 保持内核默认' },
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
 * Apostate uses a family anchor instead of Prism's numeric GPU bucket.
 * An explicit user choice wins; auto leaves family selection to the seed.
 */
export function apostateAnchorForHardwareProfile(
  profile: HardwareProfile | undefined,
  configuredAnchor?: ApostateGpuAnchor
): string | undefined {
  if (profile?.hostMatched) return undefined
  if (configuredAnchor !== undefined) return configuredAnchor === 'auto' ? undefined : configuredAnchor
  if (!profile) return undefined
  if (profile.platform === 'windows' && /nvidia|rtx/i.test(profile.gpuModel)) {
    return 'windows-d3d11-nvidia-0947761dfbe9'
  }
  if (profile.platform === 'windows' && /intel/i.test(profile.gpuModel)) {
    return 'windows-d3d11-intel-79dfeb5b4f99'
  }
  if (profile.platform === 'macos' && /apple/i.test(profile.gpuModel)) {
    return 'macos-metal-apple-850a91233555'
  }
  return undefined
}
