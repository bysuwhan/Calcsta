import { describe, expect, it, vi } from 'vitest';
import { drawElement } from '../draw-entities';

describe('multi-member joint symbol', () => {
  it('keeps a released end circle centered on the node even at valence three', () => {
    const arcs: Array<[number, number]> = [];
    const ctx = {
      beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), fill: vi.fn(),
      setLineDash: vi.fn(), arc: (x: number, y: number) => arcs.push([x, y]), fillText: vi.fn(),
      strokeStyle: '', fillStyle: '', lineWidth: 1, font: '', textAlign: 'left',
    } as unknown as CanvasRenderingContext2D;
    drawElement(ctx, {
      id: 1, type: 'frame', nodeI: 1, nodeJ: 2, materialId: 1, sectionId: 1,
      releaseI: { my: false, mz: true, t: false }, releaseJ: { my: false, mz: false, t: false },
    }, { x: 0, y: 0 }, { x: 1, y: 0 }, {
      worldToScreen: (x, y) => ({ x: x * 100, y: y * 100 }), isSelected: false,
      elementColorMode: 'uniform', showElementLabels: false, showLengths: false,
      zoom: 100, diagramType: 'none', worldLength: 1,
    }, undefined, new Map([[1, 3]]));
    expect(arcs).toContainEqual([0, 0]);
  });
});
