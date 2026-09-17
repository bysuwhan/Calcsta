<script lang="ts">
  import { blockUI } from './lib/store/blocks.svelte';
  import { onMount, untrack } from 'svelte';
  import Viewport from './components/Viewport.svelte';
  import BlockPanel from './components/BlockPanel.svelte';
  import StatusBar from './components/StatusBar.svelte';
  import NodeEditor from './components/NodeEditor.svelte';
  import ElementEditor from './components/ElementEditor.svelte';
  import DespieceInspector from './components/DespieceInspector.svelte';
  import MaterialEditor from './components/MaterialEditor.svelte';
  import SectionEditor from './components/SectionEditor.svelte';
  import { modelStore, uiStore, resultsStore, dsmStepsStore, tabManager, historyStore } from './lib/store';
  import { syncModelTabWithResults } from './lib/store/view-mode';
  import { t, i18n, setLocale } from './lib/i18n';
  import { OFFERED_LOCALES } from './lib/i18n/store.svelte';
  import { resolveDeleteTargets } from './lib/store/delete-selection';
  import { loadAutosave, clearAutosave, loadWorkspaceFromLocalStorage, saveWorkspaceToLocalStorage, downloadCanvasPNG, type DedalFile } from './lib/store/file';
  import { requestAutosave } from './lib/store/autosave-service';
  import { loadFromURLHash } from './lib/utils/url-sharing';
  import { fromDisplay } from './lib/utils/units';
  import DxfImportDialog from './components/DxfImportDialog.svelte';
  import Ribbon from './components/ribbon/Ribbon.svelte';
  import BasicPanel from './components/ribbon/BasicPanel.svelte';
  import ToolOptionsBar from './components/ribbon/ToolOptionsBar.svelte';
  import StressPickHint from './components/stress/StressPickHint.svelte';
  import ColourScaleLegend from './components/ColourScaleLegend.svelte';
  import SelectionFilterBar from './components/SelectionFilterBar.svelte';
  import TabBar from './components/TabBar.svelte';
  import KeyboardShortcuts from './components/KeyboardShortcuts.svelte';
  import Icon from './components/ribbon/Icon.svelte';
  import TourOverlay from './components/TourOverlay.svelte';
  import HelpOverlay from './components/HelpOverlay.svelte';
  import ContextMenu from './components/ContextMenu.svelte';
  import { startDemo, DEFAULT_DEMO } from './lib/tour/demos';
  import { runLiveCalc, runGlobalSolve } from './lib/engine/live-calc';

  let basicPanel = $state<string | null>(null);
  let basicDataTab = $state('nodes');
  let showDxfImport = $state(false);
  let dxfImportFile = $state<File | null>(null);
  let dxfFileInput: HTMLInputElement;
  let showImportDialog = $state(false);
  let importText = $state('');
  let autosaveData = $state<DedalFile | null>(null);
  let autosaveDismissed = $state(false);
  let autosaveInterval: ReturnType<typeof setInterval> | null = null;

  $effect(() => { syncModelTabWithResults(basicPanel, basicDataTab); });
  $effect(() => { if (dsmStepsStore.isOpen) basicPanel = 'data'; });

  function openBasicPanel(panel: string | null, opts: { toggle?: boolean; dataTab?: string } = {}) {
    if (opts.dataTab) basicDataTab = opts.dataTab;
    if (panel === null) { basicPanel = null; return; }
    basicPanel = opts.toggle === false || basicPanel !== panel ? panel : null;
  }
  function closeBasicPanel() {
    basicPanel = null;
    if (uiStore.selectMode === 'stress') { uiStore.selectMode = 'elements'; resultsStore.stressQuery = null; }
  }
  function slugifyTabName(name: string) {
    return (name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'new-structure';
  }
  function canonicalizeRoute() {
    if (typeof window === 'undefined') return;
    const url = new URL(location.href);
    if (url.pathname === '/' || url.pathname === '/app' || url.pathname === '/app/' || url.pathname === '/app/pro' || url.pathname === '/app/pro/') {
      url.pathname = '/app/basic';
      history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    }
  }
  function replaceAppUrl(tabName?: string) {
    if (typeof window === 'undefined') return;
    const url = new URL(location.href); url.pathname = '/app/basic';
    if (tabName) url.searchParams.set('tab', slugifyTabName(tabName)); else url.searchParams.delete('tab');
    history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }
  function findTabBySlug(slug: string | null) { return slug ? tabManager.tabs.find(tab => slugifyTabName(tab.name) === slug) ?? null : null; }
  function syncRouteState() { canonicalizeRoute(); uiStore.analysisMode = '2d'; }

  function openInspectFromUrl(params: URLSearchParams) {
    const elementId = Number(params.get('inspect')); if (!Number.isInteger(elementId)) return;
    const requested = Number(params.get('t') ?? '0.5'); const tValue = Number.isFinite(requested) ? Math.min(1, Math.max(0, requested)) : 0.5;
    let tries = 0;
    const open = () => {
      const element = modelStore.elements.get(elementId);
      if (element && resultsStore.results) {
        const a = modelStore.nodes.get(element.nodeI), b = modelStore.nodes.get(element.nodeJ); if (!a || !b) return;
        resultsStore.stressQuery = { elementId, t: tValue, worldX: a.x + (b.x - a.x) * tValue, worldY: a.y + (b.y - a.y) * tValue };
        openBasicPanel('advanced', { toggle: false }); return;
      }
      if (tries++ < 60) setTimeout(open, 120);
    }; open();
  }
  function openKinematicFromUrl(params: URLSearchParams) { if (params.get('kin') === '1') { uiStore.showKinematicPanel = true; openBasicPanel('advanced', { toggle: false }); } }

  function restoreAutosave() {
    if (autosaveData) { modelStore.restore(autosaveData.snapshot); modelStore.model.name = autosaveData.name; resultsStore.clear(); uiStore.analysisMode = '2d'; replaceAppUrl(modelStore.model.name); }
    autosaveDismissed = true;
  }
  function discardAutosave() { void clearAutosave(); autosaveDismissed = true; }
  const showAutosaveBanner = $derived(!!autosaveData && !autosaveDismissed && (modelStore.nodes.size === 0 || modelStore.model.name === autosaveData?.name));

  function handleImportCoordinates() {
    const lines = importText.trim().split('\n').filter(l => l.trim()); let created = 0;
    for (const line of lines) { const parts = line.trim().split(/[,;\t\s]+/).map(Number); if (parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) { modelStore.addNode(fromDisplay(parts[0], 'length', uiStore.unitSystem), fromDisplay(parts[1], 'length', uiStore.unitSystem)); created++; } }
    uiStore.toast(created ? t('app.nodesImported').replace('{n}', String(created)) : t('app.noValidCoords'), created ? 'success' : 'error'); if (created) resultsStore.clear(); showImportDialog = false; importText = '';
  }
  function handleKeydown(e: KeyboardEvent) {
    if (e.defaultPrevented) return;
    const target = e.target as HTMLElement;
    if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName) && !target?.isContentEditable) {
      if (blockUI.command) { if (e.key === 'Escape') blockUI.cancel(); e.preventDefault(); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && blockUI.selected !== null && modelStore.editingBlockId === null) {
        modelStore.deleteBlock(blockUI.selected); blockUI.select(null); e.preventDefault(); return;
      }
    }
    const tag = (e.target as HTMLElement)?.tagName; if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const key = e.key.toUpperCase();
    if ((e.ctrlKey || e.metaKey) && key === 'Z' && !e.shiftKey) { e.preventDefault(); historyStore.undo(); return; }
    if ((e.ctrlKey || e.metaKey) && (key === 'Y' || (key === 'Z' && e.shiftKey))) { e.preventDefault(); historyStore.redo(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (uiStore.selectedDimensionId !== null) {
        modelStore.removeDimension(uiStore.selectedDimensionId); uiStore.clearSelectedDimension(); resultsStore.clear(); e.preventDefault(); return;
      }
      const targets = resolveDeleteTargets({ nodes: uiStore.selectedNodes, elements: uiStore.selectedElements, shells: new Set() }, id => modelStore.elements.has(id));
      if (targets.nodes.length || targets.elements.length) { modelStore.deleteEntities(targets); uiStore.clearSelection(); resultsStore.clear(); }
    }
  }
  function handleExportPNG() { const canvas = document.querySelector('.viewport-container canvas') as HTMLCanvasElement | null; if (canvas) downloadCanvasPNG(canvas); }
  function handleOpenPanelEvent(e: Event) { const panel = (e as CustomEvent<string>).detail; if (typeof panel === 'string') openBasicPanel(panel, { toggle: false }); }

  onMount(() => {
    canonicalizeRoute(); uiStore.analysisMode = '2d';
    import('./lib/engine/wasm-solver').then(m => m.initSolver()).then(() => modelStore.refreshCanonicalSections()).catch(() => console.warn('WASM solver unavailable, using JS fallback'));
    tabManager.init(); const onPopState = () => syncRouteState(); window.addEventListener('popstate', onPopState);
    if (location.pathname === '/demo' || location.pathname === '/demo/') { history.replaceState(null, '', '/app/basic'); setTimeout(() => startDemo(DEFAULT_DEMO), 600); }
    const hashMode = loadFromURLHash(); const params = new URLSearchParams(location.search); if (hashMode === 'embed' || params.has('embed')) uiStore.embedMode = true;
    const exampleId = params.get('example'); if (exampleId) setTimeout(() => modelStore.loadExample(exampleId).then(() => { resultsStore.clear(); window.dispatchEvent(new Event('stabileo-solve')); openInspectFromUrl(params); openKinematicFromUrl(params); }).catch(err => console.error(`[stabileo] example "${exampleId}" failed to load:`, err)), 80);
    if (!hashMode) { const saved = loadWorkspaceFromLocalStorage(); if (saved?.tabs.length) { tabManager.restoreSession(saved.tabs, saved.activeTabId); const requested = findTabBySlug(params.get('tab')); if (requested && requested.id !== tabManager.activeTabId) tabManager.switchTab(requested.id); replaceAppUrl(modelStore.model.name); autosaveData = null; } else { void loadAutosave().then(result => { if (result.value && result.value.snapshot.nodes.length > 0) autosaveData = result.value; }); } }
    autosaveInterval = setInterval(() => { void requestAutosave('timer'); saveWorkspaceToLocalStorage(); }, 30_000);
    const onDxf = () => dxfFileInput?.click(); const onDxfDrop = (e: Event) => { dxfImportFile = (e as CustomEvent<File>).detail; showDxfImport = true; }; const onImport = () => { showImportDialog = true; }; const onSolve = () => { cancelPendingLiveCalc(); void runGlobalSolve(); };
    window.addEventListener('stabileo-export-png', handleExportPNG); window.addEventListener('stabileo-import-dxf', onDxf); window.addEventListener('stabileo-dxf-drop', onDxfDrop); window.addEventListener('stabileo-import-coords', onImport); window.addEventListener('stabileo-solve', onSolve); window.addEventListener('stabileo-open-panel', handleOpenPanelEvent);
    return () => { saveWorkspaceToLocalStorage(); if (autosaveInterval) clearInterval(autosaveInterval); window.removeEventListener('popstate', onPopState); window.removeEventListener('stabileo-export-png', handleExportPNG); window.removeEventListener('stabileo-import-dxf', onDxf); window.removeEventListener('stabileo-dxf-drop', onDxfDrop); window.removeEventListener('stabileo-import-coords', onImport); window.removeEventListener('stabileo-solve', onSolve); window.removeEventListener('stabileo-open-panel', handleOpenPanelEvent); };
  });

  $effect(() => { if (typeof window !== 'undefined') replaceAppUrl(modelStore.model.name); });
  let prevModelVersion = -1; let liveCalcTimer: ReturnType<typeof setTimeout> | null = null;
  function cancelPendingLiveCalc() { if (liveCalcTimer) { clearTimeout(liveCalcTimer); liveCalcTimer = null; } }
  $effect(() => { const version = modelStore.modelVersion; const live = uiStore.liveCalc; untrack(() => { if (tabManager.isTabSwitching) return; const changed = version !== prevModelVersion; prevModelVersion = version; uiStore.liveCalcError = null; if (changed && resultsStore.results) resultsStore.clear(); if (live) { cancelPendingLiveCalc(); liveCalcTimer = setTimeout(() => { liveCalcTimer = null; void runLiveCalc(resultsStore.diagramType); }, 120); } }); return () => cancelPendingLiveCalc(); });
</script>

<svelte:window onkeydown={handleKeydown} />
<div class="app-container" class:embed-mode={uiStore.embedMode}>
  <header class="app-header" class:has-autosave={showAutosaveBanner}><div class="logo"><button class="logo-home" onclick={() => { history.pushState(null, '', '/app/basic'); syncRouteState(); }} title={t('app.backHome')}><img class="logo-icon" src="/logo.svg" alt="" aria-hidden="true" /><span class="logo-text">Calcsta</span></button><span class="basic-badge">Basic</span></div><span class="separator">|</span><TabBar />{#if showAutosaveBanner}<div class="autosave-inline" data-testid="autosave-prompt"><span>{t('app.autosaveFound')} <strong>{autosaveData?.name}</strong></span><button class="banner-btn restore" onclick={restoreAutosave}>{t('app.restore')}</button><button class="banner-btn discard" onclick={discardAutosave}>{t('app.discard')}</button></div>{/if}<div class="header-actions"><button class="btn btn-help" onclick={() => uiStore.showHelp = true} title={t('app.keyboardShortcuts')}>?</button><select class="lang-select" data-testid="lang-select" aria-label={t('app.language')} value={i18n.locale} onchange={(e) => { setLocale((e.currentTarget as HTMLSelectElement).value); tabManager.updateDefaultNames(); }}>{#each OFFERED_LOCALES as code (code)}<option value={code}>{t(`lang.${code}`)}</option>{/each}</select><button class="btn btn-settings" class:on={basicPanel === 'settings'} onclick={() => openBasicPanel('settings')} title={t('ribbon.settings')} aria-label={t('ribbon.settings')} data-testid="rb-settings"><Icon name="settings" size={16} /></button></div></header>
  <Ribbon onOpenPanel={openBasicPanel} activePanel={basicPanel} activeDataTab={basicDataTab} /><ToolOptionsBar />
  <div class="app-body"><div class="app-body-inner"><BlockPanel /><main class="main-area"><div class="viewport-container"><Viewport /><StressPickHint /><ColourScaleLegend /><KeyboardShortcuts /></div></main>{#if basicPanel}<BasicPanel panel={basicPanel} bind:dataTab={basicDataTab} onClose={closeBasicPanel} />{/if}</div></div>
  <SelectionFilterBar />
  <footer class="app-footer"><StatusBar /></footer>
</div>
<NodeEditor /><ElementEditor /><DespieceInspector /><MaterialEditor /><SectionEditor />
{#if uiStore.toasts.length > 0}<div class="toast-container">{#each uiStore.toasts as toast}<div class="toast toast-{toast.type}"><span>{toast.message}</span><button class="toast-dismiss" onclick={() => uiStore.dismissToast(toast.id)}>&times;</button></div>{/each}</div>{/if}
{#if uiStore.liveCalcError}<div class="live-calc-error"><span>{uiStore.liveCalcError}</span></div>{/if}
<ContextMenu /><HelpOverlay />
<DxfImportDialog open={showDxfImport} file={dxfImportFile} onclose={() => { showDxfImport = false; dxfImportFile = null; }} />
<input bind:this={dxfFileInput} type="file" accept=".dxf" style="display:none" onchange={(e) => { const f = (e.currentTarget as HTMLInputElement).files?.[0]; if (f) { dxfImportFile = f; showDxfImport = true; } (e.currentTarget as HTMLInputElement).value = ''; }} />
{#if showImportDialog}<div class="help-overlay" role="dialog" aria-label={t('app.importCoordinates')}><div class="help-backdrop" onclick={() => showImportDialog = false}></div><div class="help-content"><div class="help-header"><h2>{t('app.importCoordinates')}</h2><button class="help-close" onclick={() => showImportDialog = false}>✕</button></div><p>{t('app.importCoordDesc')}</p><textarea class="import-textarea" placeholder="0, 0&#10;5, 0&#10;10, 0&#10;5, 3" bind:value={importText} rows="10"></textarea><div class="dialog-actions"><button class="btn btn-primary" onclick={handleImportCoordinates}>{t('app.import')}</button><button class="btn btn-secondary" onclick={() => showImportDialog = false}>{t('app.cancel')}</button></div></div></div>{/if}
<TourOverlay />
<style>
  .toast { --st-surface-2: #3b5268; color: #ffffff; }
  .app-container{width:100%;height:100%;display:flex;flex-direction:column;background:var(--st-bg,#0c1620);color:var(--st-text,#e8eef2)} .app-header{height:3.25rem;display:flex;align-items:center;gap:.75rem;padding:0 .8rem;border-bottom:1px solid var(--st-hair,#263746);background:var(--st-surface-1,#132331);flex-shrink:0}.logo{display:flex;align-items:center;gap:.6rem}.logo-home{display:flex;align-items:center;gap:.45rem;border:0;background:none;color:inherit;cursor:pointer}.logo-icon{width:1.45rem;height:1.45rem;display:block}.logo-text{font-weight:700}.basic-badge{font-size:.8rem;font-weight:600;color:var(--st-muted,#98a8b5);border:1px solid var(--st-hair,#263746);border-radius:999px;padding:.18rem .55rem}.separator{color:var(--st-muted,#98a8b5)} .header-actions{margin-left:auto;display:flex;align-items:center;gap:.45rem}.btn{border:1px solid var(--st-hair,#263746);background:var(--st-surface-2,#1a2c3b);color:inherit;border-radius:.35rem;padding:.35rem .55rem;cursor:pointer}.btn-settings.on{color:var(--st-interactive,#4ecdc4)}.lang-select{background:var(--st-surface-2,#1a2c3b);color:inherit;border:1px solid var(--st-hair,#263746);border-radius:.3rem;padding:.25rem}.autosave-inline{display:flex;align-items:center;gap:.45rem;font-size:.75rem;margin-left:auto}.banner-btn{border:0;border-radius:.3rem;padding:.3rem .5rem;cursor:pointer}.restore{background:var(--st-interactive,#4ecdc4);color:#062026}.discard{background:transparent;color:var(--st-muted,#98a8b5)} .app-body{flex:1;min-height:0;display:flex}.app-body-inner{display:flex;flex:1;min-width:0;min-height:0}.main-area{display:flex;flex:1;min-width:0;min-height:0}.viewport-container{position:relative;flex:1;min-height:0;overflow:hidden}.app-footer{height:1.9rem;flex-shrink:0}.toast-container{position:fixed;right:1rem;bottom:2.5rem;z-index:60;display:flex;flex-direction:column;gap:.4rem}.toast{padding:.6rem .8rem;border-radius:.35rem;background:var(--st-surface-2,#1a2c3b);box-shadow:0 3px 15px #00000080}.toast-dismiss{margin-left:.5rem;background:none;border:0;color:inherit;cursor:pointer}.live-calc-error{position:fixed;left:50%;bottom:2.8rem;transform:translateX(-50%);z-index:50;background:#6d2932;color:#fff;padding:.5rem .8rem;border-radius:.35rem}.import-textarea{width:100%;background:var(--st-surface-2,#1a2c3b);color:inherit;border:1px solid var(--st-hair,#263746);padding:.5rem}.dialog-actions{display:flex;gap:.5rem;margin-top:.5rem}.help-content{position:relative;z-index:1}
</style>
