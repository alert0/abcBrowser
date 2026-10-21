import type { BrowserProfile } from '../../../shared/types'
import { effectiveFingerprintSeed, hardwareProfile } from '../../../shared/hardware-profiles'
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

function assertSafeLocale(value: string): string {
  const normalized = value.trim()
  if (!normalized || /[\r\n]/.test(normalized)) throw new Error('Apostate 语言列表无效')
  return normalized
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
  if (!authoredProfileJson && !hostMode && fp.webrtcPolicy === 'public_only') {
    throw new Error('Apostate 尚未验证 public_only WebRTC 语义，请改用“代理 UDP”或“内核默认”')
  }
}

export function buildApostateLaunchArgs(profile: BrowserProfile, options: ApostateLaunchOptions): string[] {
  assertApostateCompatible(profile)
  const fp = profile.fingerprint
  const hardware = hardwareProfile(fp.hardwareProfileId)
  const authoredProfileJson = validateApostateProfileJson(fp.apostateProfileJson ?? '')
  const hostMode = !authoredProfileJson && hardware?.hostMatched === true
  const args = [`--user-data-dir=${options.userDataDir}`]

  if (authoredProfileJson) {
    const authoredProfile = JSON.parse(authoredProfileJson) as {
      cpu?: { logical_cores?: number }
      memory?: { total_bytes?: number }
    }
    if (Number.isInteger(options.hostHardwareConcurrency) && (options.hostHardwareConcurrency ?? 0) > 0
      && typeof authoredProfile.cpu?.logical_cores === 'number') {
      authoredProfile.cpu.logical_cores = Math.min(authoredProfile.cpu.logical_cores, options.hostHardwareConcurrency!)
    }
    if (Number.isFinite(options.hostMemoryGb) && (options.hostMemoryGb ?? 0) > 0
      && typeof authoredProfile.memory?.total_bytes === 'number') {
      authoredProfile.memory.total_bytes = Math.min(
        authoredProfile.memory.total_bytes,
        Math.floor(options.hostMemoryGb! * (1024 ** 3))
      )
    }
    const effectiveProfileJson = JSON.stringify(authoredProfile)
    args.push(`--apostate-profile=${Buffer.from(effectiveProfileJson, 'utf8').toString('base64')}`)
  } else if (hostMode) {
    // Apostate host mode composes nothing. Do not send per-field overrides.
    args.push('--fingerprint=host')
  } else {
    const hardwareConcurrency = options.hostHardwareConcurrency
      ? Math.min(fp.hardwareConcurrency, options.hostHardwareConcurrency)
      : fp.hardwareConcurrency
    const networkIdentity = effectiveNetworkIdentity(fp, options.proxyIdentity, {
      allowGeoConflict: options.allowGeoConflict
    })
    const locale = assertSafeLocale(networkIdentity.acceptLanguages || fp.acceptLanguages || networkIdentity.language || fp.language)
    args.push(
      `--fingerprint=${effectiveFingerprintSeed(fp)}`,
      `--fingerprint-platform=${fp.platform}`,
      `--fingerprint-hardware-concurrency=${hardwareConcurrency}`,
      `--fingerprint-screen-width=${fp.screenWidth}`,
      `--fingerprint-screen-height=${fp.screenHeight}`,
      `--fingerprint-locale=${locale}`,
      `--fingerprint-timezone=${networkIdentity.timezone}`,
      `--lang=${networkIdentity.language}`
    )

    const configuredMemory = fp.deviceMemoryGb ?? hardware?.physicalMemoryGb
    if (configuredMemory !== undefined) {
      const memoryGb = options.hostMemoryGb && options.hostMemoryGb > 0
        ? Math.min(configuredMemory, options.hostMemoryGb)
        : configuredMemory
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
