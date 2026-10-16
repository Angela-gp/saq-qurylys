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
  return stepKey >= 5 && stepKey <= 7 ? Math.min(7, lastIndex) : null
}
