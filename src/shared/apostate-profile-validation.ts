import apostateProfileSchema from './apostate-profile.schema.json'

interface JsonSchema {
  type?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  additionalProperties?: boolean | JsonSchema
  propertyNames?: JsonSchema
  items?: JsonSchema
  contains?: JsonSchema
  minContains?: number
  maxContains?: number
  enum?: unknown[]
  minimum?: number
  maximum?: number
  multipleOf?: number
  minLength?: number
  maxLength?: number
  pattern?: string
  minItems?: number
  maxItems?: number
  uniqueItems?: boolean
}

const PROFILE_SCHEMA = apostateProfileSchema as unknown as JsonSchema
const MAX_PROFILE_JSON_BYTES = 12 * 1024

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'undefined'
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case 'object': return isObject(value)
    case 'array': return Array.isArray(value)
    case 'string': return typeof value === 'string'
    case 'boolean': return typeof value === 'boolean'
    case 'integer': return typeof value === 'number' && Number.isInteger(value)
    case 'number': return typeof value === 'number' && Number.isFinite(value)
    default: return true
  }
}

function validateNode(value: unknown, schema: JsonSchema, path: string, issues: string[], depth = 0): void {
  if (depth > 80) {
    issues.push(`${path}: nested value is too deep`)
    return
  }
  if (schema.type && !matchesType(value, schema.type)) {
    issues.push(`${path}: expected ${schema.type}`)
    return
  }
  if (schema.enum && !schema.enum.some((candidate) => stableJson(candidate) === stableJson(value))) {
    issues.push(`${path}: value is not in the allowed enum`)
  }

  if (typeof value === 'string') {
    const length = Array.from(value).length
    if (schema.minLength !== undefined && length < schema.minLength) issues.push(`${path}: string is shorter than ${schema.minLength}`)
    if (schema.maxLength !== undefined && length > schema.maxLength) issues.push(`${path}: string is longer than ${schema.maxLength}`)
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) issues.push(`${path}: string does not match the required pattern`)
    return
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (schema.minimum !== undefined && value < schema.minimum) issues.push(`${path}: number is below ${schema.minimum}`)
    if (schema.maximum !== undefined && value > schema.maximum) issues.push(`${path}: number is above ${schema.maximum}`)
    if (schema.multipleOf !== undefined) {
      const quotient = value / schema.multipleOf
      if (Math.abs(quotient - Math.round(quotient)) > 1e-9) issues.push(`${path}: number is not a multiple of ${schema.multipleOf}`)
    }
    return
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) issues.push(`${path}: array has fewer than ${schema.minItems} items`)
    if (schema.maxItems !== undefined && value.length > schema.maxItems) issues.push(`${path}: array has more than ${schema.maxItems} items`)
    if (schema.uniqueItems) {
      const seen = new Set<string>()
      for (const item of value) {
        const encoded = stableJson(item)
        if (seen.has(encoded)) {
          issues.push(`${path}: array items must be unique`)
          break
        }
        seen.add(encoded)
      }
    }
    if (schema.items) value.forEach((item, index) => validateNode(item, schema.items!, `${path}[${index}]`, issues, depth + 1))
    if (schema.contains) {
      let matches = 0
      for (const item of value) {
        const itemIssues: string[] = []
        validateNode(item, schema.contains, `${path}[]`, itemIssues, depth + 1)
        if (itemIssues.length === 0) matches += 1
      }
      const min = schema.minContains ?? 1
      if (matches < min) issues.push(`${path}: expected at least ${min} matching array item(s)`)
      if (schema.maxContains !== undefined && matches > schema.maxContains) issues.push(`${path}: expected at most ${schema.maxContains} matching array item(s)`)
    }
    return
  }

  if (isObject(value)) {
    for (const required of schema.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(value, required)) issues.push(`${path}.${required}: required property is missing`)
    }
    const properties = schema.properties ?? {}
    for (const [key, childValue] of Object.entries(value)) {
      if (schema.propertyNames) validateNode(key, schema.propertyNames, `${path} property name`, issues, depth + 1)
      const childSchema = properties[key]
      if (childSchema) {
        validateNode(childValue, childSchema, `${path}.${key}`, issues, depth + 1)
      } else if (schema.additionalProperties === false) {
        issues.push(`${path}.${key}: unexpected property`)
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        validateNode(childValue, schema.additionalProperties, `${path}.${key}`, issues, depth + 1)
      }
    }
  }
}

/**
 * Validate authored Apostate profile JSON against the pinned official v3 schema.
 * The compact JSON is returned so the base64 command-line payload stays bounded.
 */
export function validateApostateProfileJson(input: string): string {
  const text = input.trim()
  if (!text) return ''
  const bytes = new TextEncoder().encode(text).length
  if (bytes > MAX_PROFILE_JSON_BYTES) {
    throw new Error('Apostate Profile JSON 不能超过 12 KiB，避免超过 Windows 命令行长度限制')
  }

  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('Apostate Profile 必须是有效的 JSON')
  }

  const issues: string[] = []
  validateNode(value, PROFILE_SCHEMA, '$', issues)
  if (issues.length) {
    throw new Error(`Apostate Profile v3 校验失败：${issues.slice(0, 6).join('；')}`)
  }
  return JSON.stringify(value)
}
