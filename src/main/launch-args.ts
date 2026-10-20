import { buildApostateLaunchArgs, profileWindowName } from './engines/apostate/adapter'
import type { ApostateLaunchOptions } from './engines/apostate/types'
import type { BrowserProfile } from '../shared/types'

export type LaunchArgumentOptions = ApostateLaunchOptions

export { profileWindowName }

/** Compatibility entry point retained for Prism's existing launcher/tests. */
export function buildLaunchArgs(profile: BrowserProfile, options: LaunchArgumentOptions): string[] {
  return buildApostateLaunchArgs(profile, options)
}
