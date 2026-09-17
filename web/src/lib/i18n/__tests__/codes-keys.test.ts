import { describe, it, expect } from 'vitest';
import en from '../locales/en';
import ko from '../locales/ko';
import koApp from '../locales/ko-app';

const PREFIXES = ['codes.', 'loads.cirsoc101.', 'loads.cirsoc102.', 'regulations.', 'revisions.', 'loadPlan.', 'materials.', 'maturity.', 'detailing.', 'footing.', 'geotechnical.'];
const keys = (dict: Record<string, string>) => Object.keys(dict).filter(k => PREFIXES.some(p => k.startsWith(p))).sort();
const korean = { ...ko, ...koApp };
describe('regulation translations', () => {
  it('has matching Korean and English keys', () => { expect(keys(korean)).toEqual(keys(en)); });
  it('preserves non-empty values and interpolation parameters', () => {
    const tokens = (v: string) => (v.match(/\{(\w+)\}/g) ?? []).sort();
    for (const key of keys(en)) {
      expect(korean[key], key).toBeTruthy();
      expect(korean[key], key).not.toBe(key);
      expect(tokens(korean[key] ?? ''), key).toEqual(tokens(en[key]));
    }
  });
});
