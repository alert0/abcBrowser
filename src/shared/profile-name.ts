import { t } from './i18n'

export const PROFILE_NAME_MAX_LENGTH = 60

/**
 * Names the app generates for copies, imports and migrations use the interface
 * language of the moment (“A copy”, “A（副本）”) and stay within the name limit.
 * The template must be a catalog key such as '{0} 副本'.
 */
export function suffixedProfileName(template: string, name: string, maxLength = PROFILE_NAME_MAX_LENGTH): string {
  const room = Math.max(1, maxLength - t(template, '').length)
  let base = name.slice(0, room)
  if (/[\uD800-\uDBFF]$/.test(base)) base = base.slice(0, -1)
  return t(template, base)
}
