<script lang="ts">
  import { modelStore, uiStore, resultsStore } from '../../lib/store';
  import { t } from '../../lib/i18n';
  import {
    TWO_D_DISPLACEMENT_LABELS,
    TWO_D_REACTION_LABELS,
    get2DDisplayDisplacementVertical,
    get2DDisplayMoment,
    get2DDisplayReactionVertical,
    get2DDisplayRotation,
  } from '../../lib/geometry/coordinate-system';
  import { toDisplay, unitLabel, type Quantity } from '../../lib/utils/units';

  const us = $derived(uiStore.unitSystem);
  const dv = (value: number, quantity: Quantity) => toDisplay(value, quantity, us);
  const ul = (quantity: Quantity) => unitLabel(quantity, us);

  let resultsSubTab = $state<'displacements' | 'reactions' | 'forces' | 'diagnostics'>('displacements');

  // Merge assembly + solver diagnostics into a single list
  const allDiagnostics = $derived((() => {
    const items: Array<{ source: string; type: string; message: string; severity: string }> = [];
    for (const d of resultsStore.diagnostics) {
      const elemIds = d.elementIds && d.elementIds.length > 0
        ? t('results.elemLabel').replace('{id}', String(d.elementIds[0]))
        : '';
      items.push({ source: elemIds || d.source, type: d.code, message: d.message, severity: d.severity });
    }
    for (const d of resultsStore.solverDiagnostics) {
      items.push({ source: d.source, type: d.code, message: d.message, severity: d.severity });
    }
    return items;
  })());

  /** Individual load cases, in the order the solver produced them. */
  const caseKeys = $derived([...resultsStore.perCase.keys()]);
</script>

<!--
  Which load state the table describes.
  
  It was a row of buttons — one per combination, plus the envelope — which grew
  a wrapping wall on any real model and offered no way to see the SIMPLE loads
  at all: the two states the diagram selector above does offer, all loads
  together and each case on its own. A table that cannot show what the canvas
  is showing is not the same view of the same result.
  
  A select, because this is one choice from a list that gets long, and because
  it is the same control the diagram selector uses for the same question.
-->
{#if resultsStore.hasCombinations || caseKeys.length > 0}
  <div class="results-case-bar">
    <!--
      No visible label. Every option in the list names itself — "Simple loads",
      a case name, a combination — so the word in front of them added a column
      of chrome and no information. The accessible name stays, for a reader who
      cannot see that the options are self-describing.
    -->
    <select
      id="results-case"
      aria-label={t('results.primary')}
      value={resultsStore.activeView === 'envelope' ? 'envelope'
           : resultsStore.activeCaseId !== null ? `case_${resultsStore.activeCaseId}`
           : resultsStore.activeView === 'combo' ? `combo_${resultsStore.activeComboId ?? ''}`
           : 'single'}
      onchange={(e) => {
        const v = (e.currentTarget as HTMLSelectElement).value;
        if (v === 'single') { resultsStore.activeCaseId = null; resultsStore.activeView = 'single'; }
        else if (v === 'envelope') { resultsStore.activeCaseId = null; resultsStore.activeView = 'envelope'; }
        else if (v.startsWith('case_')) { resultsStore.activeCaseId = Number(v.slice(5)); }
        else if (v.startsWith('combo_')) {
          resultsStore.activeCaseId = null;
          resultsStore.activeView = 'combo';
          resultsStore.activeComboId = Number(v.slice(6));
        }
      }}
    >
      <option value="single">{t('results.simpleLoads')}</option>
      {#each caseKeys as id}
        {@const lc = modelStore.model.loadCases.find((c) => c.id === id)}
        <option value={`case_${id}`}>{lc?.name ?? `${t('results.caseFallback')} ${id}`}</option>
      {/each}
      {#each modelStore.combinations as combo}
        <option value={`combo_${combo.id}`}>{combo.name}</option>
      {/each}
      {#if resultsStore.hasCombinations}
        <option value="envelope">{t('resultsTable.envelope')}</option>
      {/if}
    </select>
  </div>
{/if}
<div class="results-sub-tabs">
  <button class:active={resultsSubTab === 'displacements'} onclick={() => resultsSubTab = 'displacements'}>{t('resultsTable.displacements')}</button>
  <button class:active={resultsSubTab === 'reactions'} onclick={() => { resultsSubTab = 'reactions'; resultsStore.showReactions = true; }}>{t('resultsTable.reactions')}</button>
  <button class:active={resultsSubTab === 'forces'} onclick={() => resultsSubTab = 'forces'}>{t('resultsTable.internalForces')}</button>
  {#if allDiagnostics.length > 0}
    <button class:active={resultsSubTab === 'diagnostics'} onclick={() => resultsSubTab = 'diagnostics'}>
      {t('resultsTable.diagnostics')} ({allDiagnostics.length})
    </button>
  {/if}
</div>

<div class="results-content">
  {#if resultsStore.results}
    <!-- 2D Results -->
    {#if resultsSubTab === 'displacements'}
      <table>
        <thead>
          <tr><th>{t('table.nodeLabel')}</th><th>{TWO_D_DISPLACEMENT_LABELS.horizontal} ({ul('displacement')})</th><th>{TWO_D_DISPLACEMENT_LABELS.vertical} ({ul('displacement')})</th><th>{TWO_D_DISPLACEMENT_LABELS.rotation} ({ul('rotation')})</th></tr>
        </thead>
        <tbody>
          {#each resultsStore.results.displacements as d}
            <tr>
              <td class="id-cell">{d.nodeId}</td>
              <td class="num">{dv(d.ux, 'displacement').toFixed(4)}</td>
              <td class="num">{dv(get2DDisplayDisplacementVertical(d), 'displacement').toFixed(4)}</td>
              <td class="num">{dv(get2DDisplayRotation(d), 'rotation').toFixed(6)}</td>
            </tr>
          {/each}
        </tbody>
      </table>

    {:else if resultsSubTab === 'reactions'}
      <table>
        <thead>
          <tr><th>{t('table.nodeLabel')}</th><th>{TWO_D_REACTION_LABELS.horizontal} ({ul('force')})</th><th>{TWO_D_REACTION_LABELS.vertical} ({ul('force')})</th><th>{TWO_D_REACTION_LABELS.moment} ({ul('moment')})</th></tr>
        </thead>
        <tbody>
          {#each resultsStore.results.reactions as r}
            <tr>
              <td class="id-cell">{r.nodeId}</td>
              <td class="num">{dv(r.rx, 'force').toFixed(4)}</td>
              <td class="num">{dv(get2DDisplayReactionVertical(r), 'force').toFixed(4)}</td>
              <td class="num">{dv(-get2DDisplayMoment(r), 'moment').toFixed(4)}</td>
            </tr>
          {/each}
        </tbody>
      </table>

    {:else if resultsSubTab === 'forces'}
      <table>
        <thead>
          <tr><th>{t('table.elemLabel')}</th><th>Ni ({ul('force')})</th><th>Nj ({ul('force')})</th><th>Vi ({ul('force')})</th><th>Vj ({ul('force')})</th><th>Mi ({ul('moment')})</th><th>Mj ({ul('moment')})</th></tr>
        </thead>
        <tbody>
          {#each resultsStore.results.elementForces as ef}
            <tr>
              <td class="id-cell">{ef.elementId}</td>
              <td class="num">{dv(ef.nStart, 'force').toFixed(4)}</td>
              <td class="num">{dv(ef.nEnd, 'force').toFixed(4)}</td>
              <td class="num">{dv(ef.vStart, 'force').toFixed(4)}</td>
              <td class="num">{dv(ef.vEnd, 'force').toFixed(4)}</td>
              <td class="num">{dv(-ef.mStart, 'moment').toFixed(4)}</td>
              <td class="num">{dv(-ef.mEnd, 'moment').toFixed(4)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  {/if}

  {#if resultsSubTab === 'diagnostics' && allDiagnostics.length > 0}
    <table>
      <thead>
        <tr><th>{t('results.diagSource')}</th><th>{t('results.diagType')}</th><th>{t('results.diagMessage')}</th><th>{t('results.diagSeverity')}</th></tr>
      </thead>
      <tbody>
        {#each allDiagnostics as d}
          <tr>
            <td class="id-cell">{d.source}</td>
            <td>{d.type}</td>
            <td>{d.message}</td>
            <td class={d.severity === 'warning' ? 'severity-warn' : d.severity === 'error' ? 'severity-err' : ''}>{d.severity}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<style>
  .results-case-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--st-border);
  }
  .results-case-bar select {
    flex: 1;
    min-width: 0;
    padding: 3px 6px;
    border-radius: var(--st-radius, 3px);
    border: 1px solid var(--st-border);
    background: var(--st-surface-3);
    color: var(--st-text);
    font-size: 0.74rem;
  }

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

  .num {
    font-family: 'Courier New', monospace;
    text-align: right;
  }

  tr:hover {
    background: rgba(127, 212, 204, 0.5);
  }

  .results-sub-tabs {
    display: flex;
    gap: 0;
    border-bottom: 1px solid var(--st-surface-3);
    background: var(--st-surface-2);
    flex-shrink: 0;
  }

  .results-sub-tabs button {
    padding: 0.35rem 0.75rem;
    border: none;
    background: transparent;
    color: var(--st-text-3);
    cursor: pointer;
    font-size: 0.72rem;
    border-bottom: 2px solid transparent;
  }
  .results-sub-tabs button:hover { color: var(--st-text); }
  /*
     An active tab takes the accent, like every other active control in the
     shell. These were amber, which this palette reserves for a warning — so
     "Displacements is the tab you are on" was drawn in the colour that
     elsewhere means "something needs your attention".
  */
  .results-sub-tabs button.active {
    color: var(--st-accent);
    border-bottom-color: var(--st-accent);
  }

  .combo-view-tabs {
    background: var(--st-surface-2) !important;
  }
  .combo-view-tabs button.active {
    color: var(--st-accent) !important;
    border-bottom-color: var(--st-accent) !important;
  }

  .results-content {
    flex: 1;
    overflow: auto;
  }

  .severity-warn { color: var(--st-warn); font-weight: 600; }
  .severity-err { color: var(--st-accent); font-weight: 600; }
</style>
