<script lang="ts">
  import { uiStore } from '../lib/store';
  import { t } from '../lib/i18n';
  import Icon from './ribbon/Icon.svelte';

  const FILTERS = [
    { id: 'nodes', icon: 'node', key: 'float.selectNodes' },
    { id: 'elements', icon: 'element', key: 'float.selectElements' },
    { id: 'supports', icon: 'support', key: 'float.selectSupports' },
    { id: 'loads', icon: 'load', key: 'float.selectLoads' },
    { id: 'dimensions', icon: 'dimension', key: 'float.selectDimensions' },
  ] as const;
  const available = $derived(uiStore.currentTool === 'select');
</script>

<div class="selection-filter" class:unavailable={!available} data-testid="selection-filter-bar">
  <span class="sf-title">{t('selection.filterTitle')}</span>
  <span class="sf-sep" aria-hidden="true"></span>
  <div class="sf-controls" role="group" aria-label={t('selection.filterTitle')}>
    {#each FILTERS as filter}
      {@const on = uiStore.selectKinds.has(filter.id)}
      <button
        type="button"
        class:on
        disabled={!available}
        aria-pressed={on}
        title={t(filter.key)}
        data-testid={`select-mode-${filter.id}`}
        onclick={() => uiStore.toggleSelectKind(filter.id)}
      >
        <Icon name={filter.icon} size={13} />
        <span>{t(filter.key)}</span>
      </button>
    {/each}
  </div>
</div>

<style>
  .selection-filter {
    height: 25px;
    flex: none;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 0 9px;
    background: var(--st-surface-1);
    border-top: 1px solid var(--st-hair);
    border-bottom: 1px solid var(--st-hair);
    color: var(--st-text-2);
    font-family: var(--st-sans);
    font-size: 0.66rem;
    overflow-x: auto;
  }

  .sf-title {
    flex: none;
    color: var(--st-text-3);
    font-size: 0.62rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .sf-sep { width: 1px; height: 13px; background: var(--st-hair); flex: none; }
  .sf-controls { display: flex; align-items: center; gap: 2px; }

  button {
    height: 20px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0 6px;
    border: 1px solid transparent;
    border-radius: 2px;
    background: transparent;
    color: var(--st-text-3);
    font: inherit;
    cursor: pointer;
    white-space: nowrap;
  }

  button:hover:not(:disabled) { background: var(--st-surface-2); color: var(--st-text); }
  button.on {
    border-color: var(--st-accent);
    background: color-mix(in srgb, var(--st-accent) 50%, transparent);
    color: var(--st-accent);
  }
  button:disabled { cursor: default; opacity: 0.45; }
  button.on:disabled { border-color: var(--st-hair); background: var(--st-surface-2); color: var(--st-text-3); }
  .selection-filter.unavailable .sf-title { opacity: 0.55; }
  .selection-filter.unavailable .sf-sep { opacity: 0.55; }

</style>
