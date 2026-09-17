<script lang="ts">
  import { modelStore, uiStore } from '../lib/store';
  import { BLOCK_COLOR_PALETTE, resolveNodeRef } from '../lib/model/blocks';
  import { blockUI } from '../lib/store/blocks.svelte';
  import Icon from './ribbon/Icon.svelte';
  let name = $state('');
  let renaming = $state<number | null>(null);
  let colorPicking = $state<number | null>(null);
  const activeJoints = $derived(modelStore.blocks.joints.filter(j => [j.a, j.b].every(r => { const id = resolveNodeRef(modelStore.blocks, r); return id !== undefined && modelStore.nodes.has(id); })));
  const localPosition = $derived(blockUI.localCursor({ x: uiStore.worldX, y: uiStore.worldY }));
  const editing = $derived(modelStore.editingBlockId !== null);
  $effect(() => { if (editing && ['support', 'load', 'cylinder'].includes(uiStore.currentTool)) uiStore.currentTool = 'select'; });
  function keydown(e: KeyboardEvent) {
    if (e.key === 'Escape') { blockUI.cancel(); blockUI.closeContext(); renaming = null; colorPicking = null; }
  }
</script>

<svelte:window onkeydown={keydown} />
<aside class="blocks" aria-label="블록 목록" data-testid="block-panel">
  <div class="heading"><strong>블록</strong><span>{modelStore.blocks.instances.length}</span></div>

  <button class="base" class:chosen={blockUI.selected === null && !editing} disabled={editing} onclick={() => blockUI.select(null)}>바탕</button>
  <div class="list">
    {#each modelStore.blocks.instances as block (block.id)}
      <div class="row" class:chosen={blockUI.selected === block.id} class:hidden-block={!block.visible} data-testid={`block-row-${block.id}`}>
        <button
          type="button"
          class="color"
          disabled={editing}
          aria-label={`${block.name} 색상 선택`}
          aria-expanded={colorPicking === block.id}
          style={`--block-color: ${block.color}`}
          onclick={() => colorPicking = colorPicking === block.id ? null : block.id}
        ></button>
        {#if colorPicking === block.id}
          <button type="button" class="palette-backdrop" aria-label="색상표 닫기" onclick={() => colorPicking = null}></button>
          <div class="palette" role="group" aria-label={`${block.name} 색상표`}>
            {#each BLOCK_COLOR_PALETTE as color}
              <button
                type="button"
                class="color-swatch"
                class:active={color === block.color.toLowerCase()}
                style={`--swatch-color: ${color}`}
                aria-label={color}
                onclick={() => { modelStore.setBlockAppearance(block.id, { color }); colorPicking = null; }}
              ></button>
            {/each}
          </div>
        {/if}
        <button class="name" disabled={editing && modelStore.editingBlockId !== block.id} onclick={() => blockUI.select(block.id)} ondblclick={() => blockUI.edit(block.id)} oncontextmenu={e => { e.preventDefault(); if (!editing) blockUI.openContext(block.id, e.clientX, e.clientY); }}>{block.name}</button>
        <button
          type="button"
          class="visibility"
          class:off={!block.visible}
          disabled={editing}
          aria-label={`${block.name} ${block.visible ? '숨기기' : '보이기'}`}
          aria-pressed={block.visible}
          title={block.visible ? '숨기기' : '보이기'}
          onclick={() => { modelStore.setBlockVisible(block.id, !block.visible); blockUI.cancel(); uiStore.clearSelection(); }}
        ><Icon name={block.visible ? 'visibility' : 'visibility-off'} size={17} /></button>
      </div>
    {/each}
  </div>
  {#if editing}
    <div class="edit" data-testid="block-edit-banner"><strong>블록 편집 중</strong><span>로컬 x {localPosition.x.toFixed(3)}, y {localPosition.y.toFixed(3)}</span><p>형태 변경은 연결 복제본에도 적용됩니다.</p><p>하중·지점은 바탕에서 지정하세요.</p></div>
  {/if}
  {#if activeJoints.length}
    <div class="joints"><strong>연결</strong>{#each activeJoints as j (j.id)}<button disabled={editing} title="우클릭하여 연결 해제" oncontextmenu={e => { e.preventDefault(); if (!editing) modelStore.removeBlockJoint(j.id); }} onclick={() => modelStore.removeBlockJoint(j.id)}>{j.kind === 'pin' ? '핀' : '연속'} {j.id} · 해제</button>{/each}</div>
  {/if}
</aside>
{#if blockUI.context}
  {@const menu = blockUI.context}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="ctx-backdrop" onclick={blockUI.closeContext} oncontextmenu={e => { e.preventDefault(); blockUI.closeContext(); }}></div>
  <div class="ctx-menu" role="menu" style="left: {Math.min(menu.x, window.innerWidth - 170)}px; top: {Math.min(menu.y, window.innerHeight - 270)}px;">
    <button class="ctx-item" role="menuitem" onclick={() => blockUI.edit(menu.id)}>블록 편집</button>
    <button class="ctx-item" role="menuitem" onclick={() => blockUI.duplicate(menu.id)}>복제</button>
    <button class="ctx-item" role="menuitem" onclick={() => { modelStore.makeBlockIndependent(menu.id); blockUI.closeContext(); }}>독립시키기</button>
    <div class="ctx-divider"></div>
    <button class="ctx-item" role="menuitem" onclick={() => blockUI.begin('move', menu.id)}>이동</button>
    <button class="ctx-item" role="menuitem" onclick={() => blockUI.begin('rotate', menu.id)}>회전</button>
    <button class="ctx-item" role="menuitem" onclick={() => { const b = modelStore.blocks.instances.find(x => x.id === menu.id); name = b?.name ?? ''; renaming = menu.id; blockUI.closeContext(); }}>이름 변경</button>
    <div class="ctx-divider"></div>
    <button class="ctx-item ctx-danger" role="menuitem" onclick={() => { modelStore.deleteBlock(menu.id); blockUI.select(null); blockUI.closeContext(); }}>삭제</button>
  </div>
{/if}
{#if renaming !== null}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="rename-overlay" onclick={() => renaming = null}>
    <div class="rename-modal" onclick={e => e.stopPropagation()}>
      <div class="rename-header">
        <strong>블록 이름 변경</strong>
        <button type="button" class="close-btn" onclick={() => renaming = null}>✕</button>
      </div>
      <form onsubmit={e => { e.preventDefault(); if (renaming !== null) { modelStore.setBlockAppearance(renaming, { name: name.trim() || '블록' }); renaming = null; } }}>
        <input aria-label="새 블록 이름" bind:value={name} required maxlength="80" autofocus />
        <div class="modal-actions">
          <button type="submit" class="btn-primary">저장</button>
          <button type="button" class="btn-secondary" onclick={() => renaming = null}>취소</button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
  .blocks { width: 220px; flex: 0 0 220px; background: #1c2d3d; color: #ccc; border-right: 1px solid #0f3460; display: flex; flex-direction: column; padding: 12px; gap: 8px; overflow: auto; font-size: 12px; box-shadow: 3px 0 12px rgba(0, 0, 0, 0.5); }
  .heading, .row { display: flex; align-items: center; gap: 6px; }
  .heading { justify-content: space-between; padding-bottom: 8px; border-bottom: 1px solid #0f3460; font-size: 13px; color: #4ecdc4; }
  .heading span { min-width: 20px; padding: 1px 6px; border-radius: 999px; background: #0f3460; color: #aaa; font-size: 10px; text-align: center; }
  button, input { font: inherit; }
  button { color: inherit; background: #2a2a4e; border: 1px solid #0f3460; border-radius: 4px; padding: 6px 8px; cursor: pointer; }
  button:hover:not(:disabled) { background: #3a3a5e; color: #eee; }
  button:disabled { opacity: 0.5; cursor: default; }
  .base { text-align: left; font-weight: 600; }
  .base.chosen { background: #0f3460; border-color: #1a4a7a; color: #eee; }
  .row { position: relative; padding: 4px; border: 1px solid transparent; border-radius: 4px; }
  .row.chosen { background: #0f3460; border-color: #1a4a7a; }
  .row button.color { width: 30px; height: 23px; flex: 0 0 30px; border: 1px solid #8fa0b5; border-radius: 3px; padding: 0; background: var(--block-color); cursor: pointer; }
  .row button.color:hover:not(:disabled) { background: var(--block-color); border-color: #fff; }
  .palette-backdrop { position: fixed; inset: 0; z-index: 100; padding: 0; border: 0; border-radius: 0; background: transparent; }
  .palette-backdrop:hover:not(:disabled) { background: transparent; }
  .palette { position: absolute; left: 28px; top: 30px; z-index: 101; display: grid; grid-template-columns: repeat(5, 24px); gap: 5px; padding: 7px; background: #16213e; border: 1px solid #48515e; border-radius: 5px; box-shadow: 0 5px 16px rgba(0, 0, 0, 0.55); }
  .palette .color-swatch { width: 24px; height: 24px; padding: 0; background: var(--swatch-color); border: 2px solid transparent; border-radius: 3px; }
  .palette .color-swatch:hover:not(:disabled) { background: var(--swatch-color); border-color: #cbd5e1; }
  .palette .color-swatch.active { border-color: #fff; box-shadow: 0 0 0 1px #111; }
  .name { flex: 1; text-align: left; overflow: hidden; text-overflow: ellipsis; border: 0; background: transparent; }
  .name:hover:not(:disabled) { background: rgba(255, 255, 255, 0.5); }
  .visibility { width: 27px; height: 25px; flex: 0 0 27px; display: grid; place-items: center; padding: 0; border: 0; background: transparent; color: #cbd5e1; }
  .visibility:hover:not(:disabled) { background: rgba(255, 255, 255, 0.1); color: #fff; }
  .visibility.off { opacity: 0.42; }
  .hidden-block .name, .hidden-block .color { opacity: 0.45; }
  .list { display: flex; flex-direction: column; gap: 3px; }
  .edit, .joints { display: flex; flex-direction: column; gap: 8px; padding-top: 10px; border-top: 1px solid #0f3460; }
  .edit strong, .joints strong { color: #4ecdc4; }
  p { margin: 0; line-height: 1.5; }
  form { display: flex; gap: 6px; flex-wrap: wrap; } form input { width: 100%; min-width: 0; padding: 6px; }
  .ctx-backdrop { position: fixed; inset: 0; z-index: 10000; }
  .ctx-menu { position: fixed; z-index: 10001; background: #16213e; border: 1px solid #0f3460; border-radius: 6px; padding: 0.3rem; min-width: 160px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5); }
  .ctx-item { display: block; width: 100%; padding: 0.4rem 0.55rem; background: transparent; border: 1px solid transparent; border-radius: 4px; color: #ccc; font-size: 0.8rem; text-align: left; cursor: pointer; }
  .ctx-item:hover:not(:disabled) { background: #0f3460; border-color: #1a4a7a; color: #eee; }
  .ctx-item:disabled { color: #888; cursor: default; }
  .ctx-item.ctx-danger { color: #e94560; }
  .ctx-item.ctx-danger:hover { background: #2a2a4e; border-color: #e94560; color: #ff6b6b; }
  .ctx-divider { height: 1px; background: #0f3460; margin: 0.25rem 0; }
  .rename-overlay { position: fixed; inset: 0; z-index: 10002; background: rgba(0, 0, 0, 0.5); display: flex; align-items: center; justify-content: center; }
  .rename-modal { background: #242b35; color: #eef2f8; border: 1px solid #48515e; border-radius: 6px; padding: 16px; width: 280px; display: flex; flex-direction: column; gap: 12px; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5); }
  .rename-header { display: flex; justify-content: space-between; align-items: center; font-size: 13px; }
  .close-btn { background: none; border: none; color: #8fa0b5; cursor: pointer; padding: 2px 6px; }
  .rename-modal form { display: flex; flex-direction: column; gap: 10px; }
  .rename-modal input { width: 100%; padding: 7px 9px; background: #171b21; border: 1px solid #48515e; border-radius: 4px; color: #fff; font-size: 13px; box-sizing: border-box; }
  .modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
  .btn-primary { background: #27628d; border: 1px solid #3c7fad; color: #fff; }
  .btn-secondary { background: #303640; border: 1px solid #48515e; color: #ccc; }
</style>
