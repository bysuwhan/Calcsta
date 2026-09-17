<script lang="ts">
  import { modelStore, uiStore, historyStore } from '../lib/store';
  import { NO_RELEASE } from '../lib/store/model.svelte';
  import { t } from '../lib/i18n';
  import { toDisplay, unitLabel } from '../lib/utils/units';

  const elemId = $derived(uiStore.editingElementId);
  const elem = $derived(elemId !== null ? modelStore.elements.get(elemId) : undefined);
  const rawPos = $derived(uiStore.editScreenPos);

  let editorEl: HTMLDivElement | undefined = $state();
  // Clamp position so panel never extends beyond viewport
  const pos = $derived.by(() => {
    let x = rawPos.x;
    let y = rawPos.y;
    if (editorEl) {
      const rect = editorEl.getBoundingClientRect();
      const vh = window.innerHeight;
      const vw = window.innerWidth;
      // If bottom edge exceeds viewport, move panel up
      if (y + rect.height + 10 > vh) {
        y = Math.max(10, vh - rect.height - 10);
      }
      // Horizontal clamping
      const halfW = rect.width / 2;
      if (x - halfW < 10) x = halfW + 10;
      if (x + halfW > vw - 10) x = vw - halfW - 10;
    }
    return { x, y };
  });

  let materialId = $state(1);
  let sectionId = $state(1);
  // Sliding joints (Basic 2D only) — '' = none.
  let slideStart = $state<'' | 'x' | 'z'>('');
  let slideEnd = $state<'' | 'x' | 'z'>('');
  let slideStartAxis = $state<'global' | 'local'>('global');
  let slideEndAxis = $state<'global' | 'local'>('global');

  // Sync local values when element changes
  $effect(() => {
    if (elem) {
      slideStart = elem.releaseI?.slide ?? '';
      slideEnd = elem.releaseJ?.slide ?? '';
      slideStartAxis = elem.releaseI?.slideAxis ?? 'global';
      slideEndAxis = elem.releaseJ?.slideAxis ?? 'global';
      materialId = elem.materialId;
      sectionId = elem.sectionId;
    }
  });

  function confirm() {
    if (!elem || elemId === null || !modelStore.canEditElement(elemId)) return;
    const changed =
      slideStart !== (elem.releaseI?.slide ?? '') ||
      slideEnd !== (elem.releaseJ?.slide ?? '') ||
      slideStartAxis !== (elem.releaseI?.slideAxis ?? 'global') ||
      slideEndAxis !== (elem.releaseJ?.slideAxis ?? 'global') ||
      materialId !== elem.materialId ||
      sectionId !== elem.sectionId;

    if (changed) {
      historyStore.pushState();
      // Rotational releases belong to the connected node properties. Preserve
      // them while this member editor changes slides or section data.
      const relI = { ...(elem.releaseI ?? NO_RELEASE) } as typeof elem.releaseI;
      const relJ = { ...(elem.releaseJ ?? NO_RELEASE) } as typeof elem.releaseJ;
      if (slideStart === '') { delete relI.slide; delete relI.slideAxis; }
      else { relI.slide = slideStart; relI.slideAxis = slideStartAxis; }
      if (slideEnd === '') { delete relJ.slide; delete relJ.slideAxis; }
      else { relJ.slide = slideEnd; relJ.slideAxis = slideEndAxis; }
      elem.releaseI = relI;
      elem.releaseJ = relJ;
      elem.materialId = materialId;
      elem.sectionId = sectionId;
    }
    close();
  }

  function close() {
    uiStore.editingElementId = null;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      confirm();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
    e.stopPropagation();
  }
</script>

{#if elem}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="backdrop" onclick={close}></div>
  <div class="editor" bind:this={editorEl} style="left: {pos.x}px; top: {pos.y}px;" onkeydown={handleKeydown}>
    <div class="title">{t('editor.element')} {elemId}</div>

    <div class="field">
      <span>{t('editor.material')}:</span>
      <select bind:value={materialId}>
        {#each Array.from(modelStore.materials.values()) as mat}
          <option value={mat.id}>{mat.name}</option>
        {/each}
      </select>
    </div>

    <div class="field">
      <span>{t('editor.section')}:</span>
      <select bind:value={sectionId}>
        {#each Array.from(modelStore.sections.values()) as sec}
          <option value={sec.id}>{sec.name}</option>
        {/each}
      </select>
    </div>

    {#if elem.type === 'frame'}
      <div class="field">
        <span>{t('editor.slideStart')}:</span>
        <select bind:value={slideStart}>
          <option value="">{t('editor.slideNone')}</option>
          <option value="x">{t('editor.slideX')}</option>
          <option value="z">{t('editor.slideZ')}</option>
        </select>
        {#if slideStart !== ''}
          <select bind:value={slideStartAxis} title={t('float.jointAxis')}>
            <option value="global">{t('float.jointAxisGlobal')}</option>
            <option value="local">{t('float.jointAxisLocal')}</option>
          </select>
        {/if}
      </div>
      <div class="field">
        <span>{t('editor.slideEnd')}:</span>
        <select bind:value={slideEnd}>
          <option value="">{t('editor.slideNone')}</option>
          <option value="x">{t('editor.slideX')}</option>
          <option value="z">{t('editor.slideZ')}</option>
        </select>
        {#if slideEnd !== ''}
          <select bind:value={slideEndAxis} title={t('float.jointAxis')}>
            <option value="global">{t('float.jointAxisGlobal')}</option>
            <option value="local">{t('float.jointAxisLocal')}</option>
          </select>
        {/if}
      </div>
    {/if}

    <div class="info">
      {t('editor.nodesLabel')}: {elem.nodeI} → {elem.nodeJ}
      | L = {toDisplay(modelStore.getElementLength(elemId!), 'length', uiStore.unitSystem).toFixed(3)} {unitLabel('length', uiStore.unitSystem)}
    </div>

    <div class="buttons">
      <button class="btn-ok" onclick={confirm}>OK</button>
      <button class="btn-cancel" onclick={close}>{t('editor.cancel')}</button>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 99;
  }

  .editor {
    position: fixed;
    z-index: 100;
    background: #16213e;
    border: 1px solid #0f3460;
    border-radius: 6px;
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
    transform: translate(-50%, 10px);
    min-width: 220px;
  }

  .title {
    font-size: 0.8rem;
    font-weight: 600;
    color: #4ecdc4;
  }

  .field {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.8rem;
    color: #ccc;
  }

  .field span {
    min-width: 60px;
  }

  .field select {
    flex: 1;
    padding: 0.3rem;
    background: #0f3460;
    border: 1px solid #1a4a7a;
    border-radius: 4px;
    color: #eee;
    font-size: 0.8rem;
  }

  .info {
    font-size: 0.7rem;
    color: #888;
    padding-top: 0.25rem;
    border-top: 1px solid #0f3460;
  }

  .buttons {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
    margin-top: 0.25rem;
  }

  .btn-ok, .btn-cancel {
    padding: 0.25rem 0.6rem;
    border: none;
    border-radius: 4px;
    font-size: 0.75rem;
    cursor: pointer;
  }

  .btn-ok {
    background: #e94560;
    color: white;
  }
  .btn-ok:hover { background: #ff6b6b; }

  .btn-cancel {
    background: #2a2a4e;
    color: #aaa;
  }
  .btn-cancel:hover { background: #3a3a5e; }
</style>
