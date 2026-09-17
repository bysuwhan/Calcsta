<script lang="ts">
  import { uiStore, resultsStore, modelStore } from '../../lib/store';
  import { t } from '../../lib/i18n';
  import type { NodalLoad, DistributedLoad, PointLoadOnElement, CylinderLoad } from '../../lib/store/model.svelte.ts';
  import { get2DDisplayNodalLoadMoment, get2DDisplayNodalLoadVertical } from '../../lib/geometry/coordinate-system';
  import { memberLoadPerpComponent } from '../../lib/engine/model-diagnostics';
  import { fromDisplay, toDisplay, unitLabel, type Quantity } from '../../lib/utils/units';

  const us = $derived(uiStore.unitSystem);
  const quantityForLoadField = (field: string): Quantity | null => {
    if (['fx', 'fy', 'fz', 'p', 'px'].includes(field)) return 'force';
    if (['mx', 'my', 'mz'].includes(field)) return 'moment';
    if (/^q[IJ]$/.test(field)) return 'distributedLoad';
    if (field === 'a' || field === 'b') return 'length';
    return null;
  };
  const shown = (value: number, quantity: Quantity) => toDisplay(value, quantity, us);
  const ul = (quantity: Quantity) => unitLabel(quantity, us);
  const quantityForSupportField = (field: string): Quantity | null =>
    field.startsWith('kr') ? 'springKr'
      : field === 'kz' && uiStore.analysisMode === '2d' ? 'springKr'
      : field.startsWith('k') ? 'springK'
      : field.startsWith('dr') ? 'rotation'
      : ['dx', 'dy', 'dz'].includes(field) ? 'displacement' : null;
  const shownSupport = (value: number | undefined, field: string) => {
    const quantity = quantityForSupportField(field);
    return quantity ? toDisplay(value ?? 0, quantity, us) : (value ?? 0);
  };

  function updateLoadField(loadId: number, field: string, val: string | boolean) {
    if (typeof val === 'boolean') {
      modelStore.updateLoad(loadId, { [field]: val });
    } else {
      const num = parseFloat(val);
      if (isNaN(num)) return;
      const quantity = quantityForLoadField(field);
      modelStore.updateLoad(loadId, { [field]: quantity ? fromDisplay(num, quantity, us) : num });
    }
    resultsStore.clear();
    warnIfTransverseOnTruss(loadId);
  }

  /** Educational warning: transverse load on an axial-only (truss) member is not
   *  transferred as bending/shear. Non-blocking. */
  function warnIfTransverseOnTruss(loadId: number) {
    const load = modelStore.loads.find((l) => l.data.id === loadId);
    const elemId = load ? (load.data as { elementId?: number }).elementId : undefined;
    if (!load || elemId == null) return;
    const elem = modelStore.elements.get(elemId);
    if (!elem || elem.type !== 'truss') return;
    if (memberLoadPerpComponent(load as any, elem, modelStore.nodes) > 1e-9) {
      uiStore.toast(t('diag.model.transverseOnTruss'), 'info');
    }
  }

  function updateDistLoadPosition(loadId: number, field: 'a' | 'b', val: string, elemLen: number, currentA: number, currentB: number) {
    const shownValue = parseFloat(val);
    if (isNaN(shownValue)) return;
    const num = fromDisplay(shownValue, 'length', us);
    if (field === 'a') {
      const a = Math.max(0, Math.min(elemLen, num));
      const updates: Record<string, number> = { a };
      if (a > currentB) updates.b = a;
      modelStore.updateLoad(loadId, updates);
    } else {
      const b = Math.max(currentA, Math.min(elemLen, num));
      modelStore.updateLoad(loadId, { b });
    }
    resultsStore.clear();
  }

  function deleteSelectedLoads() {
    const ids = [...uiStore.selectedLoads];
    modelStore.batch(() => { for (const id of ids) modelStore.removeLoad(id); });
    uiStore.clearSelectedLoads();
    resultsStore.clear();
  }

  function deleteSelectedSupports() {
    const ids = [...uiStore.selectedSupports];
    modelStore.batch(() => { for (const id of ids) modelStore.removeSupport(id); });
    uiStore.clearSelectedSupports();
    resultsStore.clear();
  }

  function changeSupportType(supId: number, newType: string) {
    modelStore.updateSupport(supId, { type: newType as any });
    resultsStore.clear();
  }

  function updateSupportField(supId: number, field: string, val: string | boolean) {
    if (typeof val === 'boolean') {
      modelStore.updateSupport(supId, { [field]: val } as any);
    } else {
      const num = parseFloat(val);
      if (isNaN(num)) return;
      const quantity = quantityForSupportField(field);
      modelStore.updateSupport(supId, { [field]: quantity ? fromDisplay(num, quantity, us) : num } as any);
    }
    resultsStore.clear();
  }

  const supTypeLabelKeys: Record<string, string> = {
    fixed: 'selEntity.supFixed',
    pinned: 'selEntity.supPinned',
    rollerX: 'selEntity.supRoller',
    rollerZ: 'selEntity.supRoller',
    rollerY: 'selEntity.supRoller',
    spring: 'selEntity.supSpring',
  };

  function isRollerType(type: string): boolean {
    return type === 'rollerX' || type === 'rollerY' || type === 'rollerZ' || type === 'rollerXZ' || type === 'rollerXY' || type === 'rollerYZ';
  }

  const supportTypes = [
    { id: 'fixed', key: 'float.supportFixedShort', icon: '▣', svg: false },
    { id: 'pinned', key: 'float.supportPinnedShort', icon: '△', svg: false },
    { id: 'roller', key: 'float.supportRoller', icon: '', svg: true },
    { id: 'spring', key: 'float.supportSpring', icon: '⌇', svg: false },
  ] as const;

  // Get the single selected load (for inline edit)
  const selectedLoad = $derived.by(() => {
    if (uiStore.selectedLoads.size !== 1) return null;
    const id = [...uiStore.selectedLoads][0];
    return modelStore.loads.find(l => l.data.id === id) ?? null;
  });

  // Get the single selected support (for inline edit)
  const selectedSup = $derived.by(() => {
    if (uiStore.selectedSupports.size !== 1) return null;
    const id = [...uiStore.selectedSupports][0];
    return modelStore.supports.get(id) ?? null;
  });
</script>

{#if selectedLoad}
  <div class="ft-load-edit">
    <span class="ft-load-tag">{t('selEntity.editingLoad')}</span>
    <span class="ft-case-dot" style="background: {modelStore.getLoadCaseColor((selectedLoad.data as any).caseId ?? 1)}"></span>
    <select class="ft-case-select"
      value={String((selectedLoad.data as any).caseId ?? 1)}
      onchange={(e) => { updateLoadField(selectedLoad.data.id, 'caseId', e.currentTarget.value); }}
      title={t('selEntity.loadCase')}>
      {#each modelStore.loadCases as lc}
        <option value={String(lc.id)}>{lc.type || lc.name}</option>
      {/each}
    </select>
    <span class="ft-sep">|</span>
    {#if selectedLoad.type === 'nodal'}
      {@const nl = selectedLoad.data as NodalLoad}
      <label class="ft-input-group">
        <span>Fx:</span>
        <input type="number" step="any" value={shown(nl.fx, 'force')} onchange={(e) => updateLoadField(nl.id, 'fx', e.currentTarget.value)} />
        <span class="ft-unit">{ul('force')}</span>
      </label>
      <label class="ft-input-group">
        <span>Fz:</span>
        <input type="number" step="any" value={shown(get2DDisplayNodalLoadVertical(nl), 'force')} onchange={(e) => updateLoadField(nl.id, 'fz', e.currentTarget.value)} />
        <span class="ft-unit">{ul('force')}</span>
      </label>
      <label class="ft-input-group">
        <span>My:</span>
        <input type="number" step="any" value={shown(get2DDisplayNodalLoadMoment(nl), 'moment')} onchange={(e) => updateLoadField(nl.id, 'my', e.currentTarget.value)} />
        <span class="ft-unit">{ul('moment')}</span>
      </label>
    {:else if selectedLoad.type === 'cylinder'}
      {@const cylinder = selectedLoad.data as CylinderLoad}
      <span class="ft-load-tag">실린더 {cylinder.nodeI}–{cylinder.nodeJ}</span>
      <label class="ft-input-group">
        <span>F:</span>
        <input type="number" step="any" value={shown(cylinder.force, 'force')} onchange={(e) => updateLoadField(cylinder.id, 'force', e.currentTarget.value)} />
        <span class="ft-unit">{ul('force')}</span>
      </label>
      <span class="ft-load-tag">+ 밀어냄 · − 당김</span>
    {:else if selectedLoad.type === 'distributed'}
      {@const dl = selectedLoad.data as DistributedLoad}
      {@const elemLen = modelStore.getElementLength(dl.elementId)}
      <label class="ft-input-group">
        <span>qI:</span>
        <input type="number" step="any" value={shown(dl.qI, 'distributedLoad')} onchange={(e) => updateLoadField(dl.id, 'qI', e.currentTarget.value)} />
        <span class="ft-unit">{ul('distributedLoad')}</span>
      </label>
      <label class="ft-input-group">
        <span>qJ:</span>
        <input type="number" step="any" value={shown(dl.qJ, 'distributedLoad')} onchange={(e) => updateLoadField(dl.id, 'qJ', e.currentTarget.value)} />
        <span class="ft-unit">{ul('distributedLoad')}</span>
      </label>
      <label class="ft-input-group">
        <span>a:</span>
        <input type="number" step="0.001" min="0" max={shown(elemLen, 'length')} value={shown(dl.a ?? 0, 'length')} onchange={(e) => updateDistLoadPosition(dl.id, 'a', e.currentTarget.value, elemLen, dl.a ?? 0, dl.b ?? elemLen)} />
        <span class="ft-unit">{ul('length')}</span>
      </label>
      <label class="ft-input-group">
        <span>b:</span>
        <input type="number" step="0.001" min="0" max={shown(elemLen, 'length')} value={shown(dl.b ?? elemLen, 'length')} onchange={(e) => updateDistLoadPosition(dl.id, 'b', e.currentTarget.value, elemLen, dl.a ?? 0, dl.b ?? elemLen)} />
        <span class="ft-unit">{ul('length')}</span>
      </label>
      <span class="ft-sep">|</span>
      <button class="ft-opt-btn ft-coord-btn" class:active={dl.isGlobal === true} onclick={() => updateLoadField(dl.id, 'isGlobal', true)} title={t('float.loadGlobalYDir')}>Z</button>
      <button class="ft-opt-btn ft-coord-btn" class:active={!dl.isGlobal} onclick={() => updateLoadField(dl.id, 'isGlobal', false)} title={t('float.loadPerpDir')}>⊥</button>
      <label class="ft-input-group">
        <span>α:</span>
        <input type="number" step="5" value={dl.angle ?? 0} onchange={(e) => updateLoadField(dl.id, 'angle', e.currentTarget.value)} />
        <span class="ft-unit">°</span>
      </label>
    {:else if selectedLoad.type === 'pointOnElement'}
      {@const pl = selectedLoad.data as PointLoadOnElement}
      {@const elemLen = modelStore.getElementLength(pl.elementId)}
      <label class="ft-input-group">
        <span>a:</span>
        <input type="number" step="0.001" min="0" max={shown(elemLen, 'length')} value={shown(pl.a, 'length')} onchange={(e) => updateLoadField(pl.id, 'a', e.currentTarget.value)} />
        <span class="ft-unit">{ul('length')}</span>
      </label>
      <label class="ft-input-group">
        <span>{pl.isGlobal ? 'Fz' : 'Fj'}:</span>
        <input type="number" step="any" value={shown(pl.p, 'force')} onchange={(e) => updateLoadField(pl.id, 'p', e.currentTarget.value)} />
        <span class="ft-unit">{ul('force')}</span>
      </label>
      <label class="ft-input-group">
        <span>{pl.isGlobal ? 'Fx' : 'Fi'}:</span>
        <input type="number" step="any" value={shown(pl.px ?? 0, 'force')} onchange={(e) => updateLoadField(pl.id, 'px', e.currentTarget.value)} />
        <span class="ft-unit">{ul('force')}</span>
      </label>
      <label class="ft-input-group">
        <span>My:</span>
        <input type="number" step="any" value={shown(get2DDisplayNodalLoadMoment(pl), 'moment')} onchange={(e) => updateLoadField(pl.id, 'my', e.currentTarget.value)} />
        <span class="ft-unit">{ul('moment')}</span>
      </label>
      <span class="ft-sep">|</span>
      <button class="ft-opt-btn ft-coord-btn" class:active={pl.isGlobal === true} onclick={() => updateLoadField(pl.id, 'isGlobal', true)} title={t('float.loadGlobalYDir')}>Z</button>
      <button class="ft-opt-btn ft-coord-btn" class:active={!pl.isGlobal} onclick={() => updateLoadField(pl.id, 'isGlobal', false)} title={t('float.loadPerpDir')}>⊥</button>
      <label class="ft-input-group">
        <span>α:</span>
        <input type="number" step="5" value={pl.angle ?? 0} onchange={(e) => updateLoadField(pl.id, 'angle', e.currentTarget.value)} />
        <span class="ft-unit">°</span>
      </label>
    {/if}
    <button class="ft-load-delete" onclick={deleteSelectedLoads} title={t('selEntity.deleteLoad')}>🗑</button>
    <button class="ft-load-done" onclick={() => { uiStore.clearSelectedLoads(); uiStore.currentTool = 'load'; }} title={t('selEntity.deselectBack')}>✓</button>
  </div>
{:else if uiStore.selectedLoads.size > 1}
  <div class="ft-load-edit">
    <span class="ft-load-tag">{t('selEntity.loadsSelected').replace('{n}', String(uiStore.selectedLoads.size))}</span>
    <button class="ft-load-delete" onclick={deleteSelectedLoads} title={t('selEntity.deleteSelectedLoads')}>🗑 {t('selEntity.deleteBtn')}</button>
    <button class="ft-load-done" onclick={() => uiStore.clearSelectedLoads()} title={t('selEntity.deselect')}>✓</button>
  </div>
{/if}

{#if selectedSup}
  <div class="ft-load-edit">
    <span class="ft-load-tag">{t('selEntity.support')} {t(supTypeLabelKeys[selectedSup.type] ?? '') || selectedSup.type}</span>
    <span class="ft-sep">|</span>
    <!-- 2D support type buttons -->
    {#each supportTypes as st}
      <button
        class="ft-opt-btn ft-sup-btn"
        class:active={st.id === 'roller' ? isRollerType(selectedSup.type) : selectedSup.type === st.id}
        onclick={() => changeSupportType(selectedSup.id, st.id === 'roller' ? 'rollerX' : st.id)}
        title={t(st.key)}
      >
        {#if st.id === 'roller'}
          <svg class="ft-sup-svg" viewBox="0 0 20 20" width="14" height="14">
            <polygon points="10,2 3,12 17,12" fill="none" stroke="currentColor" stroke-width="1.8"/>
            <circle cx="7" cy="16" r="2.5" fill="none" stroke="currentColor" stroke-width="1.5"/>
            <circle cx="13" cy="16" r="2.5" fill="none" stroke="currentColor" stroke-width="1.5"/>
          </svg>
        {:else}
          {st.icon}
        {/if}
      </button>
    {/each}
    {#if isRollerType(selectedSup.type)}
      <span class="ft-sep">|</span>
      <button class="ft-opt-btn ft-dir-btn" class:active={selectedSup.type === 'rollerX'}
        onclick={() => changeSupportType(selectedSup.id, 'rollerX')}
        title={selectedSup.isGlobal !== false ? t('float.rollerRestrictsYGlobal') : t('float.rollerRestrictsJLocal')}
      >{selectedSup.isGlobal !== false ? 'X' : 'i'}</button>
      <button class="ft-opt-btn ft-dir-btn" class:active={selectedSup.type === 'rollerY' || selectedSup.type === 'rollerZ'}
        onclick={() => changeSupportType(selectedSup.id, 'rollerZ')}
        title={selectedSup.isGlobal !== false ? t('float.rollerRestrictsXGlobal') : t('float.rollerRestrictsILocal')}
      >{selectedSup.isGlobal !== false ? 'Z' : 'j'}</button>
      <span class="ft-sep">|</span>
      <button class="ft-opt-btn ft-coord-btn" class:active={selectedSup.isGlobal !== false} onclick={() => updateSupportField(selectedSup.id, 'isGlobal', true)}
        title={t('float.rollerGlobalLabel')}>Gl</button>
      <button class="ft-opt-btn ft-coord-btn" class:active={selectedSup.isGlobal === false} onclick={() => updateSupportField(selectedSup.id, 'isGlobal', false)}
        title={t('float.rollerLocalLabel')}>Loc</button>
      <label class="ft-input-group" title={t('float.prescribedRollerDisp')}>
        <span>di:</span>
        <input type="number" step="0.001" value={shownSupport(selectedSup.dx, 'dx')} onchange={(e) => updateSupportField(selectedSup.id, 'dx', e.currentTarget.value)} />
        <span class="ft-unit">{ul('displacement')}</span>
      </label>
      <label class="ft-input-group" title={t('float.supportAngle')}>
        <span>α:</span>
        <input type="number" step="5" value={selectedSup.angle ?? 0} onchange={(e) => updateSupportField(selectedSup.id, 'angle', e.currentTarget.value)} />
        <span class="ft-unit">°</span>
      </label>
    {:else if selectedSup.type === 'spring'}
      <span class="ft-sep">|</span>
      <label class="ft-input-group">
        <span>kx:</span>
        <input type="number" step="any" value={shownSupport(selectedSup.kx, 'kx')} onchange={(e) => updateSupportField(selectedSup.id, 'kx', e.currentTarget.value)} /><span class="ft-unit">{ul('springK')}</span>
      </label>
      <label class="ft-input-group">
        <span>ky:</span>
        <input type="number" step="any" value={shownSupport(selectedSup.ky, 'ky')} onchange={(e) => updateSupportField(selectedSup.id, 'ky', e.currentTarget.value)} /><span class="ft-unit">{ul('springK')}</span>
      </label>
      <label class="ft-input-group">
        <span>kθ:</span>
        <input type="number" step="any" value={shownSupport(selectedSup.kz, 'kz')} onchange={(e) => updateSupportField(selectedSup.id, 'kz', e.currentTarget.value)} /><span class="ft-unit">{ul('springKr')}</span>
      </label>
      <span class="ft-sep">|</span>
      <button class="ft-opt-btn ft-coord-btn" class:active={selectedSup.isGlobal !== false} onclick={() => updateSupportField(selectedSup.id, 'isGlobal', true)}
        title={t('float.supportGlobalAxes')}>Gl</button>
      <button class="ft-opt-btn ft-coord-btn" class:active={selectedSup.isGlobal === false} onclick={() => updateSupportField(selectedSup.id, 'isGlobal', false)}
        title={t('float.supportLocalAxes')}>Loc</button>
      <label class="ft-input-group" title={t('float.supportAngle')}>
        <span>α:</span>
        <input type="number" step="5" value={selectedSup.angle ?? 0} onchange={(e) => updateSupportField(selectedSup.id, 'angle', e.currentTarget.value)} />
        <span class="ft-unit">°</span>
      </label>
    {:else if selectedSup.type === 'fixed' || selectedSup.type === 'pinned'}
      <span class="ft-sep">|</span>
      {#if selectedSup.type === 'fixed' || selectedSup.type === 'pinned'}
        <label class="ft-input-group" title={t('float.prescribedDx')}>
          <span>dx:</span>
          <input type="number" step="0.001" value={shownSupport(selectedSup.dx, 'dx')} onchange={(e) => updateSupportField(selectedSup.id, 'dx', e.currentTarget.value)} /><span class="ft-unit">{ul('displacement')}</span>
        </label>
        <label class="ft-input-group" title={t('float.prescribedDy')}>
          <span>dy:</span>
          <input type="number" step="0.001" value={shownSupport(selectedSup.dy, 'dy')} onchange={(e) => updateSupportField(selectedSup.id, 'dy', e.currentTarget.value)} /><span class="ft-unit">{ul('displacement')}</span>
        </label>
      {/if}
      {#if selectedSup.type === 'fixed'}
        <label class="ft-input-group" title={t('float.prescribedDrz')}>
          <span>dθz:</span>
          <input type="number" step="0.001" value={shownSupport(selectedSup.drz, 'drz')} onchange={(e) => updateSupportField(selectedSup.id, 'drz', e.currentTarget.value)} /><span class="ft-unit">{ul('rotation')}</span>
        </label>
      {/if}
      <label class="ft-input-group" title={t('float.supportAngleVisual')}>
        <span>α:</span>
        <input type="number" step="5" value={selectedSup.angle ?? 0} onchange={(e) => updateSupportField(selectedSup.id, 'angle', e.currentTarget.value)} />
        <span class="ft-unit">°</span>
      </label>
    {/if}
    <button class="ft-load-delete" onclick={deleteSelectedSupports} title={t('selEntity.deleteSupport')}>🗑</button>
    <button class="ft-load-done" onclick={() => uiStore.clearSelectedSupports()} title={t('selEntity.deselect')}>✓</button>
  </div>
{:else if uiStore.selectedSupports.size > 1}
  <div class="ft-load-edit">
    <span class="ft-load-tag">{t('selEntity.supportsSelected').replace('{n}', String(uiStore.selectedSupports.size))}</span>
    <button class="ft-load-delete" onclick={deleteSelectedSupports} title={t('selEntity.deleteSelectedSupports')}>🗑 {t('selEntity.deleteBtn')}</button>
    <button class="ft-load-done" onclick={() => uiStore.clearSelectedSupports()} title={t('selEntity.deselect')}>✓</button>
  </div>
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

  .ft-sup-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 3px;
    min-height: 22px;
    min-width: 22px;
    line-height: 1;
  }

  .ft-sup-svg {
    vertical-align: middle;
    flex-shrink: 0;
  }

  .ft-chk {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    font-size: 0.68rem;
    color: var(--st-text-2);
    cursor: pointer;
    white-space: nowrap;
  }
  .ft-chk input {
    accent-color: var(--st-accent);
    margin: 0;
    width: 13px;
    height: 13px;
  }
  .ft-chk span {
    font-size: 0.65rem;
  }

  .ft-sep {
    color: var(--st-text-3);
    font-size: 0.8rem;
    margin: 0 2px;
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

  .ft-coord-btn {
    min-width: 22px;
    font-size: 0.6rem;
    padding: 2px 5px;
    font-weight: 600;
    letter-spacing: 0.02em;
  }

  /* Inline load/support editor */
  .ft-load-edit {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 4px 8px;
    border-top: 1px solid var(--st-hair-strong);
    background: var(--st-surface-2);
  }

  .ft-load-tag {
    font-size: 0.65rem;
    color: var(--st-value);
    font-weight: 600;
    white-space: nowrap;
  }

  .ft-load-delete {
    padding: 2px 6px;
    background: var(--st-accent);
    border: 1px solid var(--st-danger);
    border-radius: 3px;
    color: white;
    cursor: pointer;
    font-size: 0.65rem;
    white-space: nowrap;
  }

  .ft-load-delete:hover {
    background: var(--st-danger);
  }

  .ft-load-done {
    padding: 2px 6px;
    background: var(--st-surface-2);
    border: 1px solid var(--st-interactive);
    border-radius: 3px;
    color: var(--st-value);
    cursor: pointer;
    font-size: 0.7rem;
  }

  .ft-load-done:hover {
    background: var(--st-accent);
    color: var(--st-text-on-accent);
  }

  
</style>
