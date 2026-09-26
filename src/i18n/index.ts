import en from './en.json';
import es from './es.json';

export type Locale = 'en' | 'es';
type TranslationKey = keyof typeof en;
const dictionaries: Record<Locale, Record<TranslationKey, string>> = { en, es };

const getStoredLocale = (): Locale => {
  if (typeof window === 'undefined' || !window.localStorage) return 'en';
  const stored = window.localStorage.getItem('genelab-locale');
  return stored === 'es' ? 'es' : 'en';
};

let currentLocale: Locale = getStoredLocale();

export const getLocale = (): Locale => currentLocale;

export const setLocale = (locale: Locale): void => {
  currentLocale = locale;
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem('genelab-locale', locale);
  }
  document.documentElement.lang = locale;
};

export const t = (key: TranslationKey): string => dictionaries[currentLocale][key] ?? dictionaries.en[key];