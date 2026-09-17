import { afterEach, describe, expect, it } from 'vitest';
import { uiStore } from '../ui.svelte';

const KINDS = ['nodes', 'elements', 'supports', 'loads', 'dimensions'] as const;

function clearFilters() {
  uiStore.multiKindSelect = true;
  for (const kind of [...uiStore.selectKinds]) uiStore.toggleSelectKind(kind);
}

afterEach(clearFilters);

describe('bottom selection filter', () => {
  it('treats no pressed filters as all kinds', () => {
    clearFilters();
    expect([...uiStore.selectKinds]).toEqual([]);
    for (const kind of KINDS) expect(uiStore.selectsKind(kind)).toBe(true);
  });

  it('restricts selection to every explicitly pressed kind', () => {
    clearFilters();
    uiStore.toggleSelectKind('nodes');
    uiStore.toggleSelectKind('supports');

    expect(uiStore.selectsKind('nodes')).toBe(true);
    expect(uiStore.selectsKind('supports')).toBe(true);
    expect(uiStore.selectsKind('elements')).toBe(false);
    expect(uiStore.selectsKind('loads')).toBe(false);
    expect(uiStore.selectsKind('dimensions')).toBe(false);
  });

  it('returns to selecting all when the last filter is released', () => {
    clearFilters();
    uiStore.toggleSelectKind('elements');
    uiStore.toggleSelectKind('elements');

    expect([...uiStore.selectKinds]).toEqual([]);
    for (const kind of KINDS) expect(uiStore.selectsKind(kind)).toBe(true);
  });

  it('tracks a selected dimension in the same mutually exclusive selection state', () => {
    uiStore.selectDimension(42);
    expect(uiStore.selectedDimensionId).toBe(42);

    uiStore.selectNode(7);
    expect(uiStore.selectedDimensionId).toBeNull();
    expect(uiStore.selectedNodes).toEqual(new Set([7]));
  });
});
