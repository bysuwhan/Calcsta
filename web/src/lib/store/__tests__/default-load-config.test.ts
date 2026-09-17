import { beforeEach, describe, expect, it } from 'vitest';
import { modelStore, uiStore } from '..';
import { toDisplay } from '../../utils/units';

describe('default load configuration', () => {
  beforeEach(() => modelStore.clear());

  it('starts a new model with only case A and combination 1A', () => {
    expect(modelStore.loadCases).toEqual([{ id: 1, type: 'A', name: 'A' }]);
    expect(modelStore.combinations).toEqual([
      { id: 1, name: '1A', factors: [{ caseId: 1, factor: 1 }] },
    ]);
  });

  it('shows the default point-load value as 1000 kgf', () => {
    expect(toDisplay(uiStore.loadValue, 'force', 'SI_MM')).toBeCloseTo(1000, 10);
    expect(uiStore.loadDirection).toBe('globalZ');
  });
});
