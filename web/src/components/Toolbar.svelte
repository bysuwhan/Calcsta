<script lang="ts">
  import { historyStore } from '../lib/store';
  import { t } from '../lib/i18n';
  /*
   * The conversion itself lives in the store now, shared with the dialog the
   * ribbon opens. Two copies of "replace the model, remember the original,
   * remap the plane, clear the results" is two chances to forget the backup.
   */
  import ToolbarResults from './toolbar/ToolbarResults.svelte';
  import ToolbarAdvanced from './toolbar/ToolbarAdvanced.svelte';
  import ToolbarExamples from './toolbar/ToolbarExamples.svelte';
  import ToolbarConfig from './toolbar/ToolbarConfig.svelte';
  import ToolbarProject from './toolbar/ToolbarProject.svelte';

  /* Basic exposes a single 2D drawing surface. */
  /*
  let show2DPlaneModal = $state(false);
  let planeCollapsed = $state<Record<DrawPlane, number>>({ xy: 0, xz: 0, yz: 0 });

  function computePlaneStats() {
    planeCollapsed = collapsedByPlane();
  }
  */

</script>


<div class="toolbar">
  <div class="toolbar-section">
    <div class="undo-redo-row">
      <button
        class="undo-redo-btn"
        onclick={() => historyStore.undo()}
        disabled={!historyStore.canUndo}
        title={`${t('toolbar.undo')} (Ctrl+Z)`}
      >↶ {t('toolbar.undo')}</button>
      <button
        class="undo-redo-btn"
        onclick={() => historyStore.redo()}
        disabled={!historyStore.canRedo}
        title={`${t('toolbar.redo')} (Ctrl+Y)`}
      >↷ {t('toolbar.redo')}</button>
    </div>
  </div>

  <ToolbarResults />
  <ToolbarAdvanced />
  <ToolbarExamples />

  <!-- Configuración + Proyecto wrapper for tour spotlight -->
  <div data-tour="config-project-section" style="display:flex;flex-direction:column;gap:1rem">
    <ToolbarConfig />
    <ToolbarProject />
  </div>

</div>

<style>
  .toolbar {
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .toolbar-section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .undo-redo-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.25rem;
  }

  .undo-redo-btn {
    padding: 0.35rem 0.4rem;
    background: var(--st-surface-2);
    border: 1px solid var(--st-hair-strong);
    border-radius: 4px;
    color: var(--st-text);
    cursor: pointer;
    font-size: 0.75rem;
    text-align: center;
    transition: all 0.2s;
  }

  .undo-redo-btn:hover:not(:disabled) {
    background: var(--st-surface-3);
    color: white;
  }

  .undo-redo-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

</style>
