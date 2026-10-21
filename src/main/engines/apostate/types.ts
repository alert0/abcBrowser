import type { BrowserProfile, ProxyCheckSummary } from '../../../shared/types'

export interface ApostateLaunchOptions {
  userDataDir: string
  proxyUrl?: string
  remoteDebuggingPort?: number
  extensionPaths?: string[]
  engineVersion?: string
  fingerprintKernel?: boolean
  /** Optional tighter limits; the adapter always checks the real host too. */
  hostHardwareConcurrency?: number
  /** Physical GiB, possibly fractional. Seed switches require whole GiB. */
  hostMemoryGb?: number
  hostPlatformVersion?: string
  proxyIdentity?: ProxyCheckSummary
  allowGeoConflict?: boolean
}

export interface ApostateAdapter {
  readonly id: 'apostate'
  readonly release: string
  buildLaunchArgs(profile: BrowserProfile, options: ApostateLaunchOptions): string[]
  assertCompatible(profile: BrowserProfile): void
}
