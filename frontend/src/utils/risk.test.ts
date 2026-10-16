import { describe, expect, it } from 'vitest'
import { zoneFor } from './risk'

describe('risk zone thresholds', () => {
  it('marks 24 green and 25 yellow', () => {
    expect(zoneFor(24, false, false)).toBe('green')
    expect(zoneFor(25, false, false)).toBe('yellow')
  })
  it('requires both R1 and R2 for red at 60', () => {
    expect(zoneFor(60, false, true)).toBe('yellow')
    expect(zoneFor(60, true, false)).toBe('yellow')
    expect(zoneFor(60, true, true)).toBe('red')
  })
})
