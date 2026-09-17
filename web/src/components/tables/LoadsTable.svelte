<script lang="ts">
  import { modelStore, uiStore, historyStore, resultsStore } from '../../lib/store';
  import CombosTable from './CombosTable.svelte';
  import { t } from '../../lib/i18n';
  import type { DistributedLoad, PointLoadOnElement, NodalLoad, CylinderLoad } from '../../lib/store/model.svelte.ts';
  import { get2DDisplayNodalLoadMoment, get2DDisplayNodalLoadVertical } from '../../lib/geometry/coordinate-system';
  import { fromDisplay, toDisplay, unitLabel, type Quantity } from '../../lib/utils/units';

  const us = $derived(uiStore.unitSystem);
  const dv = (value: number, quantity: Quantity) => toDisplay(value, quantity, us);
  const ul = (quantity: Quantity) => unitLabel(quantity, us);

  const nodesArr = $derived([...modelStore.nodes.values()]);
  const elementsArr = $derived([...modelStore.elements.values()]);

  let newLoadType = $state<'nodal' | 'distributed' | 'pointOnElement'>('nodal');
  let newLoadTargetId = $state(0);
  let newLoadCaseId = $state(1);

  function deleteLoad(index: number) {
    historyStore.pushState();
    modelStore.loads.splice(index, 1);
  }

  function updateLoadField(loadId: number, field: string, val: string, quantity?: Quantity) {
    const shown = parseFloat(val);
    const num = quantity ? fromDisplay(shown, quantity, us) : shown;
    if (isNaN(num)) return;
    modelStore.updateLoad(loadId, { [field]: num });
  }

  function addLoad() {
    historyStore.pushState();
    if (newLoadType === 'nodal') {
      if (!modelStore.getNode(newLoadTargetId)) return;
      modelStore.addNodalLoad(newLoadTargetId, 0, uiStore.loadValue, 0, newLoadCaseId);
    } else if (newLoadType === 'distributed') {
      if (!modelStore.elements.get(newLoadTargetId)) return;
      modelStore.addDistributedLoad(newLoadTargetId, uiStore.loadValue, uiStore.loadValueJ, undefined, undefined, newLoadCaseId);
    } else if (newLoadType === 'pointOnElement') {
      if (!modelStore.elements.get(newLoadTargetId)) return;
      modelStore.addPointLoadOnElement(newLoadTargetId, 0, uiStore.loadValue, { caseId: newLoadCaseId });
    }
    resultsStore.clear();
  }
</script>

<label class="selfweight-row" title={t('table.selfWeightTooltip')}>
  <input type="checkbox" bind:checked={uiStore.includeSelfWeight} />
  <span>{t('table.selfWeight')}</span>
</label>

<!--
  Combinations live here, folded, above the loads they combine.
  
  They were a tab of their own beside Nodes and Sections, which put them among
  the things a model is MADE of. A combination is not a thing in the model — it
  is an arrangement of the loads, and it means nothing without them. Reading it
  next to the loads is reading it in the only place it makes sense.
-->
<details class="combos-fold">
  <summary>{t('data.combinations')}</summary>
  <div class="combos-body">
    <CombosTable />
  </div>
</details>

<table>
  <thead>
    <tr><th>#</th><th>{t('table.case')}</th><th>{t('table.type')}</th><th>{t('table.target')}</th><th>{t('table.values')}</th><th></th></tr>
  </thead>
  <tbody>
    {#each modelStore.loads as load, i}
      <tr>
        <td class="id-cell">{i + 1}</td>
        <td>
          <select value={String(load.data.caseId ?? 1)} onchange={(e) => { modelStore.updateLoadCaseId(load.data.id, parseInt(e.currentTarget.value)); if (resultsStore.hasCombinations) resultsStore.combinationsDirty = true; }}>
            {#each modelStore.loadCases as lc}
              <option value={String(lc.id)}>{lc.type || lc.name}</option>
            {/each}
          </select>
        </td>
        <td class="type-cell">{load.type === 'nodal' ? t('table.typePoint') : load.type === 'distributed' ? t('table.typeDist') : load.type === 'cylinder' ? '실린더' : t('table.typeBarPoint')}</td>
        <td>
          {#if load.type === 'nodal'}
            {t('table.nodeLabel')} {(load.data as NodalLoad).nodeId}
          {:else if load.type === 'cylinder'}
            {@const d = load.data as CylinderLoad}
            {t('table.nodeLabel')} {d.nodeI}–{d.nodeJ}
          {:else if load.type === 'distributed'}
            {t('table.elemLabel')} {(load.data as DistributedLoad).elementId}
          {:else}
            {t('table.elemLabel')} {(load.data as PointLoadOnElement).elementId}
          {/if}
        </td>
        <td class="load-values">
          {#if load.type === 'nodal'}
            {@const d = load.data as NodalLoad}
            <span class="load-field">Fx<input type="number" step="any" value={dv(d.fx, 'force')} onchange={(e) => updateLoadField(d.id, 'fx', e.currentTarget.value, 'force')} />{ul('force')}</span>
            <span class="load-field">Fz<input type="number" step="any" value={dv(get2DDisplayNodalLoadVertical(d), 'force')} onchange={(e) => updateLoadField(d.id, 'fz', e.currentTarget.value, 'force')} />{ul('force')}</span>
            <span class="load-field">My<input type="number" step="any" value={dv(get2DDisplayNodalLoadMoment(d), 'moment')} onchange={(e) => updateLoadField(d.id, 'my', e.currentTarget.value, 'moment')} />{ul('moment')}</span>
          {:else if load.type === 'cylinder'}
            {@const d = load.data as CylinderLoad}
            <span class="load-field">F<input type="number" step="any" value={dv(d.force, 'force')} onchange={(e) => updateLoadField(d.id, 'force', e.currentTarget.value, 'force')} />{ul('force')}</span>
            <span class="load-field">+ 밀어냄 · − 당김</span>
          {:else if load.type === 'distributed'}
            {@const d = load.data as DistributedLoad}
            <span class="load-field">qI<input type="number" step="any" value={dv(d.qI, 'distributedLoad')} onchange={(e) => updateLoadField(d.id, 'qI', e.currentTarget.value, 'distributedLoad')} />{ul('distributedLoad')}</span>
            <span class="load-field">qJ<input type="number" step="any" value={dv(d.qJ, 'distributedLoad')} onchange={(e) => updateLoadField(d.id, 'qJ', e.currentTarget.value, 'distributedLoad')} />{ul('distributedLoad')}</span>
            <span class="load-field">a<input type="number" step={us === 'SI_MM' ? 0.001 : 0.001} value={dv(d.a ?? 0, 'length')} onchange={(e) => updateLoadField(d.id, 'a', e.currentTarget.value, 'length')} />{ul('length')}</span>
            <span class="load-field">b<input type="number" step={us === 'SI_MM' ? 0.001 : 0.001} value={dv(d.b ?? modelStore.getElementLength(d.elementId), 'length')} onchange={(e) => updateLoadField(d.id, 'b', e.currentTarget.value, 'length')} />{ul('length')}</span>
          {:else}
            {@const d = load.data as PointLoadOnElement}
            <span class="load-field">P<input type="number" step="any" value={dv(d.p, 'force')} onchange={(e) => updateLoadField(d.id, 'p', e.currentTarget.value, 'force')} />{ul('force')}</span>
            <span class="load-field">a<input type="number" step={us === 'SI_MM' ? 0.001 : 0.001} value={dv(d.a, 'length')} onchange={(e) => updateLoadField(d.id, 'a', e.currentTarget.value, 'length')} />{ul('length')}</span>
          {/if}
        </td>
        <td><button class="del" onclick={() => deleteLoad(i)}>&#10005;</button></td>
      </tr>
    {/each}
  </tbody>
</table>
<div class="table-footer">
  <div class="add-row">
    <select bind:value={newLoadType} class="add-input add-input-wide">
      <option value="nodal">{t('table.pointLoad')}</option>
      <option value="distributed">{t('table.distLoad')}</option>
      <option value="pointOnElement">{t('table.pointBarLoad')}</option>
    </select>
    <span class="add-label">{t('table.loadCase')}:</span>
    <select bind:value={newLoadCaseId} class="add-input">
      {#each modelStore.loadCases as lc}<option value={lc.id}>{lc.type || lc.name}</option>{/each}
    </select>
    <span class="add-label">{newLoadType === 'nodal' ? t('table.nodeLabel') : t('table.elemLabel')}:</span>
    <select bind:value={newLoadTargetId} class="add-input">
      {#if newLoadType === 'nodal'}
        {#each nodesArr as n}<option value={n.id}>{n.id}</option>{/each}
      {:else}
        {#each elementsArr as e}<option value={e.id}>{e.id}</option>{/each}
      {/if}
    </select>
    <button class="add-btn" onclick={addLoad}>{t('table.addLoad')}</button>
  </div>
</div>

<style>
  .combos-fold {
    margin: 0 0 6px;
    border: 1px solid var(--st-border);
    border-radius: var(--st-radius, 3px);
    background: var(--st-surface-2);
  }
  .combos-fold > summary {
    padding: 5px 9px;
    cursor: pointer;
    font-size: 0.74rem;
    color: var(--st-text-2);
    user-select: none;
  }
  .combos-fold > summary:hover { color: var(--st-text); }
  .combos-body { padding: 0 6px 6px; }

  table {
    width: max-content;
    min-width: 100%;
    border-collapse: collapse;
  }

  th {
    text-align: left;
    padding: 0.25rem 0.35rem;
    color: var(--st-text-3);
    font-weight: 500;
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    border-bottom: 1px solid var(--st-surface-3);
    position: sticky;
    top: 0;
    background: var(--st-surface-2);
    white-space: nowrap;
  }

  td {
    padding: 0.2rem 0.35rem;
    border-bottom: 1px solid var(--st-bg);
    color: var(--st-text-2);
    white-space: nowrap;
  }

  .id-cell {
    color: var(--st-value);
    font-weight: 600;
  }

  .type-cell {
    font-size: 0.7rem;
  }

  td input[type="number"] {
    width: 55px;
    padding: 0.1rem 0.2rem;
    background: var(--st-surface-3);
    border: 1px solid var(--st-surface-3);
    border-radius: 3px;
    color: var(--st-text);
    font-size: 0.7rem;
  }

  td select {
    padding: 0.1rem 0.2rem;
    background: var(--st-surface-3);
    border: 1px solid var(--st-surface-3);
    border-radius: 3px;
    color: var(--st-text);
    font-size: 0.7rem;
    cursor: pointer;
    max-width: 90px;
  }

  .load-values {
    display: flex;
    gap: 0.25rem;
    flex-wrap: wrap;
  }

  .load-field {
    display: flex;
    align-items: center;
    gap: 0.15rem;
    font-size: 0.65rem;
    color: var(--st-text-3);
  }

  .load-field input {
    width: 50px;
  }

  .selfweight-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.3rem 0.4rem;
    font-size: 0.75rem;
    color: var(--st-text-2);
    cursor: pointer;
    background: rgba(19, 33, 45, 0.5);
    border: 1px solid var(--st-surface-3);
    border-radius: 4px;
    margin-bottom: 0.3rem;
  }
  .selfweight-row input {
    accent-color: var(--st-accent);
    margin: 0;
  }
  .selfweight-row span {
    font-weight: 500;
  }

  .del {
    background: none;
    border: none;
    color: var(--st-text-3);
    cursor: pointer;
    font-size: 0.8rem;
    padding: 0.1rem 0.3rem;
  }
  .del:hover {
    color: var(--st-accent);
  }

  tr:hover {
    background: rgba(127, 212, 204, 0.5);
  }

  .table-footer {
    padding: 0.5rem;
    border-top: 1px solid var(--st-bg);
  }

  .add-row {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    flex-wrap: wrap;
  }

  .add-row .add-btn {
    width: auto;
    flex-shrink: 0;
  }

  .add-label {
    font-size: 0.7rem;
    color: var(--st-text-3);
    flex-shrink: 0;
  }

  .add-input {
    background: var(--st-surface-2);
    color: var(--st-text-2);
    border: 1px solid var(--st-surface-3);
    border-radius: 3px;
    padding: 0.2rem 0.3rem;
    font-size: 0.75rem;
    width: 60px;
  }

  .add-input-wide {
    width: auto;
    min-width: 80px;
  }

  .add-btn {
    width: 100%;
    padding: 0.4rem 0.5rem;
    background: var(--st-surface-3);
    border: 1px solid var(--st-surface-3);
    border-radius: 4px;
    color: var(--st-value);
    cursor: pointer;
    font-size: 0.8rem;
    transition: all 0.2s;
  }

  .add-btn:hover {
    background: var(--st-surface-3);
    color: white;
  }
</style>
