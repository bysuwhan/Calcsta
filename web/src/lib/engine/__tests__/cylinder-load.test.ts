import { describe, expect, it } from 'vitest';
import { buildSolverInput2D } from '../solver-service';
import type { ModelData } from '../solver-service';
import { NO_RELEASE, type Load } from '../../store/model.svelte';
import { isBasic2DLoad } from '../../store/file';
import { drawDeformedCylinder } from '../../canvas/draw-deformed';
import type { AnalysisResults } from '../types';

function modelWith(load: Load): ModelData {
  return {
    nodes: new Map([
      [1, { id: 1, x: 0, y: 0 }],
      [2, { id: 2, x: 3, y: 4 }],
    ]),
    elements: new Map([[1, {
      id: 1, type: 'frame', nodeI: 1, nodeJ: 2, materialId: 1, sectionId: 1,
      releaseI: { ...NO_RELEASE }, releaseJ: { ...NO_RELEASE },
    }]]),
    supports: new Map([[1, { id: 1, nodeId: 1, type: 'fixed' }]]),
    loads: [load],
    materials: new Map([[1, { id: 1, name: 'test', e: 200_000, nu: 0.3, rho: 0 }]]),
    sections: new Map([[1, { id: 1, name: 'test', a: 0.01, iz: 1e-4 }]]),
    constraints: [], connectors: new Map(),
  };
}

describe('two-point cylinder load', () => {
  it('is retained by Basic project-file sanitisation', () => {
    expect(isBasic2DLoad({ type: 'cylinder', data: { id: 1, nodeI: 1, nodeJ: 2, force: -25 } })).toBe(true);
  });

  it('positive force pushes both nodes outward along the cylinder axis', () => {
    const input = buildSolverInput2D(modelWith({ type: 'cylinder', data: { id: 1, nodeI: 1, nodeJ: 2, force: 10 } }));
    expect(input?.loads).toEqual([
      { type: 'nodal', data: { nodeId: 1, fx: -6, fz: -8, my: 0 } },
      { type: 'nodal', data: { nodeId: 2, fx: 6, fz: 8, my: 0 } },
    ]);
  });

  it('negative force pulls both nodes inward', () => {
    const input = buildSolverInput2D(modelWith({ type: 'cylinder', data: { id: 1, nodeI: 1, nodeJ: 2, force: -10 } }));
    expect(input?.loads).toEqual([
      { type: 'nodal', data: { nodeId: 1, fx: 6, fz: 8, my: 0 } },
      { type: 'nodal', data: { nodeId: 2, fx: -6, fz: -8, my: 0 } },
    ]);
  });

  it('draws a straight line between the two displaced attachment nodes', () => {
    const points: Array<[number, number]> = [];
    const ctx = {
      save() {}, restore() {}, setLineDash() {}, beginPath() {}, stroke() {},
      moveTo: (x: number, y: number) => points.push([x, y]),
      lineTo: (x: number, y: number) => points.push([x, y]),
      strokeStyle: '', lineWidth: 1,
    } as unknown as CanvasRenderingContext2D;
    const results = {
      displacements: [
        { nodeId: 1, ux: 0.1, uz: 0.2, ry: 0 },
        { nodeId: 2, ux: -0.2, uz: 0.3, ry: 0 },
      ],
    } as AnalysisResults;
    drawDeformedCylinder(results, { nodeI: 1, nodeJ: 2 }, {
      ctx,
      worldToScreen: (x, y) => ({ x: x * 10, y: y * 10 }),
      getNode: (id) => id === 1 ? { x: 0, y: 0 } : { x: 3, y: 4 },
    }, 2);
    expect(points).toEqual([[2, 4], [26, 46]]);
  });
});
