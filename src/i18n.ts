import en from './i18n/en.json'
import zhCn from './i18n/zh-cn.json'

const languages = {
  en,
  zhCn,
} as const

function getCurrentLanguage(): keyof typeof languages {
  const steamLang = window.LocalizationManager.m_rgLocalesToUse[0]
  const lang = steamLang.replace(/-([a-z])/g, (_, letter: string) =>
    letter.toUpperCase()
  ) as keyof typeof languages
  return languages[lang] ? lang : 'en'
}

function useTranslations(lang: keyof typeof languages) {
  return function (key: keyof (typeof languages)['en']): string {
    if (languages[lang]?.[key]?.length) {
      return languages[lang]?.[key]
    } else if (languages.en?.[key]?.length) {
      return languages.en?.[key]
    } else {
      return key.toString()
    }
  }
}

export default { getCurrentLanguage, useTranslations }