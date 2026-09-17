import { beforeAll, describe, expect, it } from 'vitest';
import { validateAndSolve2D, type ModelData } from '../solver-service';
import { initSolver } from '../wasm-solver';

const pinRelease = { my: false, mz: true, t: false };

function pinJointedTriangle(): ModelData {
  return {
    nodes: new Map([
      [1, { id: 1, x: 0, y: 0 } as any],
      [2, { id: 2, x: 4, y: 0 } as any],
      [3, { id: 3, x: 2, y: 3 } as any],
    ]),
    elements: new Map([
      [1, { id: 1, type: 'frame', nodeI: 1, nodeJ: 2, materialId: 1, sectionId: 1, releaseI: { ...pinRelease }, releaseJ: { ...pinRelease } } as any],
      [2, { id: 2, type: 'frame', nodeI: 2, nodeJ: 3, materialId: 1, sectionId: 1, releaseI: { ...pinRelease }, releaseJ: { ...pinRelease } } as any],
      [3, { id: 3, type: 'frame', nodeI: 3, nodeJ: 1, materialId: 1, sectionId: 1, releaseI: { ...pinRelease }, releaseJ: { ...pinRelease } } as any],
    ]),
    materials: new Map([[1, { id: 1, e: 200_000_000, nu: 0.3 } as any]]),
    sections: new Map([[1, { id: 1, a: 0.01, iz: 1e-4 } as any]]),
    supports: new Map([
      [1, { id: 1, nodeId: 1, type: 'pinned' } as any],
      [2, { id: 2, nodeId: 2, type: 'rollerX' } as any],
    ]),
    loads: [
      { type: 'nodal', data: { id: 1, nodeId: 3, fx: 0, fz: -10, my: 0 } } as any,
    ],
  };
}

describe('2D pin-jointed stability validation', () => {
  beforeAll(async () => { await initSolver(); });

  it('solves a non-collinear triangular pin-jointed structure', () => {
    const result = validateAndSolve2D(pinJointedTriangle(), false);

    expect(typeof result).not.toBe('string');
    if (typeof result === 'string' || !result) return;

    const verticalReaction = result.reactions.reduce((sum, reaction) => sum + reaction.rz, 0);
    expect(verticalReaction).toBeCloseTo(10, 8);
    expect(result.displacements.every(displacement =>
      Number.isFinite(displacement.ux)
      && Number.isFinite(displacement.uz)
      && Number.isFinite(displacement.ry)
    )).toBe(true);
  });

  it('still rejects collinear members pinned at their shared unsupported node', () => {
    const model = pinJointedTriangle();
    model.nodes.get(3)!.y = 0;

    const result = validateAndSolve2D(model, false);
    expect(typeof result).toBe('string');
  });
});
