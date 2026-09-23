import { describe, expect, it } from 'vitest';
import { tabManager, uiStore } from '..';

describe('new project units', () => {
  it('starts a new tab in kgf/mm and restores the previous tab unit on return', () => {
    tabManager.init();
    uiStore.unitSystem = 'SI';
    const previousTabId = tabManager.activeTabId!;

    tabManager.createTab();
    expect(uiStore.unitSystem).toBe('SI_MM');
    expect(uiStore.gridSize).toBe(0.1);
    expect(tabManager.activeTab?.unitSystem).toBe('SI_MM');

    tabManager.switchTab(previousTabId);
    expect(uiStore.unitSystem).toBe('SI');
  });
});
