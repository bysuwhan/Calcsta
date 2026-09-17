import { beforeEach, describe, expect, it } from 'vitest';
import { modelStore } from '../model.svelte';
import { historyStore } from '../history.svelte';
import { blockUI } from '../blocks.svelte';
import { uiStore } from '../ui.svelte';
import { BLOCK_COLOR_PALETTE, closedElementLoops, localToWorld, worldToLocal } from '../../model/blocks';
import { validateBlocks } from '../../model/block-validation';
import { constraintsTo2D } from '../../engine/constraint-2d-remap';
import { deserializeProject, serializeProject, validateDedalFile } from '../file';

function part() {
  const a = modelStore.addNode(0, 0), b = modelStore.addNode(2, 0);
  const e = modelStore.addElement(a, b);
  const id = modelStore.createBlock([e], [], { x: 0, y: 0 }, '암');
  return { a, b, e, id };
}
beforeEach(() => { blockUI.cancel(); modelStore.clear(); historyStore.clear(); blockUI.select(null); });

describe('부품 블록', () => {
  it('finds only genuinely closed element loops for block fills', () => {
    expect(closedElementLoops([
      { nodeI: 1, nodeJ: 2 }, { nodeI: 2, nodeJ: 3 }, { nodeI: 3, nodeJ: 1 },
      { nodeI: 10, nodeJ: 11 }, { nodeI: 11, nodeJ: 12 },
    ])).toEqual([[1, 2, 3]]);
    expect(closedElementLoops([
      { nodeI: 1, nodeJ: 2 }, { nodeI: 2, nodeJ: 3 }, { nodeI: 3, nodeJ: 1 }, { nodeI: 2, nodeJ: 4 },
    ])).toEqual([]);
  });

  it('picks a closed block by its filled interior', () => {
    const a = modelStore.addNode(0, 0), b = modelStore.addNode(4, 0), c = modelStore.addNode(0, 4);
    const id = modelStore.createBlock([
      modelStore.addElement(a, b), modelStore.addElement(b, c), modelStore.addElement(c, a),
    ], [], { x: 0, y: 0 }, '삼각형');
    uiStore.zoom = 100;
    expect(blockUI.instanceAt({ x: 1, y: 1 })).toBe(id);
    expect(blockUI.instanceAt({ x: 3.5, y: 3.5 })).toBeNull();
  });

  it('assigns unused palette colors to new and duplicated blocks before reusing one', () => {
    const { id } = part();
    expect(modelStore.blocks.instances[0].color).toBe(BLOCK_COLOR_PALETTE[0]);
    const a = modelStore.addNode(4, 0), b = modelStore.addNode(6, 0);
    modelStore.createBlock([modelStore.addElement(a, b)], [], { x: 4, y: 0 }, '두 번째');
    expect(modelStore.blocks.instances[1].color).toBe(BLOCK_COLOR_PALETTE[1]);
    for (let i = 2; i < BLOCK_COLOR_PALETTE.length; i++) modelStore.duplicateBlock(id);
    expect(modelStore.blocks.instances.map(block => block.color)).toEqual([...BLOCK_COLOR_PALETTE]);
    const overflow = modelStore.duplicateBlock(id)!;
    expect(modelStore.blocks.instances.find(block => block.id === overflow)?.color).toBe(BLOCK_COLOR_PALETTE[0]);
  });

  it('inverts local coordinates through arbitrary poses', () => {
    const pose = { x: 8, y: -3, angle: 1.234 }, p = { x: -2, y: 7 };
    const back = worldToLocal(localToWorld(p, pose), pose);
    expect(back.x).toBeCloseTo(p.x, 12); expect(back.y).toBeCloseTo(p.y, 12);
  });
  it('creates a block immediately with the model origin as its base point', () => {
    const a = modelStore.addNode(4, 3), b = modelStore.addNode(6, 3);
    const element = modelStore.addElement(a, b);
    uiStore.selectElement(element);

    blockUI.begin('create');

    expect(blockUI.command).toBeNull();
    expect(modelStore.blocks.instances).toHaveLength(1);
    expect(modelStore.blocks.instances[0]).toMatchObject({ x: 0, y: 0, angle: 0 });
    expect(modelStore.blocks.definitions[0].nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: a, x: 4, y: 3 }),
      expect.objectContaining({ id: b, x: 6, y: 3 }),
    ]));
  });
  it('shares geometry, preserves stable IDs, and can make a copy independent', () => {
    const { id, b } = part(), copy = modelStore.duplicateBlock(id)!;
    const copyNode = modelStore.blocks.instances.find(i => i.id === copy)!.nodeIds[b];
    modelStore.beginBlockEdit(id); modelStore.updateNode(b, 4, 1); modelStore.finishBlockEdit(true);
    expect(modelStore.getNode(copyNode)).toMatchObject({ x: 4, y: 1 });
    modelStore.makeBlockIndependent(copy);
    modelStore.beginBlockEdit(id); modelStore.updateNode(b, 6, 0); modelStore.finishBlockEdit(true);
    expect(modelStore.getNode(copyNode)).toMatchObject({ x: 4, y: 1 });
    expect(validateBlocks(modelStore.snapshot())).toBe(true);
  });
  it('adds and deletes shared topology and cancels a whole editing session', () => {
    const { id, b } = part(), copy = modelStore.duplicateBlock(id)!;
    const original = modelStore.snapshot();
    modelStore.beginBlockEdit(id); const n = modelStore.addNode(2, 3); modelStore.addElement(b, n);
    modelStore.finishBlockEdit(false);
    expect(modelStore.snapshot()).toEqual(original);
    modelStore.beginBlockEdit(id); const added = modelStore.addNode(3, 2); modelStore.addElement(b, added); modelStore.finishBlockEdit(true);
    expect(Object.keys(modelStore.blocks.instances.find(i => i.id === copy)!.nodeIds)).toHaveLength(3);
    modelStore.beginBlockEdit(id); modelStore.removeNode(added); modelStore.finishBlockEdit(true);
    expect(Object.keys(modelStore.blocks.instances.find(i => i.id === copy)!.nodeIds)).toHaveLength(2);
  });
  it('attaches loads/supports from base only and does not duplicate them', () => {
    const { id, a, b } = part();
    const support = modelStore.addSupport(a, 'fixed'), load = modelStore.addNodalLoad(b, 0, -10);
    modelStore.duplicateBlock(id);
    expect(modelStore.supports.size).toBe(1); expect(modelStore.loads).toHaveLength(1);
    modelStore.placeBlock(id, { x: 3, y: 4, angle: Math.PI / 2 });
    expect(modelStore.supports.get(support)?.nodeId).toBe(a);
    expect(modelStore.getNode(b)?.x).toBeCloseTo(3); expect(modelStore.getNode(b)?.y).toBeCloseTo(6);
    expect(modelStore.loads[0].data.id).toBe(load);
    modelStore.beginBlockEdit(id);
    expect(modelStore.addSupport(b, 'pinned')).toBe(-1); expect(modelStore.addNodalLoad(b, 1, 1)).toBe(-1);
    modelStore.finishBlockEdit(false);
  });
  it('filters hidden geometry, attachments, and joints without losing saved data', () => {
    const { id, a, b } = part(), target = modelStore.addNode(5, 0);
    modelStore.addSupport(a, 'fixed'); modelStore.addNodalLoad(b, 0, -1);
    modelStore.placeBlock(id, { x: 3, y: 0, angle: 0 }, { source: b, target });
    expect(modelStore.constraints).toHaveLength(1);
    modelStore.setBlockVisible(id, false);
    expect(modelStore.nodes.has(a)).toBe(false); expect(modelStore.elements.size).toBe(0);
    expect(modelStore.loads).toHaveLength(0); expect(modelStore.supports.size).toBe(0); expect(modelStore.constraints).toHaveLength(0);
    expect(modelStore.snapshot().loads).toHaveLength(1);
    modelStore.setBlockVisible(id, true); expect(modelStore.constraints).toHaveLength(1); expect(modelStore.loads).toHaveLength(1);
  });
  it('pins only translations and detaches on placement, not on preview', () => {
    const { id, b } = part(), target = modelStore.addNode(5, 0);
    modelStore.placeBlock(id, { x: 3, y: 0, angle: 0 }, { source: b, target });
    expect(constraintsTo2D(modelStore.constraints)[0]).toMatchObject({ type: 'equalDOF', dofs: [0, 1] });
    modelStore.previewBlock(id, { x: 9, y: 0, angle: 0 });
    expect(modelStore.getNode(b)?.x).toBe(11); expect(modelStore.model.nodes.get(b)?.x).toBe(5);
    expect(modelStore.constraints).toHaveLength(1);
    modelStore.previewBlock(id, null); expect(modelStore.getNode(b)?.x).toBe(5);
    modelStore.placeBlock(id, { x: 4, y: 0, angle: 0 }); expect(modelStore.constraints).toHaveLength(0);
  });
  it('preserves original boundary continuity when grouping', () => {
    const a = modelStore.addNode(0, 0), b = modelStore.addNode(2, 0), c = modelStore.addNode(4, 0);
    const first = modelStore.addElement(a, b); modelStore.addElement(b, c);
    const id = modelStore.createBlock([first], [], { x: 0, y: 0 }, '왼쪽');
    expect(modelStore.blocks.instances.find(i => i.id === id)!.nodeIds[b]).not.toBe(b);
    expect(constraintsTo2D(modelStore.constraints)[0]).toMatchObject({ dofs: [0, 1, 2] });
  });
  it('removes invalid pins and deleted-node attachments on shared edit', () => {
    const { id, b } = part(), target = modelStore.addNode(2, 0);
    modelStore.placeBlock(id, { x: 0, y: 0, angle: 0 }, { source: b, target });
    modelStore.addNodalLoad(b, 0, -1); modelStore.addSupport(b, 'pinned');
    modelStore.beginBlockEdit(id); modelStore.removeNode(b);
    const removed = modelStore.finishBlockEdit(true)!;
    expect(removed.joints).toBe(1); expect(modelStore.loads).toHaveLength(0); expect(modelStore.supports.size).toBe(0);
    historyStore.undo(); expect(modelStore.loads).toHaveLength(1); expect(modelStore.constraints).toHaveLength(1);
  });
  it('records one undo step per edit and keeps appearance analysis-neutral', () => {
    const { id, b } = part(); historyStore.clear(); const version = modelStore.modelVersion;
    modelStore.setBlockAppearance(id, { color: BLOCK_COLOR_PALETTE[2] }); expect(modelStore.modelVersion).toBe(version);
    historyStore.undo(); expect(modelStore.modelVersion).toBe(version);
    historyStore.clear(); modelStore.beginBlockEdit(id); modelStore.updateNode(b, 3, 0); modelStore.updateNode(b, 4, 0); modelStore.finishBlockEdit(true);
    expect(historyStore.undoCount).toBe(1); historyStore.undo(); expect(modelStore.getNode(b)?.x).toBe(2);
    historyStore.redo(); expect(modelStore.getNode(b)?.x).toBe(4);
  });
  it('round-trips new project data and rejects old versions and invalid references', () => {
    const { id } = part(); modelStore.duplicateBlock(id); modelStore.setBlockVisible(id, false);
    const json = serializeProject(); expect(deserializeProject(json)).toBe(true);
    expect(modelStore.blocks.instances).toHaveLength(2); expect(modelStore.blocks.instances[0].visible).toBe(false);
    const data = JSON.parse(json); data.version = '2.0'; expect(deserializeProject(JSON.stringify(data))).toBe(false);
    data.version = '3.0'; data.snapshot.blocks.instances[0].definitionId = 999; expect(validateDedalFile(data)).toBe(false);
  });
  it('follows the move/rotate click protocol and cancels preview', () => {
    const { id, b } = part(); uiStore.zoom = 100; uiStore.snapToGrid = false;
    blockUI.begin('move'); blockUI.click({ x: 1, y: 0 }); blockUI.click({ x: 2, y: 0 });
    blockUI.preview({ x: 4, y: 2 }); expect(modelStore.getNode(b)).toMatchObject({ x: 4, y: 2 });
    blockUI.cancel(); expect(modelStore.getNode(b)).toMatchObject({ x: 2, y: 0 });
    blockUI.begin('rotate', id); blockUI.click({ x: 0, y: 0 }); blockUI.click({ x: 2, y: 0 }); blockUI.click({ x: 0, y: 2 });
    expect(modelStore.getNode(b)?.x).toBeCloseTo(0); expect(modelStore.getNode(b)?.y).toBeCloseTo(2);
  });
  it('moves a whole block so an edited block-node coordinate reaches the requested point', () => {
    const { id, b } = part();

    expect(blockUI.moveNodeTo(b, { x: 7, y: 4 })).toBe(true);

    expect(modelStore.blocks.instances.find(block => block.id === id)).toMatchObject({ x: 5, y: 4 });
    expect(modelStore.getNode(b)).toMatchObject({ x: 7, y: 4 });
  });
  it('moves the end nodes of selected base elements with a CAD-style base and destination', () => {
    const a = modelStore.addNode(0, 0), b = modelStore.addNode(2, 0);
    const element = modelStore.addElement(a, b);
    uiStore.zoom = 100; uiStore.snapToGrid = false;
    uiStore.selectElement(element);

    blockUI.begin('move');
    expect(blockUI.command?.target).toBe('entities');
    blockUI.click({ x: 0, y: 0 });
    blockUI.preview({ x: 3, y: 2 });
    expect(modelStore.getNode(a)).toMatchObject({ x: 3, y: 2 });
    expect(modelStore.getNode(b)).toMatchObject({ x: 5, y: 2 });
    blockUI.click({ x: 3, y: 2 });

    expect(modelStore.getNode(a)).toMatchObject({ x: 3, y: 2 });
    expect(modelStore.getNode(b)).toMatchObject({ x: 5, y: 2 });
    expect(historyStore.undoCount).toBeGreaterThan(0);
    historyStore.undo();
    expect(modelStore.getNode(a)).toMatchObject({ x: 0, y: 0 });
    expect(modelStore.getNode(b)).toMatchObject({ x: 2, y: 0 });
  });
  it('rotates selected nodes around the chosen center', () => {
    const a = modelStore.addNode(0, 0), b = modelStore.addNode(2, 0);
    uiStore.zoom = 100; uiStore.snapToGrid = false;
    uiStore.selectNode(a);
    uiStore.selectNode(b, true);

    blockUI.begin('rotate');
    expect(blockUI.command?.target).toBe('entities');
    blockUI.click({ x: 0, y: 0 });
    blockUI.click({ x: 2, y: 0 });
    blockUI.click({ x: 0, y: 2 });

    expect(modelStore.getNode(a)?.x).toBeCloseTo(0);
    expect(modelStore.getNode(a)?.y).toBeCloseTo(0);
    expect(modelStore.getNode(b)?.x).toBeCloseTo(0);
    expect(modelStore.getNode(b)?.y).toBeCloseTo(2);
  });
  it('selects a base node after Move is armed, then moves it', () => {
    const node = modelStore.addNode(1, 1);
    uiStore.zoom = 100; uiStore.snapToGrid = false;

    blockUI.begin('move');
    expect(blockUI.command?.step).toBe('select');
    blockUI.click({ x: 1, y: 1 });
    expect(uiStore.selectedNodes.has(node)).toBe(true);
    expect(blockUI.command).toMatchObject({ step: 'base', target: 'entities' });
    blockUI.click({ x: 1, y: 1 });
    blockUI.click({ x: 4, y: 3 });

    expect(modelStore.getNode(node)).toMatchObject({ x: 4, y: 3 });
  });
  it('selects a base element after Rotate is armed, then rotates its end nodes', () => {
    const a = modelStore.addNode(0, 0), b = modelStore.addNode(2, 0);
    const element = modelStore.addElement(a, b);
    uiStore.zoom = 100; uiStore.snapToGrid = false;

    blockUI.begin('rotate');
    blockUI.click({ x: 1, y: 0 });
    expect(uiStore.selectedElements.has(element)).toBe(true);
    expect(blockUI.command).toMatchObject({ step: 'base', target: 'entities' });
    blockUI.click({ x: 0, y: 0 });
    blockUI.click({ x: 2, y: 0 });
    blockUI.click({ x: 0, y: 2 });

    expect(modelStore.getNode(b)?.x).toBeCloseTo(0);
    expect(modelStore.getNode(b)?.y).toBeCloseTo(2);
  });
  it('skips block selection step if a block or entity is already selected', () => {
    const { id, e, a } = part();
    // 1. When block is explicitly selected
    blockUI.select(id);
    blockUI.begin('move');
    expect(blockUI.command?.step).toBe('base');
    expect(blockUI.command?.id).toBe(id);
    blockUI.cancel();

    // 2. When an element belonging to a block is selected
    blockUI.select(null);
    uiStore.selectElement(e);
    blockUI.begin('rotate');
    expect(blockUI.command?.step).toBe('base');
    expect(blockUI.command?.id).toBe(id);
    blockUI.cancel();

    // 3. When a node belonging to a block is selected
    uiStore.clearSelection();
    uiStore.selectNode(a);
    blockUI.begin('move');
    expect(blockUI.command?.step).toBe('base');
    expect(blockUI.command?.id).toBe(id);
    blockUI.cancel();

    // 4. When nothing is selected, requires selection step
    uiStore.clearSelection();
    blockUI.select(null);
    blockUI.begin('move');
    expect(blockUI.command?.step).toBe('select');
    blockUI.cancel();
  });

  it('allows connecting base elements to block nodes', () => {
    const { id, b } = part();
    // In base workspace (editingBlockId === null)
    expect(modelStore.editingBlockId).toBeNull();

    // Create a base node
    const baseNode = modelStore.addNode(5, 0);

    // Connect block node b and base node
    const connElem = modelStore.addElement(b, baseNode);
    expect(connElem).toBeGreaterThan(0);
    expect(modelStore.elements.has(connElem)).toBe(true);
    expect(modelStore.elements.get(connElem)).toMatchObject({
      nodeI: b,
      nodeJ: baseNode,
    });

    // The created element belongs to base, not the block instance
    const blockInst = modelStore.blocks.instances.find(i => i.id === id)!;
    expect(Object.values(blockInst.elementIds)).not.toContain(connElem);

    // Moving the block preserves the connection to the block node
    modelStore.placeBlock(id, { x: 0, y: 5, angle: 0 });
    const movedB = modelStore.getNode(b);
    expect(movedB?.y).toBeCloseTo(5);
    const elemAfter = modelStore.elements.get(connElem);
    expect(elemAfter?.nodeI).toBe(b);

    // In block edit mode, connecting to external base node is rejected
    modelStore.beginBlockEdit(id);
    const invalidElem = modelStore.addElement(b, baseNode);
    expect(invalidElem).toBe(-1);
    modelStore.finishBlockEdit(false);
  });
});

