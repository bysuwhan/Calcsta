<script lang="ts">
  import { modelStore, uiStore, resultsStore } from '../lib/store';
  import { t } from '../lib/i18n';
  import { inspectMember, inspectNode } from '../lib/canvas/draw-despiece';

  const inspect = $derived(uiStore.despieceInspect);
  const active = $derived(resultsStore.diagramType === 'despiece' && inspect !== null);

  function args2D() {
    return {
      elements: [...modelStore.elements.values()].map(e => ({ id: e.id, nodeI: e.nodeI, nodeJ: e.nodeJ })),
      getNode: (id: number) => { const n = modelStore.getNode(id); return n ? { x: n.x, y: n.y } : undefined; },
      getElementForces: (id: number) => {
        const f = resultsStore.getElementForces(id);
        return f ? { elementId: f.elementId, nStart: f.nStart, nEnd: f.nEnd, vStart: f.vStart, vEnd: f.vEnd, mStart: f.mStart, mEnd: f.mEnd } : undefined;
      },
      basis: uiStore.despieceBasis,
    };
  }
  // Aggregate the member-end actions in the Basic 2D frame.
  const actions = $derived.by<Array<{ elementId: number; end: 'I' | 'J'; nodeId: number; components: Array<{ label: string; value: number }> }>>(() => {
    if (!active || !inspect) return [];
    return inspect.type === 'member' ? (inspectMember(args2D(), inspect.id)?.ends ?? []) : inspectNode(args2D(), inspect.id).actions;
  });

  const nodeReaction = $derived<string | null>(null);

  const fmt = (v: number) => v.toFixed(2);
  function close() { uiStore.despieceInspect = null; }

</script>

{#if active && inspect}
  <div class="dsp-inspect">
    <div class="dsp-head">
      <span class="dsp-title">
        {inspect.type === 'node' ? t('despiece.inspectNode').replace('{id}', String(inspect.id)) : t('despiece.inspectMember').replace('{id}', String(inspect.id))}
        <span class="dsp-basis">({uiStore.despieceBasis === 'global' ? t('despiece.basisGlobal') : t('despiece.basisLocal')})</span>
      </span>
      <button class="dsp-close" onclick={close} title={t('editor.cancel')}>✕</button>
    </div>
    {#if actions.length === 0}
      <div class="dsp-empty">{t('despiece.inspectEmpty')}</div>
    {:else}
      <table class="dsp-table">
        <thead>
          <tr><th>{t('despiece.colMember')}</th>{#each actions[0].components as c}<th>{c.label}</th>{/each}</tr>
        </thead>
        <tbody>
          {#each actions as a}
            <tr>
              <td>E{a.elementId}·{a.end} <span class="dsp-node">(n{a.nodeId})</span></td>
              {#each a.components as c}<td>{fmt(c.value)}</td>{/each}
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
    {#if nodeReaction}
      <div class="dsp-react">{t('despiece.legendReaction')}: {nodeReaction}</div>
    {/if}
  </div>
{/if}

<style>
  .dsp-inspect {
    position: fixed;
    top: 70px;
    right: 14px;
    z-index: 60;
    background: var(--st-surface-2);
    border: 1px solid var(--st-surface-3);
    border-radius: 6px;
    padding: 8px 10px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
    min-width: 210px;
    max-width: 320px;
    font-size: 0.72rem;
    color: var(--st-text);
  }
  .dsp-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
  .dsp-title { font-weight: 600; color: var(--st-value); }
  .dsp-basis { color: var(--st-text-3); font-weight: 400; font-size: 0.68rem; }
  .dsp-close { background: none; border: none; color: var(--st-text-2); cursor: pointer; font-size: 0.8rem; line-height: 1; }
  .dsp-close:hover { color: var(--st-text); }
  .dsp-empty { color: var(--st-text-3); font-style: italic; }
  .dsp-table { border-collapse: collapse; width: 100%; }
  .dsp-table th, .dsp-table td { text-align: right; padding: 1px 6px; }
  .dsp-table th:first-child, .dsp-table td:first-child { text-align: left; }
  .dsp-table th { color: var(--st-text-3); font-weight: 600; border-bottom: 1px solid var(--st-surface-3); }
  .dsp-node { color: var(--st-text-3); }
  .dsp-react { margin-top: 5px; padding-top: 4px; border-top: 1px solid var(--st-surface-3); color: var(--st-ok); }
</style>
