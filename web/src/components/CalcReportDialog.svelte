<script lang="ts">
  import { modelStore, resultsStore, uiStore } from '../lib/store';
  import { openCalcReport, type CalcReportData, type CalcReportConfig, type ResultProvenance, type AnalysisModeLabel } from '../lib/engine/calc-report';
  import { t } from '../lib/i18n';
  import { toDisplay, unitLabel } from '../lib/utils/units';

  let { open = $bindable(false) }: { open: boolean } = $props();

  let projectName = $state(modelStore.model.name || 'Structural Analysis');
  let engineerName = $state('');
  let companyName = $state('');
  let notes = $state('');

  // The dialog component stays mounted for the app's lifetime, so the $state
  // initializer above only sees the startup model. Re-seed the project name
  // from the current model each time the dialog opens (it remains editable).
  $effect(() => {
    if (open) projectName = modelStore.model.name || 'Structural Analysis';
  });

  const hasResults = $derived(resultsStore.results !== null);
  const modeLabel: AnalysisModeLabel = '2D';

  function deriveProvenance(): ResultProvenance {
    const view = resultsStore.activeView;
    if (view === 'envelope') {
      return { kind: 'envelope' };
    }
    if (view === 'combo') {
      const comboId = resultsStore.activeComboId;
      const combo = comboId !== null
        ? modelStore.model.combinations.find(c => c.id === comboId)
        : undefined;
      return { kind: 'combo', comboName: combo?.name ?? `Combination ${comboId}` };
    }
    const caseId = resultsStore.activeCaseId;
    const caseName = caseId !== null ? modelStore.getLoadCaseName(caseId) : undefined;
    return { kind: 'single', caseName: caseName || undefined };
  }

  function generateReport() {
    if (!hasResults) return;
    const config: CalcReportConfig = {
      projectName,
      engineerName,
      companyName,
      date: new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' }),
      notes,
    };
    const shown = (value: number, quantity: Parameters<typeof toDisplay>[1]) => toDisplay(value, quantity, uiStore.unitSystem);

    // Extract load descriptions from model
    const loads = modelStore.loads.map((l) => {
      const d = l.data as any;
      let description = '';
      let caseLabel = modelStore.getLoadCaseName(d.caseId ?? 1) || undefined;
      if (l.type === 'nodal') {
        const parts: string[] = [];
        if (d.fx) parts.push(`Fx=${shown(d.fx, 'force')} ${unitLabel('force', uiStore.unitSystem)}`);
        if (d.fz) parts.push(`Fz=${shown(d.fz, 'force')} ${unitLabel('force', uiStore.unitSystem)}`);
        // `||` (not `??`) so a present-but-zero component falls through to the
        // axis that actually carries the moment (e.g. my=0, mz=5 → M=5).
        if (d.my || d.mz) parts.push(`M=${shown(d.my || d.mz, 'moment')} ${unitLabel('moment', uiStore.unitSystem)}`);
        description = `Node ${d.nodeId}: ${parts.join(', ') || 'zero'}`;
      } else if (l.type === 'distributed') {
        // A distributed load stores its magnitude on whichever axis it acts;
        // the off-axis fields can be present as 0. Use `||` so a 0 on one axis
        // doesn't shadow the real value on another (qZI=0, qYI=5 → q=5).
        const qI = d.qI ?? 0;
        const qJ = d.qJ ?? 0;
        description = `Elem ${d.elementId}: q=${shown(qI, 'distributedLoad')}→${shown(qJ, 'distributedLoad')} ${unitLabel('distributedLoad', uiStore.unitSystem)}`;
      } else if (l.type === 'pointOnElement') {
        description = `Elem ${d.elementId}: P=${shown(d.p, 'force')} ${unitLabel('force', uiStore.unitSystem)} at ${shown(d.a, 'length')} ${unitLabel('length', uiStore.unitSystem)}`;
      } else if (l.type === 'cylinder') {
        description = `Cylinder ${d.nodeI}–${d.nodeJ}: F=${shown(d.force, 'force')} ${unitLabel('force', uiStore.unitSystem)} (${d.force >= 0 ? 'push' : 'pull'})`;
      } else {
        description = `${l.type} on ${d.elementId ?? d.nodeId ?? '?'}`;
      }
      return { type: l.type, description, caseLabel };
    });

    // Build combination info
    const combinations = modelStore.model.combinations.map(c => ({
      id: c.id,
      name: c.name,
      factors: c.factors.map(f => ({
        caseName: modelStore.getLoadCaseName(f.caseId) || `Case ${f.caseId}`,
        factor: f.factor,
      })),
    }));

    const data: CalcReportData = {
      config,
      analysisMode: modeLabel,
      provenance: deriveProvenance(),
      hasDesignChecks: false,
      unitSystem: uiStore.unitSystem,
      nodes: [...modelStore.nodes.values()],
      elements: [...modelStore.elements.values()],
      materials: [...modelStore.materials.values()],
      sections: [...modelStore.sections.values()],
      supports: [...modelStore.supports.values()],
      loads,
      loadCases: modelStore.model.loadCases ?? [],
      combinations,
      results2D: resultsStore.results ?? undefined,
    };

    openCalcReport(data);
    open = false;
  }
</script>

{#if open}
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="dialog-overlay" onclick={() => open = false}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="dialog" onclick={(e) => e.stopPropagation()}>
    <h3>{t('calcReport.title')}</h3>
    <div class="form">
      <label>
        <span>{t('calcReport.projectName')}</span>
        <input type="text" bind:value={projectName} />
      </label>
      <label>
        <span>{t('calcReport.engineerName')}</span>
        <input type="text" bind:value={engineerName} placeholder={t('calcReport.optional')} />
      </label>
      <label>
        <span>{t('calcReport.companyName')}</span>
        <input type="text" bind:value={companyName} placeholder={t('calcReport.optional')} />
      </label>
      <label>
        <span>{t('calcReport.notes')}</span>
        <textarea bind:value={notes} rows="2" placeholder={t('calcReport.optional')}></textarea>
      </label>
    </div>
    {#if !hasResults}
      <div class="no-results-warning">{t('calcReport.noResults')}</div>
    {/if}
    <div class="actions">
      <button class="btn-secondary" onclick={() => open = false}>{t('calcReport.cancel')}</button>
      <button class="btn-primary" onclick={generateReport} disabled={!hasResults}>{t('calcReport.generate')}</button>
    </div>
  </div>
</div>
{/if}

<style>
  .dialog-overlay {
    position: fixed;
    inset: 0;
    z-index: 9999;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .dialog {
    background: #0d1b2e;
    border: 1px solid #1a4a7a;
    border-radius: 8px;
    padding: 1.5rem;
    width: 380px;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .dialog h3 {
    margin: 0;
    font-size: 1rem;
    color: #eee;
  }
  .form {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .form label {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .form label span {
    font-size: 0.75rem;
    color: #888;
  }
  .form input, .form textarea {
    padding: 0.4rem 0.6rem;
    background: #0f3460;
    border: 1px solid #1a4a7a;
    border-radius: 4px;
    color: #eee;
    font-size: 0.85rem;
  }
  .form textarea {
    resize: vertical;
  }
  .actions {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
  }
  .btn-secondary {
    padding: 0.4rem 1rem;
    background: #12192e;
    border: 1px solid #333;
    border-radius: 4px;
    color: #888;
    cursor: pointer;
    font-size: 0.8rem;
  }
  .btn-secondary:hover { background: #1a1a2e; color: #ccc; }
  .btn-primary {
    padding: 0.4rem 1rem;
    background: #1a4a7a;
    border: 1px solid #2a6ab0;
    border-radius: 4px;
    color: white;
    cursor: pointer;
    font-size: 0.8rem;
    font-weight: 600;
  }
  .btn-primary:hover:not(:disabled) { background: #2a6ab0; }
  .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .no-results-warning {
    font-size: 0.8rem;
    color: #e8a040;
    background: rgba(232, 160, 64, 0.5);
    border: 1px solid rgba(232, 160, 64, 0.5);
    border-radius: 4px;
    padding: 0.5rem 0.7rem;
    text-align: center;
  }
</style>
