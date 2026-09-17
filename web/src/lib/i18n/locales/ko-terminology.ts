import type { Translations } from '../types';

/**
 * Keep user-facing modelling terminology consistent across the Korean dictionaries.
 *
 * `지점` is also an ordinary Korean word for a location, so keys where it is
 * used in that non-structural sense must be explicitly excluded.
 */
const LOCATION_KEYS = new Set([
  'advHelp.plastic.text',
  'cad.roleGuide.column',
]);

export function applyKoreanTerminology(source: Translations): Translations {
  return Object.fromEntries(
    Object.entries(source).map(([key, value]) => [
      key,
      (LOCATION_KEYS.has(key) ? value : value.replaceAll('지점', '지지점'))
        .replaceAll('절점', '점')
        .replaceAll('요소는', '선은')
        .replaceAll('요소가', '선이')
        .replaceAll('요소와', '선과')
        .replaceAll('요소로', '선으로')
        .replaceAll('요소', '선'),
    ]),
  );
}
