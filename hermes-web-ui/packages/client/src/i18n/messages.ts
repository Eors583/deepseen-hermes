import en from './locales/en'
import zh from './locales/zh'

export type LocaleMessages = Record<string, any>

export const supportedLocales = ['en', 'zh', 'zh-TW', 'ja', 'ko', 'fr', 'es', 'de', 'pt', 'ru'] as const
export type SupportedLocale = (typeof supportedLocales)[number]

function isPlainObject(value: unknown): value is LocaleMessages {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function mergeMessagesWithFallback(
  fallback: LocaleMessages,
  locale: LocaleMessages,
): LocaleMessages {
  const merged: LocaleMessages = { ...fallback }

  for (const [key, value] of Object.entries(locale)) {
    const fallbackValue = fallback[key]
    merged[key] = isPlainObject(fallbackValue) && isPlainObject(value)
      ? mergeMessagesWithFallback(fallbackValue, value)
      : value
  }

  return merged
}

const localeLoaders: Partial<Record<SupportedLocale, () => Promise<{ default: LocaleMessages }>>> = {
  'zh-TW': () => import('./locales/zh-TW'),
  ja: () => import('./locales/ja'),
  ko: () => import('./locales/ko'),
  fr: () => import('./locales/fr'),
  es: () => import('./locales/es'),
  de: () => import('./locales/de'),
  pt: () => import('./locales/pt'),
  ru: () => import('./locales/ru'),
}

export const messages: Record<string, LocaleMessages> = {
  en,
  zh: mergeMessagesWithFallback({ ...en }, { ...zh }),
}

export async function loadLocaleMessages(locale: SupportedLocale): Promise<LocaleMessages> {
  if (messages[locale]) return messages[locale]
  const loader = localeLoaders[locale]
  if (!loader) return messages.en
  const loaded = (await loader()).default
  messages[locale] = mergeMessagesWithFallback({ ...en }, { ...loaded })
  return messages[locale]
}

export { en }
