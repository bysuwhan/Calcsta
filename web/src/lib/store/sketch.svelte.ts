import { modelStore } from './model.svelte';
import { uiStore } from './ui.svelte';
import { t } from '../i18n';
import type { SketchReference, SmartDimension } from '../model/sketch-constraints';

let first = $state<SketchReference | null>(null);
let draft = $state<SmartDimension | null>(null);
function cancel() { first = null; draft = null; uiStore.clearSelection(); }

function selectReference(ref: SketchReference, additive: boolean) {
  if (ref.kind === 'node') uiStore.selectNode(ref.id, additive);
  else uiStore.selectElement(ref.id, additive);
}

export const sketchUI = {
  get first() { return first; },
  get draft() { return draft; },
  cancel,
  pick(ref: SketchReference) {
    if (draft) return;
    if (!first) {
      uiStore.clearSelection();
      selectReference(ref, false);
      first = ref;
      return;
    }
    const inferred = modelStore.inferDimension(first, ref);
    if (!inferred) { uiStore.toast(t('sketch.invalidPair'), 'info'); return; }
    selectReference(ref, true);
    draft = inferred;
  },
  place(position: { x: number; y: number }) {
    if (!draft) return false;
    if (!modelStore.addMeasuredDimension(draft, position)) { uiStore.toast(t('sketch.conflict'), 'error'); return false; }
    cancel(); return true;
  },
};
