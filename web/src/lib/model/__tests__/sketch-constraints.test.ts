import { describe, expect, it } from 'vitest';
import { angleDimensionSector, dimensionResiduals, inferSketchDimension, solveSketchMove, transformSketchConstraint, type SketchConstraint, type SmartDimension } from '../sketch-constraints';

const nodes = (values: Array<[number, number, number]>) =>
  new Map(values.map(([id, x, y]) => [id, { id, x, y }]));
const elements = new Map([
  [1, { id: 1, nodeI: 1, nodeJ: 2 }],
  [2, { id: 2, nodeI: 3, nodeJ: 4 }],
]);

describe('sketch constraints', () => {
  it('infers point, line-distance, and angle dimensions from the selected pair', () => {
    const input = nodes([[1, 0, 0], [2, 4, 0], [3, 0, 2], [4, 4, 2], [5, 2, 3], [6, 2, 5]]);
    const geometry = new Map(elements);
    geometry.set(3, { id: 3, nodeI: 5, nodeJ: 6 });

    expect(inferSketchDimension({ kind: 'node', id: 1 }, { kind: 'node', id: 5 }, input, geometry)?.measure).toBe('pointDistance');
    expect(inferSketchDimension({ kind: 'node', id: 5 }, { kind: 'element', id: 1 }, input, geometry)?.measure).toBe('pointLineDistance');
    expect(inferSketchDimension({ kind: 'element', id: 1 }, { kind: 'element', id: 2 }, input, geometry)?.measure).toBe('lineDistance');
    expect(inferSketchDimension({ kind: 'element', id: 1 }, { kind: 'element', id: 3 }, input, geometry)?.measure).toBe('angle');
  });

  it('keeps only a smart point-to-line distance while allowing travel along the line', () => {
    const input = nodes([[1, 0, 0], [2, 4, 0], [3, 2, 2]]);
    const c = inferSketchDimension({ kind: 'node', id: 3 }, { kind: 'element', id: 1 }, input, elements)!;
    const out = solveSketchMove(input, elements, [c], new Map([[3, { x: 8, y: 7 }]]), new Set([3]));
    expect(out.get(3)?.x).toBeCloseTo(8);
    expect(out.get(3)?.y).toBeCloseTo(2);
    expect(dimensionResiduals(c, out, elements)[0]).toBeCloseTo(0);
  });

  it('keeps parallel line separation while allowing translation along the lines', () => {
    const input = nodes([[1, 0, 0], [2, 4, 0], [3, 0, 2], [4, 4, 2]]);
    const c = inferSketchDimension({ kind: 'element', id: 1 }, { kind: 'element', id: 2 }, input, elements)!;
    const out = solveSketchMove(input, elements, [c], new Map([[3, { x: 3, y: 8 }], [4, { x: 7, y: 8 }]]), new Set([3, 4]));
    expect(out.get(3)?.x).toBeCloseTo(3);
    expect(out.get(4)?.x).toBeCloseTo(7);
    expect(dimensionResiduals(c, out, elements).every(v => Math.abs(v) < 1e-7)).toBe(true);
  });

  it('makes a fixed node completely immovable', () => {
    const input = nodes([[1, 1, 2]]);
    const out = solveSketchMove(input, new Map(), [{ id: 1, kind: 'fixedNode', nodeId: 1, x: 1, y: 2 }],
      new Map([[1, { x: 9, y: -4 }]]), new Set([1]));
    expect(out.get(1)).toMatchObject({ x: 1, y: 2 });
  });

  it('lets a fixed member endpoint slide along its original line but not offset it', () => {
    const input = nodes([[1, 0, 0], [2, 4, 0]]);
    const out = solveSketchMove(input, elements, [{ id: 1, kind: 'fixedElement', elementId: 1, angle: 0, offset: 0 }],
      new Map([[2, { x: 7, y: 3 }]]), new Set([2]));
    expect(out.get(2)).toMatchObject({ x: 7, y: 0 });
  });

  it('keeps a length while leaving tangential movement available', () => {
    const input = nodes([[1, 0, 0], [2, 3, 0]]);
    const out = solveSketchMove(input, elements, [{ id: 1, kind: 'length', elementId: 1, value: 3 }],
      new Map([[2, { x: 0, y: 6 }]]), new Set([2]));
    expect(out.get(2)?.x).toBeCloseTo(0);
    expect(out.get(2)?.y).toBeCloseTo(3);
  });

  it('preserves a dimension when both endpoints translate in an unconstrained direction', () => {
    const input = nodes([[1, 0, 0], [2, 3, 0]]);
    const out = solveSketchMove(input, elements, [{ id: 1, kind: 'length', elementId: 1, value: 3 }],
      new Map([[1, { x: 2, y: 5 }], [2, { x: 5, y: 5 }]]), new Set([1, 2]));
    expect(out.get(1)).toMatchObject({ x: 2, y: 5 });
    expect(out.get(2)).toMatchObject({ x: 5, y: 5 });
  });

  it('limits only the relative angle of two members', () => {
    const input = nodes([[1, 0, 0], [2, 4, 0], [3, 0, 2], [4, 4, 2]]);
    const out = solveSketchMove(input, elements, [{ id: 1, kind: 'angle', elementA: 1, elementB: 2, value: Math.PI / 2 }],
      new Map([[4, { x: 5, y: 5 }]]), new Set([4]));
    expect(out.get(4)?.x).toBeCloseTo(0);
    expect(out.get(4)?.y).toBeGreaterThan(2);
  });

  it('keeps the perpendicular distance between horizontal members while x remains free', () => {
    const input = nodes([[1, 0, 0], [2, 4, 0], [3, 0, 2], [4, 4, 2]]);
    const out = solveSketchMove(input, elements, [{ id: 1, kind: 'distance', elementA: 1, elementB: 2, axisAngle: 0, value: 2 }],
      new Map([[3, { x: 3, y: 8 }], [4, { x: 7, y: 8 }]]), new Set([3, 4]));
    expect(out.get(3)).toMatchObject({ x: 3, y: 2 });
    expect(out.get(4)).toMatchObject({ x: 7, y: 2 });
  });

  it('keeps block-local fixation local when an instance moves and rotates', () => {
    const local: SketchConstraint = { id: 1, kind: 'fixedNode', nodeId: 7, x: 2, y: 0 };
    const world = transformSketchConstraint(local, { x: 10, y: 5, angle: Math.PI / 2 }, true);
    expect(world).toMatchObject({ x: 10, y: 7 });
    const restored = transformSketchConstraint(world, { x: 10, y: 5, angle: Math.PI / 2 }, false);
    if (restored.kind !== 'fixedNode') throw new Error('expected fixed node');
    expect(restored.x).toBeCloseTo(2);
    expect(restored.y).toBeCloseTo(0);
  });

  it('chooses the acute or obtuse angle from the annotation side', () => {
    const acute = angleDimensionSector({ x: 0, y: 0 }, 0, { x: 0, y: 0 }, Math.PI / 4, { x: 2, y: 1 });
    const obtuse = angleDimensionSector({ x: 0, y: 0 }, 0, { x: 0, y: 0 }, Math.PI / 4, { x: -1, y: 2 });
    expect(Math.abs(acute!.sweep) * 180 / Math.PI).toBeCloseTo(45);
    expect(Math.abs(obtuse!.sweep) * 180 / Math.PI).toBeCloseTo(135);
  });

  it('keeps the angle preview in the cursor sector on both sides of the intersection', () => {
    const first = angleDimensionSector({ x: 0, y: 0 }, 0, { x: 0, y: 0 }, Math.PI / 4, { x: -2, y: -1 });
    const moved = angleDimensionSector({ x: 0, y: 0 }, 0, { x: 0, y: 0 }, Math.PI / 4, { x: -2.1, y: -0.8 });
    expect(first!.start).toBeCloseTo(Math.PI);
    expect(first!.sweep).toBeCloseTo(Math.PI / 4);
    expect(moved!.start).toBeCloseTo(Math.PI);
    expect(moved!.sweep).toBeCloseTo(Math.PI / 4);
  });

  it('does not constrain geometry with a read-only dimension', () => {
    const input = nodes([[1, 0, 0], [2, 3, 0]]);
    const c: SmartDimension = { id: 1, kind: 'dimension', references: [{ kind: 'node', id: 1 }, { kind: 'node', id: 2 }],
      measure: 'pointDistance', value: 3, readOnly: true };
    const out = solveSketchMove(input, elements, [c], new Map([[2, { x: 8, y: 0 }]]), new Set([2]));
    expect(out.get(2)).toMatchObject({ x: 8, y: 0 });
  });

  it('transforms a dimension annotation position with its block', () => {
    const local: SketchConstraint = {
      id: 2,
      kind: 'dimension',
      references: [{ kind: 'node', id: 1 }, { kind: 'node', id: 2 }],
      measure: 'pointDistance',
      value: 4,
      position: { x: 2, y: 1 },
    };
    const world = transformSketchConstraint(local, { x: 10, y: 5, angle: Math.PI / 2 }, true);
    expect(world.kind === 'dimension' ? world.position : undefined).toEqual(expect.objectContaining({ x: 9, y: 7 }));
  });
});
