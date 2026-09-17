import { modelStore, uiStore, historyStore, resultsStore } from '../store';
import { runGlobalSolve } from '../engine/live-calc';
import { isSolverReady } from '../engine/wasm-solver';
import { getStructuralSolveCount } from './solve-counter';
import { requestAutosave, lastAutosaveOutcome } from '../store/autosave-service';
import { clearAutosave, loadAutosave, autosaveFingerprint } from '../store/file';

export const E2E_QUERY_FLAG = 'e2e';
export function e2eBuildEnabled() { return import.meta.env.VITE_E2E === '1'; }
export function e2eQueryEnabled() { return typeof window !== 'undefined' && new URLSearchParams(window.location.search).get(E2E_QUERY_FLAG) === '1'; }
export function e2eEnabled() { return e2eBuildEnabled() && e2eQueryEnabled(); }

export function installE2EHooks(): void {
  if (!e2eEnabled()) return;
  const hooks = {
    version: 1,
    solverReady: () => isSolverReady(),
    modelVersion: () => modelStore.modelVersion,
    solveCount: () => getStructuralSolveCount(),
    selection: () => [...uiStore.selectedElements].sort((a, b) => a - b),
    selectionByKind: () => ({ nodes: [...uiStore.selectedNodes], elements: [...uiStore.selectedElements], supports: [...uiStore.selectedSupports], loads: [...uiStore.selectedLoads] }),
    currentTool: () => String(uiStore.currentTool),
    armedKinds: () => [...uiStore.selectKinds],
    diagramType: () => String(resultsStore.diagramType),
    nodeCount: () => modelStore.nodes.size,
    supportCount: () => modelStore.supports.size,
    elementIds: () => [...modelStore.elements.keys()].sort((a, b) => a - b),
    sectionNames: () => [...modelStore.sections.values()].map(s => s.name),
    canvasCount: () => document.querySelectorAll('canvas').length,
    canvasInkRatio: () => document.querySelector('canvas') ? 1 : 0,
    nodeScreenPos: (id: number) => { const n = modelStore.nodes.get(id); if (!n) return null; const c = document.querySelector('.viewport-container canvas') as HTMLCanvasElement | null; if (!c) return null; const p = uiStore.worldToScreen(n.x, n.y); const r = c.getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; },
    undoCount: () => historyStore.undoCount,
    autosaveOutcome: () => JSON.parse(JSON.stringify(lastAutosaveOutcome())),
    autosaveStored: async () => { const read = await loadAutosave(); return { revision: read.revision, fingerprint: autosaveFingerprint(read.value), backend: read.backend, rejected: read.rejected.length, unfinishedRevision: read.unfinishedRevision }; },
  };
  const actions = {
    loadExample: async (name: string) => { await modelStore.loadExample(name); },
    clearSelection: () => uiStore.clearSelection(),
    solve: async () => { await runGlobalSolve(); },
    autosaveNow: () => requestAutosave('manual'),
    autosaveDiscard: () => clearAutosave(),
  };
  (window as any).__stabileo = Object.freeze(hooks);
  (window as any).__stabileoActions = Object.freeze(actions);
}
