<script lang="ts">
  import { modelStore, uiStore } from '../../lib/store';
  import { t } from '../../lib/i18n';
  import type { SupportType } from '../../lib/store/model.svelte.ts';
  import { fromDisplay, toDisplay, unitLabel, type Quantity } from '../../lib/utils/units';

  let { supId, sup }: { supId: number; sup: any } = $props();
  const us = $derived(uiStore.unitSystem);
  const quantityFor = (field: string): Quantity | null =>
    field.startsWith('kr') ? 'springKr'
      : field.startsWith('k') ? 'springK'
      : field.startsWith('dr') ? 'rotation'
      : ['dx', 'dy', 'dz'].includes(field) ? 'displacement' : null;
  const shown = (value: number | undefined, field: string) => {
    const q = quantityFor(field);
    return q ? toDisplay(value ?? 0, q, us) : (value ?? 0);
  };

  function changeSupportType(id: number, val: string) {
    modelStore.updateSupport(id, { type: val as SupportType });
  }

  function updateSpringField(id: number, field: string, val: string) {
    if (field === 'isGlobal') {
      modelStore.updateSupport(id, { isGlobal: val === '1' || val === 'true' } as any);
      return;
    }
    const num = parseFloat(val);
    if (isNaN(num)) return;
    const q = quantityFor(field);
    modelStore.updateSupport(id, { [field]: q ? fromDisplay(num, q, us) : num } as any);
  }

  function removeSupport(id: number) {
    modelStore.removeSupport(id);
  }

</script>

<h4>{t('prop.support')}</h4>
<!-- Basic supports expose only the planar restraint types. -->
  <div class="property-row">
    <span>{t('prop.type')}:</span>
    <select value={sup.type === 'rollerX' || sup.type === 'rollerY' || sup.type === 'rollerZ' ? 'roller' : sup.type}
      onchange={(e) => {
        const val = e.currentTarget.value;
        if (val === 'roller') {
          changeSupportType(supId, 'rollerX');
        } else {
          changeSupportType(supId, val);
        }
      }}>
      <option value="fixed">{t('table.fixed')}</option>
      <option value="pinned">{t('table.pinned')}</option>
      <option value="roller">{t('prop.roller')}</option>
      <option value="spring">{t('table.spring')}</option>
    </select>
  </div>
  {#if sup.type === 'rollerX' || sup.type === 'rollerY' || sup.type === 'rollerZ'}
    <div class="property-row">
      <span>{t('prop.direction')}:</span>
      <button class="btn-small" class:active={sup.type === 'rollerX'} onclick={() => changeSupportType(supId, 'rollerX')}
      >{sup.isGlobal !== false ? 'X' : 'i'}</button>
      <button class="btn-small" class:active={sup.type === 'rollerY' || sup.type === 'rollerZ'} onclick={() => changeSupportType(supId, 'rollerZ')}
      >{sup.isGlobal !== false ? 'Z' : 'j'}</button>
    </div>
    <div class="property-row">
      <span>{t('prop.axes')}:</span>
      <button class="btn-small" class:active={sup.isGlobal !== false} onclick={() => updateSpringField(supId, 'isGlobal', '1')}
      >Gl</button>
      <button class="btn-small" class:active={sup.isGlobal === false} onclick={() => updateSpringField(supId, 'isGlobal', '0')}
      >Loc</button>
    </div>
    <div class="property-row" title={t('prop.imposedDispRollerTitle')}>
      <span>di:</span>
      <input type="number" step="any" value={shown(sup.dx, 'dx')} class="prop-input" onchange={(e) => updateSpringField(supId, 'dx', e.currentTarget.value)} />
      <span>{unitLabel('displacement', us)}</span>
    </div>
    <div class="property-row">
      <span>α:</span>
      <input type="number" step="5" value={sup.angle ?? 0} class="prop-input" onchange={(e) => updateSpringField(supId, 'angle', e.currentTarget.value)} />
      <span>°</span>
    </div>
  {:else if sup.type === 'spring'}
    <div class="property-row">
      <span>kx:</span>
      <input type="number" step="any" value={shown(sup.kx, 'kx')} class="prop-input" onchange={(e) => updateSpringField(supId, 'kx', e.currentTarget.value)} />
      <span>{unitLabel('springK', us)}</span>
    </div>
    <div class="property-row">
      <span>ky:</span>
      <input type="number" step="any" value={shown(sup.ky, 'ky')} class="prop-input" onchange={(e) => updateSpringField(supId, 'ky', e.currentTarget.value)} />
      <span>{unitLabel('springK', us)}</span>
    </div>
    <div class="property-row">
      <span>kz:</span>
      <input type="number" step="any" value={shown(sup.kz, 'kz')} class="prop-input" onchange={(e) => updateSpringField(supId, 'kz', e.currentTarget.value)} />
      <span>{unitLabel('springKr', us)}</span>
    </div>
    <div class="property-row">
      <span>{t('prop.axes')}:</span>
      <button class="btn-small" class:active={sup.isGlobal !== false} onclick={() => updateSpringField(supId, 'isGlobal', '1')}
        title={t('prop.globalAxesTitle')}>Gl</button>
      <button class="btn-small" class:active={sup.isGlobal === false} onclick={() => updateSpringField(supId, 'isGlobal', '0')}
        title={t('prop.localAxesTitle')}>Loc</button>
    </div>
    <div class="property-row">
      <span>α:</span>
      <input type="number" step="5" value={sup.angle ?? 0} class="prop-input" onchange={(e) => updateSpringField(supId, 'angle', e.currentTarget.value)} />
      <span>°</span>
    </div>
  {:else}
    <h4>{t('prop.imposedDisp')}</h4>
    {#if sup.type === 'fixed' || sup.type === 'pinned'}
      <div class="property-row" title={t('prop.imposedDxTitle')}>
        <span>dx:</span>
        <input type="number" step="any" value={shown(sup.dx, 'dx')} class="prop-input" onchange={(e) => updateSpringField(supId, 'dx', e.currentTarget.value)} />
        <span>{unitLabel('displacement', us)}</span>
      </div>
      <div class="property-row" title={t('prop.imposedDyTitle')}>
        <span>dz:</span>
        <input type="number" step="any" value={shown(sup.dy, 'dy')} class="prop-input" onchange={(e) => updateSpringField(supId, 'dy', e.currentTarget.value)} />
        <span>{unitLabel('displacement', us)}</span>
      </div>
    {/if}
    {#if sup.type === 'fixed'}
      <div class="property-row" title={t('prop.imposedDrzTitle')}>
        <span>dθy:</span>
        <input type="number" step="any" value={shown(sup.drz, 'drz')} class="prop-input" onchange={(e) => updateSpringField(supId, 'drz', e.currentTarget.value)} />
        <span>{unitLabel('rotation', us)}</span>
      </div>
    {/if}
    <div class="property-row" title={t('prop.visualAngleTitle')}>
      <span>α:</span>
      <input type="number" step="5" value={sup.angle ?? 0} class="prop-input" onchange={(e) => updateSpringField(supId, 'angle', e.currentTarget.value)} />
      <span>°</span>
    </div>
{/if}
<button class="btn-small btn-secondary" onclick={() => removeSupport(supId)}>
  {t('prop.removeSupport')}
</button>

<style>
  h4 {
    font-size: 0.7rem;
    color: #aaa;
    margin-top: 0.5rem;
  }

  .property-row {
    display: flex;
    justify-content: space-between;
    font-size: 0.875rem;
    padding: 0.25rem 0;
  }

  .prop-input {
    width: 65px;
    padding: 0.2rem 0.3rem;
    background: #0f3460;
    border: 1px solid #1a4a7a;
    border-radius: 3px;
    color: #eee;
    font-size: 0.8rem;
  }

  select {
    padding: 0.5rem;
    background: #0f3460;
    border: 1px solid #1a4a7a;
    border-radius: 4px;
    color: #eee;
    font-size: 0.875rem;
  }

  .btn-small {
    padding: 0.25rem 0.5rem;
    font-size: 0.75rem;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    margin-top: 0.5rem;
  }

  .btn-secondary {
    background: #0f3460;
    color: #aaa;
  }

  .btn-secondary:hover {
    background: #1a4a7a;
    color: white;
  }

  input[type="checkbox"] {
    accent-color: #e94560;
  }
</style>
