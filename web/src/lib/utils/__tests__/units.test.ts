import { afterEach, describe, expect, it } from 'vitest';
import { fromDisplay, setStressUnit, toDisplay, unitLabel, type Quantity } from '../units';

afterEach(() => setStressUnit('MPa'));

describe('SI (kgf, mm) display units', () => {
  const cases: Array<[Quantity, number, string]> = [
    ['length', 1000, 'mm'],
    ['displacement', 1000, 'mm'],
    ['force', 1000 / 9.80665, 'kgf'],
    ['moment', 1_000_000 / 9.80665, 'kgf·mm'],
    ['distributedLoad', 1 / 9.80665, 'kgf/mm'],
    ['areaLoad', 0.001 / 9.80665, 'kgf/mm²'],
    ['area', 1_000_000, 'mm²'],
    ['sectionModulus', 1_000_000_000, 'mm³'],
    ['inertia', 1_000_000_000_000, 'mm⁴'],
    ['density', (1000 / 9.80665) / 1_000_000_000, 'kg/mm³'],
    ['springK', (1000 / 9.80665) / 1000, 'kgf/mm'],
    ['springKr', (1000 / 9.80665) * 1000, 'kgf·mm/rad'],
    ['compliance', 9.80665, 'mm/kgf'],
    ['rotation', 1, 'rad'],
    ['temperature', 1, '°C'],
  ];

  for (const [quantity, displayed, label] of cases) {
    it(`converts ${quantity} without changing the canonical value`, () => {
      expect(toDisplay(1, quantity, 'SI_MM')).toBeCloseTo(displayed, 10);
      expect(fromDisplay(displayed, quantity, 'SI_MM')).toBeCloseTo(1, 12);
      expect(unitLabel(quantity, 'SI_MM')).toBe(label);
    });
  }

  it('preserves 0.001 mm coordinate precision', () => {
    const canonical = fromDisplay(1000.001, 'length', 'SI_MM');
    expect(canonical).toBeCloseTo(1.000001, 12);
    expect(toDisplay(canonical, 'length', 'SI_MM')).toBeCloseTo(1000.001, 9);
  });

  it('selects stress units independently of the general unit system', () => {
    setStressUnit('kgf/cm²');
    expect(toDisplay(1, 'stress', 'SI')).toBeCloseTo(10.19716213, 8);
    expect(toDisplay(1, 'stress', 'SI_MM')).toBeCloseTo(10.19716213, 8);
    expect(toDisplay(1, 'stress', 'Imperial')).toBeCloseTo(10.19716213, 8);
    expect(fromDisplay(10.19716213, 'stress', 'SI')).toBeCloseTo(1, 8);
    expect(unitLabel('stress', 'Imperial')).toBe('kgf/cm²');

    setStressUnit('MPa');
    expect(toDisplay(1, 'stress', 'SI_MM')).toBe(1);
    expect(unitLabel('stress', 'SI_MM')).toBe('MPa');
  });
});
