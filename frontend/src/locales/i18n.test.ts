import { describe, expect, it } from 'vitest'
import russian from './ru.json'
import kazakh from './kk.json'

const ru = russian as Record<string, string>
const kk = kazakh as Record<string, string>

const allowedSame = new Set([
  'app.name',
  'common.demo',
  'sources.name.elicense',
  'sources.name.qazreestr',
  'sources.name.equrylys',
])

describe('complete RU/KK dictionaries', () => {
  it('has the same keys and no empty translations', () => {
    expect(Object.keys(kk).sort()).toEqual(Object.keys(ru).sort())
    for (const [key, value] of Object.entries(ru)) {
      expect(value.trim(), `ru.${key}`).not.toBe('')
      expect(kk[key].trim(), `kk.${key}`).not.toBe('')
    }
  })

  it('contains the user-facing strings required by login, sources, errors, and the guided tour', () => {
    const requiredKeys = [
      'auth.title', 'auth.invalidCredentials', 'auth.rateLimited', 'auth.role.analyst',
      'sources.manualReview', 'sources.manualIsNotMissing', 'sources.whatToCheck.homeportal',
      'errors.unexpected', 'errors.file_too_large', 'errors.analyst_role_required',
      'errors.authentication_required', 'errors.invalid_telegram_export', 'tour.start', 'tour.step1.title',
      'tour.step9.body', 'tour.fallback',
    ]
    for (const key of requiredKeys) {
      expect(ru[key]?.trim(), `ru.${key}`).toBeTruthy()
      expect(kk[key]?.trim(), `kk.${key}`).toBeTruthy()
    }
  })

  it('does not leave Russian wording untranslated except proper names and codes', () => {
    for (const [key, value] of Object.entries(ru)) {
      if (allowedSame.has(key) || /^R[1-6]$/.test(value)) continue
      expect(kk[key], `kk.${key} must differ from ru.${key}`).not.toBe(value)
    }
  })

})
