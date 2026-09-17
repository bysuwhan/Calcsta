import { beforeEach, describe, expect, it } from 'vitest';
import { containsLegacyEducationMode, deserializeProject } from '../file';
import { modelStore } from '../model.svelte';
import { compressSnapshot, loadFromShareLink, shareLinkContainsLegacyEducationMode } from '../../utils/url-sharing';
import type { ModelSnapshot } from '../history.svelte';

describe('removed Education data', () => {
  beforeEach(() => {
    modelStore.clear();
    modelStore.addNode(2.5, 4.5);
  });

  it('detects Education metadata in projects and nested sessions', () => {
    expect(containsLegacyEducationMode({ appMode: 'educativo' })).toBe(true);
    expect(containsLegacyEducationMode({ analysisMode: 'edu' })).toBe(true);
    expect(containsLegacyEducationMode({ snapshot: { analysisMode: 'edu' } })).toBe(true);
    expect(containsLegacyEducationMode({ snapshot: { appMode: 'educativo' } })).toBe(true);
    expect(containsLegacyEducationMode({ tabs: [{ appMode: 'educativo' }] })).toBe(true);
    expect(containsLegacyEducationMode({ tabs: [{ modelSnapshot: { analysisMode: 'edu' } }] })).toBe(true);
    expect(containsLegacyEducationMode({ tabs: [{ modelSnapshot: { appMode: 'educativo' } }] })).toBe(true);
    expect(containsLegacyEducationMode({ analysisMode: 'pro' })).toBe(false);
  });

  it('rejects a legacy project before mutating the current model', () => {
    const before = modelStore.snapshot();
    const legacy = JSON.stringify({
      version: '2.0',
      name: 'legacy education',
      timestamp: new Date(0).toISOString(),
      appMode: 'educativo',
      analysisMode: 'edu',
      snapshot: {},
    });

    expect(deserializeProject(legacy)).toBe(false);
    expect(modelStore.snapshot()).toEqual(before);
  });

  it('preflights and rejects a legacy share link without mutating the model', () => {
    const before = modelStore.snapshot();
    const legacy = { ...before, analysisMode: 'edu' } as unknown as ModelSnapshot;
    const link = `https://stabileo.test/#data=${compressSnapshot(legacy)}`;

    expect(shareLinkContainsLegacyEducationMode(link)).toBe(true);
    expect(loadFromShareLink(link)).toBe(false);
    expect(modelStore.snapshot()).toEqual(before);
  });
});
