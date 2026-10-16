import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import ru from './locales/ru.json'
import kk from './locales/kk.json'

function preferredLanguage(): 'ru' | 'kk' {
  try {
    const saved = localStorage.getItem('saq-language')
    if (saved === 'ru' || saved === 'kk') return saved
  } catch {
    // Private browsing may disable local storage; use the browser locale below.
  }
  return navigator.language.toLowerCase().startsWith('kk') ? 'kk' : 'ru'
}

i18n.use(initReactI18next).init({
  lng: preferredLanguage(),
  fallbackLng: 'ru',
  interpolation: { escapeValue: false, prefix: '{', suffix: '}' },
  resources: { ru: { translation: ru }, kk: { translation: kk } },
})

i18n.on('languageChanged', (language) => {
  try {
    localStorage.setItem('saq-language', language.startsWith('kk') ? 'kk' : 'ru')
  } catch {
    // The active session remains localized even when persistence is unavailable.
  }
})

export function localeCode(language = i18n.language) {
  return language.startsWith('kk') ? 'kk-KZ' : 'ru-KZ'
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat(localeCode(), options).format(value)
}

export function formatDate(value?: string | null, options?: Intl.DateTimeFormatOptions) {
  if (!value) return i18n.t('common.dateUnknown')
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return i18n.t('common.dateUnknown')
  return new Intl.DateTimeFormat(localeCode(), options ?? { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date)
}

export default i18n
