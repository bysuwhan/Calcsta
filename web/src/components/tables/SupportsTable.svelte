<script lang="ts">
  import { modelStore, uiStore, historyStore, resultsStore } from '../../lib/store';
  import { t } from '../../lib/i18n';
  import type { SupportType } from '../../lib/store/model.svelte.ts';
  import { fromDisplay, toDisplay, type Quantity } from '../../lib/utils/units';

  const nodesArr = $derived([...modelStore.nodes.values()]);
  const supportsArr = $derived([...modelStore.supports.values()]);
  const us = $derived(uiStore.unitSystem);
  const supportQuantity = (field: string): Quantity | null =>
    field.startsWith('kr') ? 'springKr'
      : field.startsWith('k') ? 'springK'
      : field === 'drz' ? 'rotation'
      : field === 'dx' || field === 'dy' || field === 'dz' ? 'displacement'
      : null;
  const sv = (value: number | undefined, field: string) => {
    const q = supportQuantity(field);
    return q ? toDisplay(value ?? 0, q, us) : (value ?? 0);
  };

  let newSupportNodeId = $state(0);
  let newSupportType = $state<string>('pinned');

  function deleteSupport(id: number) {
    modelStore.removeSupport(id);
  }

  function changeSupportType(supId: number, val: string) {
    modelStore.updateSupport(supId, { type: val as SupportType });
  }

  function updateSupportSpring(supId: number, field: string, val: string) {
    const num = parseFloat(val);
    if (isNaN(num)) return;
    const q = supportQuantity(field);
    modelStore.updateSupport(supId, { [field]: q ? fromDisplay(num, q, us) : num } as any);
  }

  function addSupport() {
    if (!modelStore.getNode(newSupportNodeId)) return;
    historyStore.pushState();
    modelStore.addSupport(newSupportNodeId, newSupportType as any);
    resultsStore.clear();
  }
</script>

<table>
  <thead>
    <tr><th>ID</th><th>{t('table.nodeLabel')}</th><th>{t('table.type')}</th><th>{t('table.stiffness')}</th><th></th></tr>
  </thead>
  <tbody>
    {#each supportsArr as sup}
      <tr>
        <td class="id-cell">{sup.id}</td>
        <td>{sup.nodeId}</td>
        <td>
          <select value={sup.type} onchange={(e) => changeSupportType(sup.id, e.currentTarget.value)}>
            <option value="fixed">{t('table.fixed')}</option>
            <option value="pinned">{t('table.pinned')}</option>
            <option value="rollerX">{t('table.rollerX')}</option>
            <option value="rollerZ">{t('table.rollerY')}</option>
            <option value="spring">{t('table.spring')}</option>
          </select>
        </td>
        <td class="load-values">
          {#if sup.type === 'spring'}
            <span class="load-field">kx<input type="number" step="any" value={sv(sup.kx, 'kx')} onchange={(e) => updateSupportSpring(sup.id, 'kx', e.currentTarget.value)} /></span>
            <span class="load-field">ky<input type="number" step="any" value={sv(sup.ky, 'ky')} onchange={(e) => updateSupportSpring(sup.id, 'ky', e.currentTarget.value)} /></span>
            <span class="load-field">kz<input type="number" step="any" value={sv(sup.kz, 'kz')} onchange={(e) => updateSupportSpring(sup.id, 'kz', e.currentTarget.value)} /></span>
          {:else}
            <span class="load-field">dx<input type="number" step="0.001" value={sv(sup.dx, 'dx')} onchange={(e) => updateSupportSpring(sup.id, 'dx', e.currentTarget.value)} /></span>
            <span class="load-field">dz<input type="number" step="0.001" value={sv(sup.dy, 'dy')} onchange={(e) => updateSupportSpring(sup.id, 'dy', e.currentTarget.value)} /></span>
            <span class="load-field">d&theta;y<input type="number" step="0.001" value={sv(sup.drz, 'drz')} onchange={(e) => updateSupportSpring(sup.id, 'drz', e.currentTarget.value)} /></span>
          {/if}
        </td>
        <td><button class="del" onclick={() => deleteSupport(sup.id)}>&#10005;</button></td>
      </tr>
    {/each}
  </tbody>
</table>
<div class="table-footer">
  <div class="add-row">
    <span class="add-label">{t('table.nodeLabel')}:</span>
    <select bind:value={newSupportNodeId} class="add-input">
      {#each nodesArr as n}<option value={n.id}>{n.id}</option>{/each}
    </select>
    <select bind:value={newSupportType} class="add-input add-input-wide">
      <option value="fixed">{t('table.fixed')}</option>
      <option value="pinned">{t('table.pinned')}</option>
      <option value="rollerX">{t('table.rollerX')}</option>
      <option value="rollerZ">{t('table.rollerY')}</option>
      <option value="spring">{t('table.spring')}</option>
    </select>
    <button class="add-btn" onclick={addSupport}>{t('table.addSupport')}</button>
  </div>
</div>

<style>
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

  .dof-chk {
    display: inline-flex;
    align-items: center;
    gap: 1px;
    font-size: 0.6rem;
    color: var(--st-text-2);
    cursor: pointer;
    white-space: nowrap;
  }
  .dof-chk input {
    accent-color: var(--st-accent);
    margin: 0;
    width: 12px;
    height: 12px;
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
