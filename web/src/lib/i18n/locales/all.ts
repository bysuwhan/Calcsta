import en from './en';
import ko from './ko';
import koApp from './ko-app';
import steelEn from './steel/en';
import { generatedEnglishParity, generatedKoreanParity } from './generated-parity';
import type { Translations } from '../types';

/** Dictionaries maintained on disk, for translation checks. */
export const ALL_DICTS: Record<string, Translations> = {
  en: { ...en, ...steelEn, ...generatedEnglishParity },
  ko: { ...ko, ...koApp, ...generatedKoreanParity },
};

export function allShippedLocales(): string[] { return Object.keys(ALL_DICTS); }
export function allDictFor(locale: string): Record<string, string> { return ALL_DICTS[locale] ?? {}; }
