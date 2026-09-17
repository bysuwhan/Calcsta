import type { ElementMode, NodeMode, SelectMode, Tool } from '../store/ui.svelte';

export interface NodeHoverHighlightContext {
  tool: Tool;
  elementMode: ElementMode;
  nodeMode: NodeMode;
  selectMode: SelectMode;
  multiKindSelect: boolean;
  selectsNodes: boolean;
  interactionActive: boolean;
}

/**
 * Whether the current 2D viewport mode can act on a node under the pointer.
 *
 * Hinge/slider modes have their own richer indicators and are deliberately
 * excluded here. `elements` selection is included because a click in that
 * mode gives a nearby node priority over an element.
 */
export function shouldShowNodeHoverHighlight(context: NodeHoverHighlightContext): boolean {
  if (context.interactionActive) return false;

  if (context.tool === 'element') return context.elementMode === 'create';
  if (context.tool === 'node') return context.nodeMode === 'create';
  if (context.tool === 'support' || context.tool === 'load' || context.tool === 'cylinder') return true;
  if (context.tool !== 'select') return false;

  if (context.selectMode === 'stress' || context.selectMode === 'shells') return false;
  if (context.multiKindSelect) return context.selectsNodes;
  return context.selectMode === 'nodes' || context.selectMode === 'elements';
}
