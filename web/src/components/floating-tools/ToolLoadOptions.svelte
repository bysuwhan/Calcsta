<script lang="ts">
  import { uiStore, modelStore } from '../../lib/store';
  import { t } from '../../lib/i18n';
  import { fromDisplay, toDisplay, unitLabel, type Quantity } from '../../lib/utils/units';

  const us = $derived(uiStore.unitSystem);
  const dv = (value: number, quantity: Quantity) => toDisplay(value, quantity, us);
  const ul = (quantity: Quantity) => unitLabel(quantity, us);

  const loadTypes = [
    { id: 'nodal', key: 'float.loadPoint' },
    { id: 'distributed', key: 'float.loadDistributed' },
  ] as const;

  const forceDirections = [
    { id: 'globalX', label: '전역 X', title: '전역 X 방향' },
    { id: 'globalZ', label: '전역 Z', title: '전역 Z 방향' },
    { id: 'localAxial', label: '요소 축', title: '요소 축방향' },
    { id: 'localPerpendicular', label: '요소 직각', title: '요소 직각방향' },
    { id: 'angle', label: '각도 지정', title: '전역 X축 기준 각도 지정' },
  ] as const;
</script>

<label class="ft-selfweight-toggle" title={t('float.loadSelfWeightTooltip')}>
  <input type="checkbox" bind:checked={uiStore.includeSelfWeight} />
  <span>PP</span>
</label>
<span class="ft-sep">|</span>
<span class="ft-case-dot" style="background: {modelStore.getLoadCaseColor(uiStore.activeLoadCaseId)}"></span>
<select class="ft-case-select"
  value={String(uiStore.activeLoadCaseId)}
  onchange={(e) => uiStore.activeLoadCaseId = parseInt(e.currentTarget.value)}
  title={t('float.activeLoadCase')}>
  {#each modelStore.loadCases as lc}
    <option value={String(lc.id)}>{lc.type || lc.name}</option>
  {/each}
</select>
<span class="ft-sep">|</span>
{#each loadTypes as lt}
  <button
    class="ft-opt-btn"
    class:active={uiStore.loadType === lt.id}
    onclick={() => {
      uiStore.loadType = lt.id;
      if (lt.id === 'distributed' && uiStore.loadDirection === 'moment') uiStore.loadDirection = 'localPerpendicular';
    }}
  >{t(lt.key)}</button>
{/each}
<span class="ft-sep">|</span>
{#if uiStore.loadType === 'nodal'}
  {#each forceDirections as direction}
    <button class="ft-opt-btn ft-dir-btn" class:active={uiStore.loadDirection === direction.id}
      onclick={() => uiStore.loadDirection = direction.id} title={direction.title}>{direction.label}</button>
  {/each}
  <button class="ft-opt-btn ft-dir-btn" class:active={uiStore.loadDirection === 'moment'}
    onclick={() => uiStore.loadDirection = 'moment'} title={t('float.loadMomentZ')}>My</button>
  <label class="ft-input-group">
    <span>{uiStore.loadDirection === 'moment' ? 'M:' : 'F:'}</span>
    <input type="number" value={dv(uiStore.loadValue, uiStore.loadDirection === 'moment' ? 'moment' : 'force')} step="any" oninput={(e) => uiStore.loadValue = fromDisplay(parseFloat(e.currentTarget.value), uiStore.loadDirection === 'moment' ? 'moment' : 'force', us)} />
    <span class="ft-unit">{ul(uiStore.loadDirection === 'moment' ? 'moment' : 'force')}</span>
  </label>
  {#if uiStore.loadDirection === 'angle'}
    <label class="ft-input-group" title="전역 X축에서 반시계 방향">
      <span>α:</span><input type="number" bind:value={uiStore.loadAngle} step="5" /><span class="ft-unit">°</span>
    </label>
  {/if}
{:else if uiStore.loadType === 'distributed'}
  {#each forceDirections as direction}
    <button class="ft-opt-btn ft-dir-btn" class:active={uiStore.loadDirection === direction.id}
      onclick={() => uiStore.loadDirection = direction.id} title={direction.title}>{direction.label}</button>
  {/each}
  <label class="ft-input-group">
    <span>qI:</span>
    <input type="number" value={dv(uiStore.loadValue, 'distributedLoad')} step="any" oninput={(e) => uiStore.loadValue = fromDisplay(parseFloat(e.currentTarget.value), 'distributedLoad', us)} />
    <span class="ft-unit">{ul('distributedLoad')}</span>
  </label>
  <label class="ft-input-group">
    <span>qJ:</span>
    <input type="number" value={dv(uiStore.loadValueJ, 'distributedLoad')} step="any" oninput={(e) => uiStore.loadValueJ = fromDisplay(parseFloat(e.currentTarget.value), 'distributedLoad', us)} />
    <span class="ft-unit">{ul('distributedLoad')}</span>
  </label>
  {#if uiStore.loadDirection === 'angle'}
    <label class="ft-input-group" title="전역 X축에서 반시계 방향">
      <span>α:</span><input type="number" bind:value={uiStore.loadAngle} step="5" /><span class="ft-unit">°</span>
    </label>
  {/if}
{/if}

<style>
  .ft-opt-btn {
    padding: 2px 8px;
    background: var(--st-surface-2);
    border: 1px solid var(--st-hair-strong);
    border-radius: 4px;
    color: var(--st-text-2);
    cursor: pointer;
    font-size: 0.7rem;
    transition: all 0.15s;
    white-space: nowrap;
  }

  .ft-opt-btn:hover:not(:disabled) {
    background: var(--st-surface-3);
    color: var(--st-text);
  }

  .ft-opt-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    color: var(--st-text-3);
    background: var(--st-surface-2);
    border-color: var(--st-hair);
  }

  .ft-opt-btn.active {
    background: var(--st-accent);
    border-color: var(--st-danger);
    color: white;
  }

  .ft-selfweight-toggle {
    display: flex;
    align-items: center;
    gap: 3px;
    font-size: 0.68rem;
    color: var(--st-text-2);
    cursor: pointer;
    white-space: nowrap;
  }
  .ft-selfweight-toggle input {
    accent-color: var(--st-accent);
    margin: 0;
  }
  .ft-selfweight-toggle span {
    font-weight: 600;
    color: var(--st-text);
  }

  .ft-case-select {
    background: var(--st-surface-2);
    color: var(--st-text);
    border: 1px solid var(--st-hair-strong);
    border-radius: 3px;
    padding: 2px 4px;
    font-size: 0.7rem;
    cursor: pointer;
  }

  .ft-case-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .ft-sep {
    color: var(--st-text-3);
    font-size: 0.8rem;
    margin: 0 2px;
  }

  .ft-input-group {
    display: flex;
    align-items: center;
    gap: 3px;
    font-size: 0.7rem;
    color: var(--st-text-2);
  }

  .ft-input-group input {
    width: 55px;
    padding: 2px 4px;
    background: var(--st-surface-2);
    border: 1px solid var(--st-hair-strong);
    border-radius: 3px;
    color: var(--st-text);
    font-size: 0.7rem;
  }

  .ft-unit {
    font-size: 0.6rem;
    color: var(--st-text-3);
    white-space: nowrap;
  }

  .ft-dir-btn {
    min-width: 24px;
    font-size: 0.65rem;
    padding: 2px 4px;
  }

</style>
