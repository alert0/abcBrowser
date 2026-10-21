import { describe, expect, it, vi } from 'vitest'
import { hostHardwareSnapshot } from './host-hardware'
import { availableParallelism, totalmem } from 'node:os'

vi.mock('node:os', () => ({ availableParallelism: vi.fn(), totalmem: vi.fn(), release: () => '10.0.26100' }))

describe('physical host limits', () => {
  it.each([1, 16, 128])('does not invent or truncate a %s-core host', cores => {
    vi.mocked(availableParallelism).mockReturnValue(cores)
    vi.mocked(totalmem).mockReturnValue(7.8 * 1024 ** 3)
    expect(hostHardwareSnapshot()).toMatchObject({ hardwareConcurrency: cores, physicalMemoryGb: 7.8 })
  })
})
