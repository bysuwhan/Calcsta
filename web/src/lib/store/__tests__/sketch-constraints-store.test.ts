import { beforeEach, describe, expect, it } from 'vitest';
import { modelStore } from '../model.svelte';
import { historyStore } from '../history.svelte';

beforeEach(() => {
  modelStore.clear();
  historyStore.clear();
});

describe('sketch constraint persistence and block scope', () => {
  it('places a measured dimension without changing the existing geometry', () => {
    const a = modelStore.addNode(0, 0);
    const b = modelStore.addNode(3, 4);
    const draft = modelStore.inferDimension({ kind: 'node', id: a }, { kind: 'node', id: b })!;

    expect(modelStore.addMeasuredDimension(draft, { x: 2, y: 6 })).toBe(true);
    expect(modelStore.getNode(a)).toMatchObject({ x: 0, y: 0 });
    expect(modelStore.getNode(b)).toMatchObject({ x: 3, y: 4 });
    expect(modelStore.sketchConstraints[0]).toMatchObject({
      kind: 'dimension', value: 5, position: { x: 2, y: 6 },
    });
  });

  it('moves only the annotation and edits geometry only after an explicit value edit', () => {
    const a = modelStore.addNode(0, 0);
    const b = modelStore.addNode(3, 4);
    const draft = modelStore.inferDimension({ kind: 'node', id: a }, { kind: 'node', id: b })!;
    modelStore.addMeasuredDimension(draft, { x: 2, y: 6 });
    const dimension = modelStore.sketchConstraints[0];

    expect(modelStore.moveDimension(dimension.id, { x: -1, y: 8 })).toBe(true);
    expect(modelStore.getNode(b)).toMatchObject({ x: 3, y: 4 });
    expect(modelStore.editDimension(dimension.id, 10)).toBe(true);
    expect(Math.hypot(modelStore.getNode(b)!.x, modelStore.getNode(b)!.y)).toBeCloseTo(10);
    expect(modelStore.sketchConstraints[0]).toMatchObject({ position: { x: -1, y: 8 } });
  });

  it('turns a dimension into a non-driving read-only measurement', () => {
    const a = modelStore.addNode(0, 0);
    const b = modelStore.addNode(3, 0);
    const draft = modelStore.inferDimension({ kind: 'node', id: a }, { kind: 'node', id: b })!;
    modelStore.addMeasuredDimension(draft, { x: 1.5, y: 1 });
    const id = modelStore.sketchConstraints[0].id;

    expect(modelStore.editDimension(id, 3, true)).toBe(true);
    modelStore.updateNodesConstrained(new Map([[b, { ...modelStore.getNode(b)!, x: 8 }]]));
    expect(modelStore.getNode(b)?.x).toBeCloseTo(8);
    expect(modelStore.sketchConstraints[0]).toMatchObject({ id, readOnly: true });
    expect(modelStore.inferDimension({ kind: 'node', id: a }, { kind: 'node', id: b })?.value).toBeCloseTo(8);
  });

  it('removes a measured dimension by its selection id without changing geometry', () => {
    const a = modelStore.addNode(0, 0);
    const b = modelStore.addNode(3, 4);
    const draft = modelStore.inferDimension({ kind: 'node', id: a }, { kind: 'node', id: b })!;
    modelStore.addMeasuredDimension(draft, { x: 2, y: 6 });
    const id = modelStore.sketchConstraints[0].id;

    expect(modelStore.removeDimension(id)).toBe(true);
    expect(modelStore.sketchConstraints).toEqual([]);
    expect(modelStore.getNode(a)).toMatchObject({ x: 0, y: 0 });
    expect(modelStore.getNode(b)).toMatchObject({ x: 3, y: 4 });
    expect(modelStore.removeDimension(id)).toBe(false);
  });

  it('persists sketch fixation separately from structural supports', () => {
    const n = modelStore.addNode(1, 2);
    expect(modelStore.toggleSketchFixedNode(n)).toBe(true);
    expect(modelStore.supports.size).toBe(0);

    const snapshot = modelStore.snapshot();
    expect(snapshot.sketchConstraints).toEqual([
      expect.objectContaining({ kind: 'fixedNode', nodeId: n, x: 1, y: 2 }),
    ]);
    modelStore.clear();
    modelStore.restore(snapshot);
    expect(modelStore.isNodeSketchFixed(n)).toBe(true);
    expect(modelStore.supports.size).toBe(0);
  });

  it('stores an internal fixation in block-local coordinates without fixing the block pose', () => {
    const a = modelStore.addNode(0, 0);
    const b = modelStore.addNode(4, 0);
    const e = modelStore.addElement(a, b);
    modelStore.toggleSketchFixedElement(e);
    const blockId = modelStore.createBlock([e], [], { x: 0, y: 0 }, 'B');

    expect(modelStore.snapshot().sketchConstraints).toEqual([]);
    expect(modelStore.blocks.definitions[0].sketchConstraints).toHaveLength(1);

    modelStore.placeBlock(blockId, { x: 10, y: 5, angle: Math.PI / 2 });
    const block = modelStore.blocks.instances.find(x => x.id === blockId)!;
    expect(block).toMatchObject({ x: 10, y: 5, angle: Math.PI / 2 });
    const fixed = modelStore.sketchConstraints.find(c => c.kind === 'fixedElement');
    expect(fixed?.kind === 'fixedElement' ? fixed.angle : 0).toBeCloseTo(Math.PI / 2);
  });
});
