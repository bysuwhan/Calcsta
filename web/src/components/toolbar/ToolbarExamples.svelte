<script lang="ts">
  import { modelStore, resultsStore } from '../../lib/store';
  import { t } from '../../lib/i18n';

  let { flat = false }: { flat?: boolean } = $props();

  let open = $state(false);
  const examples = [
    'simply-supported', 'cantilever', 'cantilever-point', 'point-loads',
    'gerber-beam', 'continuous-beam', 'spring-support', 'settlement',
    'truss', 'warren-truss', 'howe-truss', 'three-hinge-arch', 'portal-frame',
    'two-story-frame', 'bridge-moving-load', 'frame-cirsoc-dl',
    'building-3story-dlw', 'frame-seismic',
  ] as const;

  async function loadExample(id: string) {
    await modelStore.loadExample(id);
    resultsStore.clear();
    setTimeout(() => window.dispatchEvent(new Event('stabileo-zoom-to-fit')), 50);
  }
</script>

<div class="examples" class:flat>
  <button class="section-toggle" onclick={() => open = !open}>
    <span>{open ? '▾' : '▸'} {t('examples.title2d')}</span>
    <span class="count">{examples.length}</span>
  </button>
  {#if open}
    <div class="examples-list">
      {#each examples as id}
        <button class="example-item" onclick={() => loadExample(id)}>
          <span class="example-name">{t(`ex.${id}`)}</span>
          <span class="example-desc">{t(`ex.${id}.desc`)}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .examples { display: flex; flex-direction: column; gap: .5rem; }
  .section-toggle { display:flex; justify-content:space-between; width:100%; padding:.4rem .5rem; background:none; border:1px solid var(--st-hair); border-radius:4px; color:var(--st-text-2); cursor:pointer; font-size:.75rem; font-weight:600; text-align:left; text-transform:uppercase; }
  .count { color:var(--st-text-3); font-family:var(--st-mono,monospace); font-size:.6rem; }
  .examples-list { display:flex; flex-direction:column; gap:2px; max-height:260px; overflow-y:auto; border:1px solid var(--st-hair-strong); border-radius:4px; padding:2px; }
  .example-item { display:flex; flex-direction:column; padding:.35rem .5rem; background:none; border:0; border-radius:3px; color:var(--st-text); cursor:pointer; text-align:left; }
  .example-item:hover { background:var(--st-surface-3); color:white; }
  .example-name { font-size:.8rem; font-weight:500; }
  .example-desc { color:var(--st-text-3); font-size:.65rem; }
</style>
