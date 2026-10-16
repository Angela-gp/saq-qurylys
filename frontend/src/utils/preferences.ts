export type ThemeName = 'light' | 'dark'

export function loadThemePreference(prefersDark = false): ThemeName {
  try {
    const saved = localStorage.getItem('saq-theme')
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    // Use the system setting when storage is unavailable.
  }
  return prefersDark ? 'dark' : 'light'
}

export function saveThemePreference(theme: ThemeName) {
  try { localStorage.setItem('saq-theme', theme) } catch { /* session-only preference */ }
}

export function hasSeenTour() {
  try { return localStorage.getItem('saq-tour-seen') === 'true' } catch { return false }
}

export function markTourSeen(completed = false) {
  try {
    localStorage.setItem('saq-tour-seen', 'true')
    if (completed) localStorage.setItem('saq-tour-complete', 'true')
  } catch { /* tour remains usable in private browsing */ }
}

export function skipUnavailableObjectStep(stepKey: number, lastIndex: number) {
  if (stepKey === 3) return Math.min(3, lastIndex)
  return stepKey >= 5 && stepKey <= 7 ? Math.min(7, lastIndex) : null
}

export type TourRect = { left: number; top: number; right: number; bottom: number }
export type ScrimRect = { left: number; top: number; width: number; height: number }

export function tourScrimRects(
  target: TourRect | null,
  viewportWidth: number,
  viewportHeight: number,
  padding = 8,
): ScrimRect[] {
  if (!target) return [{ left: 0, top: 0, width: viewportWidth, height: viewportHeight }]
  const left = Math.max(0, target.left - padding)
  const top = Math.max(0, target.top - padding)
  const right = Math.min(viewportWidth, target.right + padding)
  const bottom = Math.min(viewportHeight, target.bottom + padding)
  return [
    { left: 0, top: 0, width: viewportWidth, height: top },
    { left: 0, top: bottom, width: viewportWidth, height: Math.max(0, viewportHeight - bottom) },
    { left: 0, top, width: left, height: Math.max(0, bottom - top) },
    { left: right, top, width: Math.max(0, viewportWidth - right), height: Math.max(0, bottom - top) },
  ].filter((rect) => rect.width > 0 && rect.height > 0)
}
