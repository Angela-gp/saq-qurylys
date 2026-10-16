import { Zone, zoneFor } from './risk'

export const FACTOR_WEIGHTS: Record<string, number> = {
  R1: 35,
  R2: 25,
  R3: 10,
  R4: 15,
  R5: 10,
  R6: 5,
}

export type AssessableScore = {
  score: number
  factors: { factor_code: string }[]
}

export type ReviewScenario = {
  score: number
  zone: Zone
  addedPoints: number
}

/** Isolated what-if result. Unreviewed evidence never changes the displayed score. */
export function previewFactorConfirmation(score: AssessableScore, factorCode: string): ReviewScenario {
  const confirmed = new Set(score.factors.map((factor) => factor.factor_code))
  const alreadyConfirmed = confirmed.has(factorCode)
  const addedPoints = alreadyConfirmed ? 0 : (FACTOR_WEIGHTS[factorCode] ?? 0)
  const projectedScore = Math.min(100, score.score + addedPoints)

  return {
    score: projectedScore,
    zone: zoneFor(projectedScore, confirmed.has('R1') || factorCode === 'R1', confirmed.has('R2') || factorCode === 'R2'),
    addedPoints: projectedScore - score.score,
  }
}

export function unchangedAfterRejection(score: AssessableScore): ReviewScenario {
  const confirmed = new Set(score.factors.map((factor) => factor.factor_code))
  return {
    score: score.score,
    zone: zoneFor(score.score, confirmed.has('R1'), confirmed.has('R2')),
    addedPoints: 0,
  }
}
