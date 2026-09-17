/**
 * live-calc.ts — Extracted live-calculation logic from App.svelte.
 *
 * Provides two functions:
 *  - runLiveCalc()    — called inside the reactive $effect when liveCalc is ON
 *  - runGlobalSolve() — called from the 'stabileo-solve' global event (manual solve)
 *
 * Both delegate to the planar solver but encapsulate NaN-checking,
 * combination solving, diagram-type restoration and error handling so App.svelte
 * stays thin.
 */

import { modelStore, resultsStore, uiStore } from '../store';
import { requestAutosave } from '../store/autosave-service';
import { t } from '../i18n';
import { computeGoverning2D } from './governing-case';
import { reportSolverDiagnostics } from './solve-diagnostics';
import { hasInvalid2DDisplacements } from '../geometry/coordinate-system';

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatSolveTiming(timings: any): string {
  if (!timings) return '';
  const totalMs =
    typeof timings.totalMs === 'number' ? timings.totalMs :
    typeof timings.total_us === 'number' ? timings.total_us / 1000 :
    typeof timings.totalUs === 'number' ? timings.totalUs / 1000 :
    null;
  if (totalMs == null || !Number.isFinite(totalMs)) return '';
  return totalMs >= 1000
    ? ` (${(totalMs / 1000).toFixed(2)} s)`
    : ` (${totalMs.toFixed(1)} ms)`;
}

const VALID_2D_DIAGRAMS = ['deformed', 'moment', 'shear', 'axial', 'colorMap', 'axialColor'] as const;

// ─── Stale-response discipline ─────────────────────────────────────────────
// Solves are async now: while a solve is in flight the user can keep editing
// (bumping modelStore.modelVersion) or trigger a newer solve. Each solve
// request captures the model version and a monotonically increasing request
// id; results are written to the stores only if both are still current.
let solveRequestSeq = 0;

function nextSolveGuard(): () => boolean {
  const versionAtStart = modelStore.modelVersion;
  const requestId = ++solveRequestSeq;
  return () => modelStore.modelVersion !== versionAtStart || requestId !== solveRequestSeq;
}

// ─── Live Calc (reactive $effect) ─────────────────────────────────────────

/**
 * Execute live calculation (auto-solve on model change).
 * Called from the $effect in App.svelte when liveCalc is enabled.
 * Sets results/errors directly on the stores, unless the solve went stale
 * (model edited or a newer solve started while it was in flight).
 *
 * @param prevDiagram  Diagram type the user was viewing before clear() — restored after solve
 */
export async function runLiveCalc(prevDiagram?: string): Promise<void> {
  // Skip if model is incomplete (e.g., mid-example-load after clear but before fixture applied)
  if (modelStore.nodes.size < 2 || modelStore.elements.size < 1) return;
  const isStale = nextSolveGuard();
  try {
    await liveCalc2D(isStale);
    if (isStale()) return;
    // Restore the diagram type the user was viewing before clear() reset it to 'none'.
    // Only restore if it's a valid diagram for the current mode.
    if (prevDiagram && prevDiagram !== 'none') {
      if (VALID_2D_DIAGRAMS.includes(prevDiagram as typeof VALID_2D_DIAGRAMS[number])) {
        resultsStore.diagramType = prevDiagram as any;
      }
    }
  } catch (err: any) {
    if (!isStale()) uiStore.liveCalcError = err.message ?? t('error.unknown');
  }
}

async function liveCalc2D(isStale: () => boolean): Promise<void> {
  const r = await modelStore.solveAsync(uiStore.includeSelfWeight, uiStore.drawPlane2D);
  if (isStale()) return;
  if (typeof r === 'string') {
    uiStore.liveCalcError = r;
    return;
  }
  if (!r) return;

  if (hasInvalid2DDisplacements(r.displacements as Array<{ ux: number; uz?: number; uy?: number; ry?: number; rz?: number }>)) {
    uiStore.liveCalcError = t('results.numericError');
    return;
  }

  resultsStore.setResults(r, true);

  // Auto-solve combinations if defined (sync single WASM call — the model
  // cannot drift while it runs, so no extra stale check is needed here)
  if (modelStore.model.combinations.length > 0) {
    const combo = modelStore.solveCombinations(uiStore.includeSelfWeight, uiStore.drawPlane2D);
    if (combo && typeof combo !== 'string') {
      resultsStore.setCombinationResults(combo.perCase, combo.perCombo, combo.envelope);
      const comboNames = new Map<number, string>();
      for (const c of modelStore.model.combinations) comboNames.set(c.id, c.name);
      resultsStore.setGoverning2D(computeGoverning2D(combo.perCombo, comboNames));
    }
  }
}

// ─── Global Solve (manual "Calcular" button) ─────────────────────────────

/**
 * Solve the structure manually (triggered by Enter key / Calcular button).
 * Handles the Basic 2D solve, combinations, toasts and mobile panel.
 */
export async function runGlobalSolve(): Promise<void> {
  // Supersede any in-flight solve (live calc or an earlier manual solve).
  const isStale = nextSolveGuard();
  await globalSolve2D(isStale);
  // A solve is minutes of computed state produced by one click. Waiting for the 30 s timer
  // to notice is how a run gets lost to a closed tab.
  void requestAutosave('solve');
}

/** Show solver diagnostic warnings/errors as toasts (max 2 to avoid spam).
 *  Lives in `solve-diagnostics.ts` so solve entry points share the same reporting. */
const showSolverWarningToasts = reportSolverDiagnostics;

/** Detect if an error message is mechanism/hipostatic-related */
function isMechanismError(msg: string): boolean {
  const lc = msg.toLowerCase();
  return lc.includes('mecanismo') || lc.includes('hipostática') || lc.includes('singular') || lc.includes('inestable')
    || lc.includes('mechanism') || lc.includes('hypostatic') || lc.includes('unstable');
}

async function globalSolve2D(isStale: () => boolean): Promise<void> {
  const r = await modelStore.solveAsync(uiStore.includeSelfWeight, uiStore.drawPlane2D);
  if (isStale()) return;
  if (typeof r === 'string') {
    uiStore.toast(r, 'error', isMechanismError(r) ? 'kinematic' : undefined);
    return;
  }
  if (!r) {
    uiStore.toast(t('results.emptyModelError'), 'error');
    return;
  }

  if (hasInvalid2DDisplacements(r.displacements as Array<{ ux: number; uz?: number; uy?: number; ry?: number; rz?: number }>)) {
    uiStore.toast(t('results.numericError'), 'error', 'kinematic');
    return;
  }

  resultsStore.setResults(r);

  const kin = modelStore.kinematicResult;
  let classText = '';
  if (kin) {
    if (kin.classification === 'isostatic') classText = ` — ${t('results.isostatic')}`;
    else if (kin.classification === 'hyperstatic') classText = ` — ${t('results.hyperstatic')} (${t('results.degree')} ${kin.degree})`;
  }

  // Auto-solve combinations if defined
  let comboText = '';
  if (modelStore.model.combinations.length > 0) {
    const comboResult = modelStore.solveCombinations(uiStore.includeSelfWeight, uiStore.drawPlane2D);
    if (comboResult && typeof comboResult !== 'string') {
      resultsStore.setCombinationResults(comboResult.perCase, comboResult.perCombo, comboResult.envelope);
      const comboNames = new Map<number, string>();
      for (const c of modelStore.model.combinations) comboNames.set(c.id, c.name);
      resultsStore.setGoverning2D(computeGoverning2D(comboResult.perCombo, comboNames));
      comboText = ` + ${comboResult.perCombo.size} ${t('results.combinations')}`;
    }
  }

  const timeStr = formatSolveTiming(r.timings);
  uiStore.toast(
    `${t('results.calcSuccess')}${classText}${timeStr} — ${r.elementForces.length} ${t('results.bars')}, ${r.reactions.length} ${t('results.reactions')}${comboText}`,
    'success',
  );

  // Show solver warnings/errors as separate toasts
  showSolverWarningToasts(r.solverDiagnostics);
}
