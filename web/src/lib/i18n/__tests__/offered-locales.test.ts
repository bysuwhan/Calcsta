import { describe, it, expect, vi, afterEach } from 'vitest';
import { allShippedLocales } from '../locales/all';

async function boot(languages: string[], seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  const storage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
    removeItem: (k: string) => { data.delete(k); },
  };
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('navigator', { languages, language: languages[0] });
  vi.resetModules();
  return { store: await import('../store.svelte'), storage };
}
afterEach(() => vi.unstubAllGlobals());

describe('Korean and English locales', () => {
  it('offers and ships only Korean and English', async () => {
    const { store } = await boot(['en']);
    expect([...store.OFFERED_LOCALES].sort()).toEqual(['en', 'ko']);
    expect(store.shippedLocales().sort()).toEqual(['en', 'ko']);
    expect(allShippedLocales().sort()).toEqual(['en', 'ko']);
    expect(store.t('lang.en')).toBe('English');
    expect(store.t('lang.ko')).toBe('한국어');
  });
  for (const [language, expected] of [['ko-KR', 'ko'], ['en-GB', 'en'], ['es-AR', 'en'], ['pt-BR', 'en'], ['ja', 'en']]) {
    it(`detects ${language} as ${expected}`, async () => {
      expect((await boot([language])).store.i18n.locale).toBe(expected);
    });
  }
  it('uses the first supported browser preference', async () => {
    expect((await boot(['fr', 'ko-KR', 'en'])).store.i18n.locale).toBe('ko');
  });
  it('persists a manual choice and changes translated text immediately', async () => {
    const { store, storage } = await boot(['en']);
    store.setLocale('ko');
    expect(store.i18n.locale).toBe('ko');
    expect(store.t('app.language')).toBe(store.tAt('app.language', 'ko'));
    expect(storage.getItem('stabileo-lang')).toBe('ko');
    expect(storage.getItem('stabileo-lang-manual')).toBe('1');
    expect((await boot(['en'], { 'stabileo-lang': 'ko', 'stabileo-lang-manual': '1' })).store.i18n.locale).toBe('ko');
  });
  for (const code of ['es', 'pt', 'ja', 'de', 'fr', 'ar', 'zh', 'it', 'ru', 'hi', 'tr', 'id']) {
    it(`rejects ${code} and repairs its saved preference`, async () => {
      const { store, storage } = await boot(['ko'], { 'stabileo-lang': code, 'stabileo-lang-manual': '1' });
      expect(store.i18n.locale).toBe('ko');
      expect(storage.getItem('stabileo-lang')).toBe('ko');
      store.setLocale(code);
      expect(store.i18n.locale).toBe('ko');
      expect(store.tAt('app.language', code)).toBe(store.tAt('app.language', 'en'));
    });
  }
});
