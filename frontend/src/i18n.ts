import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

i18n.use(initReactI18next).init({
  lng: 'ru',
  fallbackLng: 'ru',
  interpolation: { escapeValue: false },
  resources: {
    ru: {
      translation: {
        overview: 'Обзор',
        registry: 'Реестр',
        ads: 'Реклама',
        signals: 'Сигналы',
        sources: 'Источники',
        empty: 'В базе пока нет объектов',
        emptyHint: 'Импортируйте реестр Ashyq Data или добавьте объект вручную.',
        import: 'Импортировать CSV / Excel',
        addObject: 'Добавить объект',
        all: 'Все объекты',
        review: 'Требуют проверки',
      },
    },
    kk: {
      translation: {
        overview: 'Шолу',
        registry: 'Тізілім',
        ads: 'Жарнама',
        signals: 'Сигналдар',
        sources: 'Дереккөздер',
        empty: 'Әзірге нысандар жоқ',
        emptyHint: 'Ashyq Data тізілімін импорттаңыз немесе нысанды қолмен қосыңыз.',
        import: 'CSV / Excel импорттау',
        addObject: 'Нысан қосу',
        all: 'Барлық нысандар',
        review: 'Тексеруді қажет етеді',
      },
    },
  },
})
export default i18n
