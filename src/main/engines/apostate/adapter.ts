import type { BrowserProfile } from '../../../shared/types'
import { effectiveFingerprintSeed, hardwareProfile } from '../../../shared/hardware-profiles'
import { effectiveNetworkIdentity } from '../../../shared/network-identity'
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
  if (fp.disabledSpoofing.length) {
    throw new Error('Apostate 不支持 Prism 的“关闭部分伪装”配置，请清空该配置后再启动')
  }
  if (fp.webrtcPolicy === 'public_only') {
    throw new Error('Apostate 尚未验证 public_only WebRTC 语义，请改用“代理 UDP”或“内核默认”')
  }
}

export function buildApostateLaunchArgs(profile: BrowserProfile, options: ApostateLaunchOptions): string[] {
  assertApostateCompatible(profile)
  const fp = profile.fingerprint
  const hardware = hardwareProfile(fp.hardwareProfileId)
  const hardwareConcurrency = hardware?.hostMatched && options.hostHardwareConcurrency
    ? options.hostHardwareConcurrency
    : fp.hardwareConcurrency
  const seed = effectiveFingerprintSeed(fp)
  const networkIdentity = effectiveNetworkIdentity(fp, options.proxyIdentity, {
    allowGeoConflict: options.allowGeoConflict
  })
  const locale = assertSafeLocale(fp.acceptLanguages || fp.language)
  const args = [
    `--user-data-dir=${options.userDataDir}`,
    `--fingerprint=${seed}`,
    `--fingerprint-platform=${fp.platform}`,
    `--fingerprint-hardware-concurrency=${hardwareConcurrency}`,
    `--fingerprint-screen-width=${fp.screenWidth}`,
    `--fingerprint-screen-height=${fp.screenHeight}`,
    `--fingerprint-locale=${locale}`,
    `--fingerprint-timezone=${networkIdentity.timezone}`,
    `--lang=${networkIdentity.language}`,
    `--window-size=${profile.window.mode === 'custom' ? profile.window.width : fp.screenWidth},${profile.window.mode === 'custom' ? profile.window.height : fp.screenHeight}`,
    `--window-name=${profileWindowName(profile)}`,
    `--abc-profile-serial=${profile.serialNumber}`,
    `--abc-profile-id=${profile.id}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-mode',
    '--disable-background-networking',
    '--disable-component-update'
  ]

  const anchor = apostateAnchorForHardwareProfile(hardware)
  if (anchor) args.push(`--fingerprint-anchor=${anchor}`)
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
