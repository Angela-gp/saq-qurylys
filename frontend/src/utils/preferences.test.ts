import { afterEach, describe, expect, it, vi } from 'vitest'
import { hasSeenTour, loadThemePreference, markTourSeen, saveThemePreference, skipUnavailableObjectStep } from './preferences'

afterEach(() => localStorage.clear())

describe('saved interface preferences', () => {
  it('stores and loads language-independent theme choice', () => {
    saveThemePreference('dark')
    expect(loadThemePreference(false)).toBe('dark')
  })

  it('uses system preference when storage throws', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    expect(loadThemePreference(true)).toBe('dark')
    get.mockRestore()
  })

  it('marks tour seen safely and recognizes skipped object-card steps', () => {
    expect(hasSeenTour()).toBe(false)
    markTourSeen()
    expect(hasSeenTour()).toBe(true)
    expect(skipUnavailableObjectStep(5, 8)).toBe(7)
    expect(skipUnavailableObjectStep(6, 8)).toBe(7)
    expect(skipUnavailableObjectStep(3, 8)).toBe(3)
    expect(skipUnavailableObjectStep(4, 8)).toBeNull()
  })

  it('marks the tour as seen when localStorage is unavailable', () => {
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(() => markTourSeen(true)).not.toThrow()
    set.mockRestore()
  })
})
