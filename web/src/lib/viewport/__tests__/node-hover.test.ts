import { describe, expect, it } from 'vitest';
import { shouldShowNodeHoverHighlight, type NodeHoverHighlightContext } from '../node-hover';

const base: NodeHoverHighlightContext = {
  tool: 'select',
  elementMode: 'create',
  nodeMode: 'create',
  selectMode: 'elements',
  multiKindSelect: false,
  selectsNodes: false,
  interactionActive: false,
};

const show = (overrides: Partial<NodeHoverHighlightContext> = {}) =>
  shouldShowNodeHoverHighlight({ ...base, ...overrides });

describe('2D node hover highlight eligibility', () => {
  it('shows for node creation and existing node-targeting tools', () => {
    expect(show({ tool: 'node', nodeMode: 'create' })).toBe(true);
    expect(show({ tool: 'element', elementMode: 'create' })).toBe(true);
    expect(show({ tool: 'support' })).toBe(true);
    expect(show({ tool: 'load' })).toBe(true);
    expect(show({ tool: 'cylinder' })).toBe(true);
  });

  it('shows in node and default element selection modes', () => {
    expect(show({ selectMode: 'nodes' })).toBe(true);
    expect(show({ selectMode: 'elements' })).toBe(true);
  });

  it('follows the enabled node kind during multi-kind selection', () => {
    expect(show({ multiKindSelect: true, selectsNodes: true })).toBe(true);
    expect(show({ multiKindSelect: true, selectsNodes: false })).toBe(false);
  });

  it('does not claim nodes are selectable in entity-specific modes', () => {
    for (const selectMode of ['supports', 'loads', 'stress', 'shells'] as const) {
      expect(show({ selectMode })).toBe(false);
    }
    expect(show({ selectMode: 'stress', multiKindSelect: true, selectsNodes: true })).toBe(false);
    expect(show({ selectMode: 'shells', multiKindSelect: true, selectsNodes: true })).toBe(false);
  });

  it('leaves hinge and slider modes to their specialized indicators', () => {
    expect(show({ tool: 'node', nodeMode: 'hinge' })).toBe(false);
    expect(show({ tool: 'element', elementMode: 'hinge' })).toBe(false);
  });

  it('hides during pan, box selection, and node dragging', () => {
    expect(show({ interactionActive: true })).toBe(false);
  });
});
