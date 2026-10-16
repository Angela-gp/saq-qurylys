import { describe, expect, it } from 'vitest'
import { previewFactorConfirmation, unchangedAfterRejection } from './assessment'

describe('analyst what-if scenarios', () => {
  const scenarioA = {
    score: 35,
    factors: [{ factor_code: 'R2' }, { factor_code: 'R3' }],
  }

  it('shows what an unconfirmed missing basis would change without altering the current score', () => {
    expect(previewFactorConfirmation(scenarioA, 'R1')).toEqual({
      score: 70,
      zone: 'red',
      addedPoints: 35,
    })
    expect(unchangedAfterRejection(scenarioA)).toEqual({
      score: 35,
      zone: 'yellow',
      addedPoints: 0,
    })
    expect(scenarioA.score).toBe(35)
  })

  it('applies the 100 point cap and does not add a duplicate factor twice', () => {
    expect(previewFactorConfirmation({ score: 95, factors: [{ factor_code: 'R1' }, { factor_code: 'R2' }] }, 'R6')).toEqual({
      score: 100,
      zone: 'red',
      addedPoints: 5,
    })
    expect(previewFactorConfirmation({ score: 70, factors: [{ factor_code: 'R1' }] }, 'R1')).toEqual({
      score: 70,
      zone: 'yellow',
      addedPoints: 0,
    })
  })
})
