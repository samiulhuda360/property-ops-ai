import { describe, expect, it } from 'vitest'
import { formatIrdNumber, isValidIrdNumber } from '../src/lib/ird'

describe('IRD / GST number check', () => {
  it("accepts Inland Revenue's published examples", () => {
    for (const n of ['49-091-850', '35-901-981', '49-098-576', '136-410-132']) expect(isValidIrdNumber(n)).toBe(true)
  })

  it('rejects a wrong check digit, the wrong length and numbers outside the issued range', () => {
    expect(isValidIrdNumber('49-091-851')).toBe(false)
    expect(isValidIrdNumber('12-345-678')).toBe(false)
    expect(isValidIrdNumber('1234567')).toBe(false)
    expect(isValidIrdNumber('150-000-001')).toBe(false)
  })

  it('formats nine digits with dashes', () => {
    expect(formatIrdNumber('49091850')).toBe('049-091-850')
  })
})
