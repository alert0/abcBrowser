import { describe, expect, it } from 'vitest'
import { validateApostateProfileJson } from './apostate-profile-validation'

describe('Apostate v3 profile schema validation', () => {
  const minimalProfile = JSON.stringify({
    cpu: { logical_cores: 8 },
    memory: { total_bytes: 17179869184 },
    screen: {
      width: 1536,
      height: 864,
      avail_width: 1536,
      avail_height: 816,
      device_pixel_ratio: 1.25,
      color_depth: 24
    },
    locale: { application: 'en-GB', timezone: 'Europe/London' }
  })

  it('accepts a minimal profile from the official v3 schema and compacts JSON', () => {
    const result = validateApostateProfileJson(minimalProfile)
    expect(result).toBe(JSON.stringify(JSON.parse(minimalProfile)))
  })

  it('rejects unknown properties and incorrect types', () => {
    expect(() => validateApostateProfileJson('{"unexpected":true}')).toThrow('unexpected property')
    expect(() => validateApostateProfileJson('{"cpu":{"logical_cores":"8"}}')).toThrow('expected integer')
  })

  it('rejects oversized payloads before parsing or encoding', () => {
    expect(() => validateApostateProfileJson('x'.repeat(13 * 1024))).toThrow('12 KiB')
  })
})
