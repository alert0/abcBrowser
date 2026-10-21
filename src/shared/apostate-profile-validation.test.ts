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

  it('enforces const and exclusive numeric bounds from the official schema', () => {
    expect(() => validateApostateProfileJson(JSON.stringify({
      screen: {
        displays: [{
          left: 0,
          top: 0,
          width: 1920,
          height: 1080,
          avail_width: 1920,
          avail_height: 1040,
          device_pixel_ratio: 1,
          color_depth: 24,
          is_primary: false,
          is_internal: true,
          label: 'Display 1'
        }]
      }
    }))).toThrow('matching array item')
    expect(() => validateApostateProfileJson(JSON.stringify({
      theme: { system_fonts: { caption: { family: 'Arial', size_px: 0 } } }
    }))).toThrow('number must be greater than 0')
  })

  it('rejects oversized payloads before parsing or encoding', () => {
    expect(() => validateApostateProfileJson('x'.repeat(13 * 1024))).toThrow('12 KiB')
  })
})
