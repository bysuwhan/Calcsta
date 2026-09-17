import en from './locales/en';
import ko from './locales/ko';
import koApp from './locales/ko-app';
import steelEn from './locales/steel/en';
import { generatedEnglishParity, generatedKoreanParity } from './locales/generated-parity';
import type { Translations } from './types';


const dicts: Record<string, Translations> = {
  en: { ...en, ...steelEn, ...generatedEnglishParity },
  // Korean copy predates several newer foundation surfaces. Keep the
  // complete English key set as a fallback while the maintained Korean copy
  // overrides it, so a newly added control never renders its internal key.
  ko: { ...en, ...steelEn, ...generatedEnglishParity, ...ko, ...koApp, ...generatedKoreanParity },
};


function isBasicRemovedProductKey(key: string): boolean {
  const lower = key.toLowerCase();
  // Product-facing 3D copy is consistently named with a `3d` segment/suffix.
  // The DSM/kinematic "step3" descriptions are workflow step three, not a
  // spatial product surface, so keep those two technical labels.
  if (lower.includes('3d') && !lower.startsWith('dsm.step3') && !lower.startsWith('kin.step3')) return true;
  if (/^(?:pro(?:\.|ribbon|project|panel|workspace|verification)|app\.pro\b|viewport3d\.|ifc\.|switch2d\.)/i.test(key)) return true;
  if (/^ex\.(?:[^.]*3d|pro-|rc-|cad-|offshore|fullstadium|stadiumcanopy|suspensionbridge|cablestayedbridge|geodesicdome|labombonera|torreirregular)/i.test(key)) return true;
  return /^(?:demo\.basics3d\.|demo\.navigation\.pan3d|template\.structures3d|project\.openifc(?:tooltip)?|cad\.pro(?:barbtn|v(?:title|file|date|status|unreviewed|reviewed|layermap)))/i.test(key);
}

for (const dict of Object.values(dicts)) {
  for (const key of Object.keys(dict)) {
    if (isBasicRemovedProductKey(key)) delete dict[key];
  }
}


function hasLocalStorage(): boolean {
	try {
		return typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function';
	} catch { return false; }
}

// Migrate old storage keys
if (hasLocalStorage()) {
	for (const key of ['lang', 'lang-manual']) {
		const old = localStorage.getItem(`dedaliano-${key}`);
		if (old !== null && localStorage.getItem(`stabileo-${key}`) === null) {
			localStorage.setItem(`stabileo-${key}`, old);
			localStorage.removeItem(`dedaliano-${key}`);
		}
	}
}


export const OFFERED_LOCALES = ['ko', 'en'] as const;
export type OfferedLocale = (typeof OFFERED_LOCALES)[number];


export function isOfferedLocale(code: string): code is OfferedLocale {
	return (OFFERED_LOCALES as readonly string[]).includes(code);
}


function detectBrowserLocale(): OfferedLocale {
	if (typeof navigator === 'undefined') return 'en';
	for (const lang of navigator.languages ?? [navigator.language]) {
		if (!lang) continue;
		const code = lang.split('-')[0].toLowerCase();
		if (isOfferedLocale(code)) return code;
	}
	return 'en';
}

function getInitialLocale(): string {
	if (!hasLocalStorage()) return detectBrowserLocale();
	// Only use stored locale if user explicitly chose it (flag set by setLocale)
	if (localStorage.getItem('stabileo-lang-manual') === '1') {
		const stored = localStorage.getItem('stabileo-lang');
		// A stored locale that is no longer offered — someone who picked German before this
		// narrowed — falls through to detection rather than being honoured, which would
		// resurrect exactly the half-translated state this exists to remove. The selector would
		// also have no option to show for it, which is the invalid state to avoid.
		if (stored && isOfferedLocale(stored)) return stored;
	}
	// Otherwise auto-detect from browser and clear any stale stored value
	const detected = detectBrowserLocale();
	localStorage.setItem('stabileo-lang', detected);
	return detected;
}

let _locale = $state<string>(getInitialLocale());

export function t(key: string): string {
	return tAt(key, _locale);
}


export function tAt(key: string, locale: string): string {
	const dict = dicts[locale] ?? dicts.en;
	return (dict as any)[key] ?? (dicts.en as any)[key] ?? key;
}


export function shippedLocales(): string[] {
	return Object.keys(dicts);
}


export function dictFor(locale: string): Record<string, string> {
	return (dicts[locale] ?? {}) as Record<string, string>;
}


export function tp(key: string, params?: Record<string, string | number>): string {
	const raw = t(key);
	if (!params) return raw;
	return raw.replace(/\{(\w+)\}/g, (m, name) => {
		const v = params[name];
		return v === undefined || v === null ? m : String(v);
	});
}


export function setLocale(loc: string) {
	if (!isOfferedLocale(loc)) return;
	_locale = loc;
	if (hasLocalStorage()) {
		localStorage.setItem('stabileo-lang', loc);
		localStorage.setItem('stabileo-lang-manual', '1');
	}
}


function allTranslations(key: string): Set<string> {
	const s = new Set<string>();
	for (const dict of Object.values(dicts)) {
		const v = (dict as any)[key];
		if (v) s.add(v);
	}
	return s;
}


export function isDefaultName(name: string): boolean {
	return allTranslations('tabBar.newStructure').has(name);
}

export const i18n = {
	get locale() {
		return _locale;
	},
	set locale(v: string) {
		setLocale(v);
	},
	t,
	setLocale
};
