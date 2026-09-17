import { afterEach, describe, expect, it } from 'vitest';
import { uiStore } from '../ui.svelte';

describe('2D viewport zoom bounds', () => {
  afterEach(() => { uiStore.zoom = 1000; });

  it('starts at 1000 pixels per metre', () => {
    expect(uiStore.zoom).toBe(1000);
  });

  it('allows up to 10000 pixels per metre and clamps above it', () => {
    uiStore.zoom = 10_000;
    expect(uiStore.zoom).toBe(10_000);

    uiStore.zoom = 50_000;
    expect(uiStore.zoom).toBe(10_000);
  });
});
