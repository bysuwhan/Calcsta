import { describe, expect, it } from 'vitest';
import { drawReactions } from '../draw-entities';

function render(rx: number, rz: number, units: 'SI' | 'SI_MM' = 'SI') {
  const points: number[][] = [], texts: string[] = [];
  const ctx = {
    save() {}, restore() {}, beginPath() {}, stroke() {}, closePath() {}, fill() {},
    moveTo(x: number, y: number) { points.push([x, y]); },
    lineTo(x: number, y: number) { points.push([x, y]); },
    fillText(text: string) { texts.push(text); },
  } as unknown as CanvasRenderingContext2D;
  drawReactions(ctx, [{ nodeId: 1, rx, rz }], () => ({ x: 100, y: 100 }), units);
  return { points, texts };
}

describe('reaction resultant', () => {
  it('draws the support force toward the node and reports magnitude and X-axis angle', () => {
    const { points, texts } = render(3, 4);
    expect(points.slice(0, 2)).toEqual([[64, 148], [100, 100]]);
    expect(texts[0]).toBe('R=5.00 kN  θ=53.1° (X)');
  });

  it.each([
    [-3, 4, '53.1'], [-3, -4, '53.1'], [3, -4, '53.1'],
    [0, 5, '90.0'], [-5, 0, '0.0'], [0, -5, '90.0'], [5, 0, '0.0'],
  ])('reports the smaller X-axis angle for RX=%s, RZ=%s', (rx, rz, angle) => {
    expect(render(rx, rz).texts[0]).toContain(`θ=${angle}°`);
  });

  it('converts the resultant to the selected force unit', () => {
    expect(render(3, 4, 'SI_MM').texts[0]).toContain('509.86 kgf');
  });

  it('omits zero reactions with no defined direction', () => {
    expect(render(0, 0)).toEqual({ points: [], texts: [] });
  });
});
