import type { BrowserProfile } from '../../../shared/types'
import { hardwareProfile } from '../../../shared/hardware-profiles'
import { hostHardwareSnapshot } from '../../host-hardware'
import { effectiveNetworkIdentity } from '../../../shared/network-identity'
import { validateApostateProfileJson } from '../../../shared/apostate-profile-validation'
import {
  apostateAnchorForHardwareProfile,
  APOSTATE_ENGINE_ID,
  APOSTATE_ENGINE_RELEASE
} from './capabilities'
import type { ApostateLaunchOptions } from './types'

export function profileWindowName(profile: Pick<BrowserProfile, 'serialNumber' | 'name'>): string {
  const name = profile.name
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60) || 'abcBrowser 环境'
  return `[${profile.serialNumber}] ${name}`
}

function assertSafeLocale(value: string, language: string): string {
  const normalized = value.trim()
  try {
    const tags = normalized.split(',').map(tag => Intl.getCanonicalLocales(tag.trim())[0])
    if (!tags.length || tags.some(tag => !tag) || tags[0] !== Intl.getCanonicalLocales(language.trim())[0]) {
      throw new Error('conflicting primary locale')
    }
    return tags.join(',')
  } catch {
    throw new Error('Apostate 语言列表必须由语言标签组成，首项必须与界面语言一致')
  }
}

export function assertApostateCompatible(profile: BrowserProfile): void {
  const fp = profile.fingerprint
  const hardware = hardwareProfile(fp.hardwareProfileId)
  const authoredProfileJson = validateApostateProfileJson(fp.apostateProfileJson ?? '')
  const hostPlatform = process.platform === 'win32' ? 'windows' : 'macos'
  const hostMode = !authoredProfileJson && hardware?.hostMatched === true
  if (!authoredProfileJson && hostMode && hardware?.platform !== hostPlatform) {
    throw new Error('Apostate 主机模式只能选择与当前宿主系统一致的本机硬件模板')
  }
  if (!authoredProfileJson && fp.disabledSpoofing.length && !hostMode) {
    throw new Error('Apostate 不支持 Prism 的“关闭部分伪装”配置，请清空该配置后再启动')
  }
  if (fp.webrtcPolicy === 'public_only') {
    throw new Error('Apostate 尚未验证 public_only WebRTC 语义，请改用“代理 UDP”或“内核默认”')
  }
  if (!authoredProfileJson && !hostMode) {
    if (!Number.isInteger(fp.seed) || fp.seed < 1 || fp.seed > 0xffffffff) {
      throw new Error('Apostate Seed 模式种子必须是 1–4294967295；0 表示主机模式')
    }
    if (!['windows', 'macos'].includes(fp.platform)) throw new Error('Apostate 平台配置无效')
    for (const [name, value, maximum] of [
      ['CPU', fp.hardwareConcurrency, 4096], ['屏幕宽度', fp.screenWidth, 65535],
      ['屏幕高度', fp.screenHeight, 65535], ['设备内存', fp.deviceMemoryGb ?? hardware?.physicalMemoryGb ?? 8, 4096]
    ] as const) {
      if (!Number.isInteger(value) || value < 1 || value > maximum) throw new Error(`Apostate ${name}必须是 1–${maximum} 的整数`)
    }
    const anchor = apostateAnchorForHardwareProfile(hardware, fp.gpuAnchor)
    const knownAnchors = ['windows-d3d11-intel-79dfeb5b4f99', 'windows-d3d11-nvidia-0947761dfbe9',
      'windows-d3d11-qualcomm-6388f9914f3f', 'macos-metal-apple-850a91233555']
    if ((anchor && (!knownAnchors.includes(anchor) || !anchor.startsWith(`${fp.platform}-`)))
      || (fp.gpuRenderer?.trim() && !anchor)) {
      throw new Error('Apostate GPU renderer 必须配合与平台一致的固定 GPU 家族')
    }
  }
}

export function buildApostateLaunchArgs(profile: BrowserProfile, options: ApostateLaunchOptions): string[] {
  assertApostateCompatible(profile)
  const fp = profile.fingerprint
  const hardware = hardwareProfile(fp.hardwareProfileId)
  const authoredProfileJson = validateApostateProfileJson(fp.apostateProfileJson ?? '')
  const hostMode = !authoredProfileJson && hardware?.hostMatched === true
  const actualHost = hostHardwareSnapshot()
  const hostCores = Math.min(actualHost.hardwareConcurrency, options.hostHardwareConcurrency ?? actualHost.hardwareConcurrency)
  const hostMemoryGb = Math.min(actualHost.physicalMemoryGb, options.hostMemoryGb ?? actualHost.physicalMemoryGb)
  if (!Number.isInteger(hostCores) || hostCores < 1 || !Number.isFinite(hostMemoryGb) || hostMemoryGb < 1) {
    throw new Error('Apostate 宿主 CPU 或内存限制无效')
  }
  const args = [`--user-data-dir=${options.userDataDir}`]

  if (authoredProfileJson) {
    const authoredProfile = JSON.parse(authoredProfileJson) as {
      cpu?: { logical_cores?: number }
      memory?: { total_bytes?: number }
    }
    if (typeof authoredProfile.cpu?.logical_cores === 'number') {
      authoredProfile.cpu.logical_cores = Math.min(authoredProfile.cpu.logical_cores, hostCores)
    }
    if (typeof authoredProfile.memory?.total_bytes === 'number') {
      authoredProfile.memory.total_bytes = Math.min(
        authoredProfile.memory.total_bytes,
        Math.floor(hostMemoryGb * (1024 ** 3))
      )
    }
    const effectiveProfileJson = JSON.stringify(authoredProfile)
    args.push(`--apostate-profile=${Buffer.from(effectiveProfileJson, 'utf8').toString('base64')}`)
  } else if (hostMode) {
    // Apostate host mode composes nothing. Do not send per-field overrides.
    args.push('--fingerprint=host')
  } else {
    const hardwareConcurrency = Math.min(fp.hardwareConcurrency, hostCores)
    const networkIdentity = effectiveNetworkIdentity(fp, options.proxyIdentity, {
      allowGeoConflict: options.allowGeoConflict
    })
    const locale = assertSafeLocale(networkIdentity.acceptLanguages || fp.acceptLanguages || networkIdentity.language || fp.language, networkIdentity.language)
    try { new Intl.DateTimeFormat('en', { timeZone: networkIdentity.timezone }).format() }
    catch { throw new Error('Apostate 时区必须是有效 IANA 时区') }
    args.push(
      `--fingerprint=${fp.seed}`,
      `--fingerprint-platform=${fp.platform}`,
      `--fingerprint-hardware-concurrency=${hardwareConcurrency}`,
      `--fingerprint-screen-width=${fp.screenWidth}`,
      `--fingerprint-screen-height=${fp.screenHeight}`,
      `--fingerprint-locale=${locale}`,
      `--fingerprint-timezone=${networkIdentity.timezone}`
    )

    const configuredMemory = fp.deviceMemoryGb ?? hardware?.physicalMemoryGb
    if (configuredMemory !== undefined) {
      const memoryGb = Math.min(configuredMemory, Math.floor(hostMemoryGb))
      args.push(`--fingerprint-device-memory=${memoryGb}`)
    }

    const anchor = apostateAnchorForHardwareProfile(hardware, fp.gpuAnchor)
    if (anchor) args.push(`--fingerprint-anchor=${anchor}`)
    if (fp.gpuRenderer?.trim()) args.push(`--fingerprint-gpu-renderer=${fp.gpuRenderer.trim()}`)
    if (fp.canvasWebglNoise) args.push('--fingerprint-noise')
  }

  const authoredScreen = authoredProfileJson
    ? JSON.parse(authoredProfileJson) as { screen?: { width?: number; height?: number } }
    : undefined
  const windowWidth = profile.window.mode === 'custom'
    ? profile.window.width
    : authoredProfileJson
      ? Math.min(profile.window.width, authoredScreen?.screen?.width ?? profile.window.width)
      : hostMode ? profile.window.width : fp.screenWidth
  const windowHeight = profile.window.mode === 'custom'
    ? profile.window.height
    : authoredProfileJson
      ? Math.min(profile.window.height, authoredScreen?.screen?.height ?? profile.window.height)
      : hostMode ? profile.window.height : fp.screenHeight
  if (![windowWidth, windowHeight].every(value => Number.isInteger(value) && value > 0)) {
    throw new Error('Apostate 窗口尺寸必须是正整数')
  }
  const screen = authoredScreen?.screen ?? (hostMode ? undefined : { width: fp.screenWidth, height: fp.screenHeight })
  if ((screen?.width !== undefined && windowWidth > screen.width)
    || (screen?.height !== undefined && windowHeight > screen.height)) {
    throw new Error('Apostate 窗口尺寸不能大于声明的屏幕尺寸')
  }
  args.push(
    `--window-size=${windowWidth},${windowHeight}`,
    `--window-name=${profileWindowName(profile)}`,
    `--abc-profile-serial=${profile.serialNumber}`,
    `--abc-profile-id=${profile.id}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-mode',
    '--disable-background-networking',
    '--disable-component-update'
  )
  if (profile.window.mode === 'custom') args.push(`--window-position=${profile.window.x},${profile.window.y}`)
  if (fp.webrtcPolicy === 'proxy_only') args.push('--fingerprint-webrtc-udp=block')
  if (options.proxyUrl) {
    args.push('--disable-quic', '--dns-prefetch-disable', '--no-pings')
    args.push(`--proxy-server=${options.proxyUrl}`, '--proxy-bypass-list=localhost;127.0.0.1')
  }
  if (options.remoteDebuggingPort) args.push(`--remote-debugging-port=${options.remoteDebuggingPort}`)
  if (options.extensionPaths?.length) args.push(`--load-extension=${options.extensionPaths.join(',')}`)
  args.push(...profile.startUrls)
  return args
}

export const apostateAdapter = {
  id: APOSTATE_ENGINE_ID,
  release: APOSTATE_ENGINE_RELEASE,
  buildLaunchArgs: buildApostateLaunchArgs,
  assertCompatible: assertApostateCompatible
} satisfies import('./types').ApostateAdapter
