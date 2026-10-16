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

  it('does not leave Russian wording untranslated except proper names and codes', () => {
    for (const [key, value] of Object.entries(ru)) {
      if (allowedSame.has(key) || /^R[1-6]$/.test(value)) continue
      expect(kk[key], `kk.${key} must differ from ru.${key}`).not.toBe(value)
    }
  })

})
