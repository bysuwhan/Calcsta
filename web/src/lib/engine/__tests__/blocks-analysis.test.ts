import { beforeEach, expect, it } from 'vitest';
import { modelStore as model } from '../../store/model.svelte';
import { solve } from '../wasm-solver';

beforeEach(() => model.clear());

it('grouping a continuous beam preserves displacement and reactions', () => {
  const a = model.addNode(0, 0), b = model.addNode(2, 0), c = model.addNode(4, 0);
  const left = model.addElement(a, b); model.addElement(b, c);
  model.addSupport(a, 'fixed'); model.addNodalLoad(c, 0, -10);
  const before = solve(model.buildSolverInput()!);
  model.createBlock([left], [], { x: 1, y: 0 }, '왼쪽 부품');
  const after = solve(model.buildSolverInput()!);
  const tipBefore = before.displacements.find(d => d.nodeId === c)!;
  const tipAfter = after.displacements.find(d => d.nodeId === c)!;
  expect(tipAfter.uz).toBeCloseTo(tipBefore.uz, 9);
  expect(tipAfter.ry).toBeCloseTo(tipBefore.ry, 9);
  expect(after.reactions[0].rz).toBeCloseTo(before.reactions[0].rz, 7);
});

it('a pin shares translation but permits opposing beam-end rotations', () => {
  const a = model.addNode(0, 0), b = model.addNode(2, 0), c = model.addNode(2, 0), d = model.addNode(4, 0);
  const left = model.addElement(a, b), right = model.addElement(c, d);
  const block = model.createBlock([left], [], { x: 0, y: 0 }, '왼쪽');
  model.createBlock([right], [], { x: 2, y: 0 }, '오른쪽');
  model.addSupport(a, 'fixed'); model.addSupport(d, 'fixed'); model.addNodalLoad(b, 0, -10);
  model.placeBlock(block, { x: 0, y: 0, angle: 0 }, { source: b, target: c });
  const result = solve(model.buildSolverInput()!);
  const lhs = result.displacements.find(n => n.nodeId === b)!, rhs = result.displacements.find(n => n.nodeId === c)!;
  expect(lhs.ux).toBeCloseTo(rhs.ux, 10); expect(lhs.uz).toBeCloseTo(rhs.uz, 10);
  expect(Math.abs(lhs.ry)).toBeGreaterThan(1e-8); expect(lhs.ry).toBeCloseTo(-rhs.ry, 8);
  expect(result.reactions.reduce((sum, r) => sum + r.rz, 0)).toBeCloseTo(10, 6);
});

it('a hidden loaded part contributes neither stiffness nor load', () => {
  const a = model.addNode(0, 0), b = model.addNode(2, 0), left = model.addElement(a, b);
  const first = model.createBlock([left], [], { x: 0, y: 0 }, '첫 부품');
  model.addSupport(a, 'fixed'); model.addNodalLoad(b, 0, -2);
  const baseline = solve(model.buildSolverInput()!);
  const copy = model.duplicateBlock(first)!;
  const instance = model.blocks.instances.find(i => i.id === copy)!;
  model.addSupport(instance.nodeIds[a], 'fixed'); model.addNodalLoad(instance.nodeIds[b], 0, -100);
  model.setBlockVisible(copy, false);
  const input = model.buildSolverInput()!, result = solve(input);
  expect(input.elements.size).toBe(1); expect(input.loads).toHaveLength(1);
  expect(result.displacements.find(n => n.nodeId === b)!.uz).toBeCloseTo(baseline.displacements.find(n => n.nodeId === b)!.uz, 10);
});
