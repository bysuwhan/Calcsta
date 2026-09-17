/**
 * Solving, as an action rather than a component method.
 *
 * `handleSolve` lived inside ToolbarResults, so the only way to solve was to
 * open the results panel and press the button in it. The ribbon's Solve command
 * therefore could not solve — it opened the panel and asked the user to press
 * Solve again, which is two clicks and a detour for the single most-used action
 * in the application.
 *
 * Moving it here gives one implementation with one set of NaN checks and
 * toasts, callable from anywhere.
 */

import { uiStore, resultsStore, modelStore } from '../store';
import { t } from '../i18n';
import { hasInvalid2DDisplacements } from '../geometry/coordinate-system';

export function runSolve() {
  const results = modelStore.solve(uiStore.includeSelfWeight, uiStore.drawPlane2D);
  if (typeof results === 'string') {
    uiStore.toast(results, 'error');
  } else if (results) {
    // Validate results aren't degenerate
    const hasNaN = hasInvalid2DDisplacements(results.displacements);
    if (hasNaN) {
      uiStore.toast(t('results.numericError'), 'error');
      return;
    }
    resultsStore.setResults(results);
    // Show classification in success toast
    const kin = modelStore.kinematicResult;
    let classText = '';
    if (kin) {
      if (kin.classification === 'isostatic') classText = t('toast.isostatic');
      else if (kin.classification === 'hyperstatic') classText = t('toast.hyperstatic').replace('{degree}', String(kin.degree));
    }
    // Auto-solve combinations if they exist
    let comboText = '';
    if (modelStore.model.combinations.length > 0) {
      const comboResult = modelStore.solveCombinations(uiStore.includeSelfWeight, uiStore.drawPlane2D);
      if (comboResult && typeof comboResult !== 'string') {
        resultsStore.setCombinationResults(comboResult.perCase, comboResult.perCombo, comboResult.envelope);
        comboText = t('toast.plusCombinations').replace('{n}', String(comboResult.perCombo.size));
      }
    }
    // Show diagnostics warnings if present
    const diagWarnings = [
      ...(results.diagnostics ?? []).filter(d => d.metric === 'negative_jacobian').map(d => d.message),
      ...(results.solverDiagnostics ?? []).filter(d => d.severity === 'warning').map(d => d.message),
    ];
    if (diagWarnings.length > 0) {
      uiStore.toast(diagWarnings.join(' | '), 'info');
    }
    uiStore.toast(`${t('results.calcSuccess')}${classText} — ${results.elementForces.length} ${t('results.bars')}, ${results.reactions.length} ${t('results.reactions')}${comboText}`, 'success');
  } else {
    uiStore.toast(t('results.emptyModelError'), 'error');
  }
}
