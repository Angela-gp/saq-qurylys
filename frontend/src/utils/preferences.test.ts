import { afterEach, describe, expect, it, vi } from 'vitest'
import { hasSeenTour, loadThemePreference, markTourSeen, saveThemePreference, skipUnavailableObjectStep, tourScrimRects } from './preferences'

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

  it('leaves a clear and clickable window around the guided-tour target', () => {
    const blocks = tourScrimRects({ left: 100, top: 80, right: 260, bottom: 140 }, 1280, 800)
    expect(blocks).toHaveLength(4)
    expect(blocks.some((block) => 180 > block.left && 180 < block.left + block.width && 110 > block.top && 110 < block.top + block.height)).toBe(false)
    expect(blocks.some((block) => block.left === 0 && block.top === 0)).toBe(true)
  })
})
