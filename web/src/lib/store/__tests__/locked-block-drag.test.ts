import { beforeEach, describe, expect, it } from 'vitest';
import { modelStore } from '../model.svelte';
import { historyStore } from '../history.svelte';
import { deserializeProject, serializeProject, validateDedalFile } from '../file';

function block(x1: number, y1: number, x2: number, y2: number) {
  const a = modelStore.addNode(x1, y1), b = modelStore.addNode(x2, y2);
  const e = modelStore.addElement(a, b);
  const id = modelStore.createBlock([e], [], { x: 0, y: 0 }, `블록 ${a}`);
  return { id, a, b };
}
function lockLastJoint() {
  const id = modelStore.blocks.joints.at(-1)!.id;
  modelStore.setBlockJointLocked(id, true);
  return id;
}
function drag(id: number, source: { x: number; y: number }, target: { x: number; y: number }) {
  const block = modelStore.blocks.instances.find(b => b.id === id)!;
  const pose = { x: block.x + target.x - source.x, y: block.y + target.y - source.y, angle: block.angle };
  modelStore.previewBlock(id, pose, { source, target });
  return pose;
}
beforeEach(() => { modelStore.clear(); historyStore.clear(); });

describe('locked block connections', () => {
  it('rotates around a supported pin and keeps the pin through preview and commit', () => {
    const arm = block(0, 0, 2, 0), base = modelStore.addNode(2, 0);
    modelStore.addSupport(base, 'pinned');
    modelStore.placeBlock(arm.id, { x: 0, y: 0, angle: 0 }, { source: arm.b, target: base });
    const jointId = lockLastJoint();
    historyStore.clear();

    const pose = drag(arm.id, { x: 0, y: 0 }, { x: 2, y: -2 });
    expect(modelStore.getNode(arm.a)?.x).toBeCloseTo(2, 4);
    expect(modelStore.getNode(arm.a)?.y).toBeCloseTo(-2, 4);
    expect(modelStore.getNode(arm.b)?.x).toBeCloseTo(2, 7);
    expect(modelStore.getNode(arm.b)?.y).toBeCloseTo(0, 7);
    expect(modelStore.model.nodes.get(arm.a)?.x).toBe(0);
    modelStore.placeBlock(arm.id, pose, undefined, { source: { x: 0, y: 0 }, target: { x: 2, y: -2 } });
    expect(modelStore.blocks.joints.find(j => j.id === jointId)?.locked).toBe(true);
    expect(modelStore.getNode(arm.b)?.x).toBeCloseTo(modelStore.getNode(base)!.x, 7);
    expect(modelStore.getNode(arm.b)?.y).toBeCloseTo(modelStore.getNode(base)!.y, 7);
    expect(historyStore.undoCount).toBe(1);
    historyStore.undo();
    expect(modelStore.getNode(arm.a)).toMatchObject({ x: 0, y: 0 });
    historyStore.redo();
    expect(modelStore.getNode(arm.a)?.y).toBeCloseTo(-2, 4);
  });

  it('pulls a free connected block without changing either block shape', () => {
    const first = block(0, 0, 2, 0), second = block(2, 0, 4, 0);
    modelStore.placeBlock(second.id, { x: 0, y: 0, angle: 0 }, { source: second.a, target: first.b });
    lockLastJoint();
    const pose = drag(first.id, { x: 0, y: 0 }, { x: 3, y: 1 });
    expect(modelStore.getNode(first.b)?.x).toBeCloseTo(modelStore.getNode(second.a)!.x, 7);
    modelStore.placeBlock(first.id, pose, undefined, { source: { x: 0, y: 0 }, target: { x: 3, y: 1 } });
    expect(modelStore.getNode(second.a)?.x).toBeCloseTo(modelStore.getNode(first.b)!.x, 7);
    expect(modelStore.getNode(second.a)?.y).toBeCloseTo(modelStore.getNode(first.b)!.y, 7);
    expect(Math.hypot(modelStore.getNode(second.b)!.x - modelStore.getNode(second.a)!.x,
      modelStore.getNode(second.b)!.y - modelStore.getNode(second.a)!.y)).toBeCloseTo(2, 7);
  });

  it('pulls a free base node, including its existing element endpoint', () => {
    const arm = block(0, 0, 2, 0), base = modelStore.addNode(2, 0), far = modelStore.addNode(5, 0);
    modelStore.addElement(base, far);
    modelStore.placeBlock(arm.id, { x: 0, y: 0, angle: 0 }, { source: arm.b, target: base });
    lockLastJoint();
    const pose = drag(arm.id, { x: 0, y: 0 }, { x: 3, y: 1 });
    modelStore.placeBlock(arm.id, pose, undefined, { source: { x: 0, y: 0 }, target: { x: 3, y: 1 } });
    expect(modelStore.getNode(base)?.x).toBeCloseTo(modelStore.getNode(arm.b)!.x, 7);
    expect(modelStore.getNode(base)?.y).toBeCloseTo(modelStore.getNode(arm.b)!.y, 7);
    expect(modelStore.getNode(far)).toMatchObject({ x: 5, y: 0 });
  });

  it('carries a chain of locked blocks and cancels its whole preview', () => {
    const first = block(0, 0, 1, 0), second = block(1, 0, 2, 0), third = block(2, 0, 3, 0);
    modelStore.placeBlock(second.id, { x: 0, y: 0, angle: 0 }, { source: second.a, target: first.b });
    lockLastJoint();
    modelStore.placeBlock(third.id, { x: 0, y: 0, angle: 0 }, { source: third.a, target: second.b });
    lockLastJoint();
    const pose = drag(first.id, { x: 0, y: 0 }, { x: 0, y: 2 });
    expect(modelStore.getNode(third.a)?.x).toBeCloseTo(modelStore.getNode(second.b)!.x, 7);
    expect(modelStore.getNode(third.a)?.y).toBeCloseTo(modelStore.getNode(second.b)!.y, 7);
    expect(modelStore.getNode(third.b)!.y).toBeGreaterThan(1);
    modelStore.previewBlock(first.id, null);
    expect(modelStore.getNode(third.b)).toMatchObject({ x: 3, y: 0 });
    modelStore.placeBlock(first.id, pose, undefined,
      { source: { x: 0, y: 0 }, target: { x: 0, y: 2 } });
    expect(modelStore.blocks.joints).toHaveLength(2);
    expect(modelStore.getNode(third.a)?.x).toBeCloseTo(modelStore.getNode(second.b)!.x, 7);
    expect(modelStore.getNode(third.a)?.y).toBeCloseTo(modelStore.getNode(second.b)!.y, 7);
  });

  it('keeps a base sketch length when its free endpoint follows a pin', () => {
    const arm = block(0, 0, 2, 0), base = modelStore.addNode(2, 0), far = modelStore.addNode(5, 0);
    const element = modelStore.addElement(base, far);
    modelStore.setSketchLength(element, 3);
    modelStore.placeBlock(arm.id, { x: 0, y: 0, angle: 0 }, { source: arm.b, target: base });
    lockLastJoint();
    modelStore.placeBlock(arm.id, { x: 1, y: 2, angle: 0 }, undefined,
      { source: { x: 0, y: 0 }, target: { x: 1, y: 2 } });
    const a = modelStore.getNode(base)!, b = modelStore.getNode(far)!;
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(3, 6);
  });

  it('preserves the relative angle of a locked continuous connection', () => {
    const first = block(0, 0, 2, 0), second = block(2, 0, 4, 0);
    modelStore.placeBlock(second.id, { x: 0, y: 0, angle: 0 }, { source: second.a, target: first.b });
    const jointId = lockLastJoint();
    modelStore.model.blocks!.joints.find(j => j.id === jointId)!.kind = 'continuous';
    modelStore.placeBlock(first.id, { x: 0, y: 0, angle: Math.PI / 2 });
    const a = modelStore.blocks.instances.find(b => b.id === first.id)!;
    const b = modelStore.blocks.instances.find(b => b.id === second.id)!;
    expect(a.angle).toBeCloseTo(Math.PI / 2, 5);
    expect(b.angle).toBeCloseTo(a.angle, 5);
    expect(modelStore.getNode(first.b)?.x).toBeCloseTo(modelStore.getNode(second.a)!.x, 7);
    expect(modelStore.getNode(first.b)?.y).toBeCloseTo(modelStore.getNode(second.a)!.y, 7);
  });

  it('does not detach or partially move an overconstrained assembly', () => {
    const arm = block(0, 0, 2, 0), base = modelStore.addNode(2, 0);
    modelStore.addSupport(arm.a, 'fixed');
    modelStore.addSupport(base, 'fixed');
    modelStore.placeBlock(arm.id, { x: 0, y: 0, angle: 0 }, { source: arm.b, target: base });
    const jointId = lockLastJoint();
    historyStore.clear();
    modelStore.placeBlock(arm.id, { x: 4, y: 4, angle: 0 }, undefined,
      { source: { x: 0, y: 0 }, target: { x: 4, y: 4 } });
    expect(modelStore.getNode(arm.a)).toMatchObject({ x: 0, y: 0 });
    expect(modelStore.blocks.joints.find(j => j.id === jointId)?.locked).toBe(true);
    expect(historyStore.undoCount).toBe(0);
  });

  it('round-trips lock state and accepts old connections without it', () => {
    const arm = block(0, 0, 2, 0), base = modelStore.addNode(2, 0);
    modelStore.placeBlock(arm.id, { x: 0, y: 0, angle: 0 }, { source: arm.b, target: base });
    const jointId = lockLastJoint();
    const saved = serializeProject();
    expect(deserializeProject(saved)).toBe(true);
    expect(modelStore.blocks.joints.find(j => j.id === jointId)?.locked).toBe(true);
    const legacy = JSON.parse(saved);
    delete legacy.snapshot.blocks.joints[0].locked;
    expect(validateDedalFile(legacy)).toBe(true);
    expect(deserializeProject(JSON.stringify(legacy))).toBe(true);
    expect(modelStore.blocks.joints[0].locked).toBeUndefined();
    const invalid = JSON.parse(saved);
    invalid.snapshot.blocks.joints[0].locked = 'yes';
    expect(validateDedalFile(invalid)).toBe(false);
  });

  it('undoes and redoes the lock toggle itself', () => {
    const arm = block(0, 0, 2, 0), base = modelStore.addNode(2, 0);
    modelStore.placeBlock(arm.id, { x: 0, y: 0, angle: 0 }, { source: arm.b, target: base });
    historyStore.clear();
    const id = lockLastJoint();
    expect(historyStore.undoCount).toBe(1);
    historyStore.undo();
    expect(modelStore.blocks.joints.find(j => j.id === id)?.locked).toBeUndefined();
    historyStore.redo();
    expect(modelStore.blocks.joints.find(j => j.id === id)?.locked).toBe(true);
  });
});
