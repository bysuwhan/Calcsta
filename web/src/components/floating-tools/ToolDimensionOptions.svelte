<script lang="ts">
  import { t } from '../../lib/i18n';
  import { sketchUI } from '../../lib/store/sketch.svelte';
</script>

{#if sketchUI.draft}
  <span class="hint" role="status">{t('sketch.placeDimension')}</span>
  <button onclick={sketchUI.cancel}>{t('sketch.cancel')}</button>
{:else}
  <span class="hint" role="status">{t(sketchUI.first ? 'sketch.pickNext' : 'sketch.autoHint')}</span>
  {#if sketchUI.first}<button onclick={sketchUI.cancel}>{t('sketch.cancel')}</button>{/if}
{/if}

<style>
  button { background:var(--st-surface-2); color:var(--st-text); border:1px solid var(--st-hair); border-radius:var(--st-radius); font-size:.75rem; padding:.2rem .42rem; }
  button { cursor:pointer; }
  .hint { color:var(--st-text-2); font-size:.78rem; }
</style>
