import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ATTACHMENT_PICK_RADIUS_PX, ELEMENT_PICK_RADIUS_PX, findNearestLoad, findNearestNodeScreen, NODE_PICK_RADIUS_PX } from '../spatial-queries';

type Point = { id: number; x: number; y: number };

function nodes(...points: Point[]): Map<number, Point> {
  return new Map(points.map((point) => [point.id, point]));
}

const transformAtZoom = (zoom: number) => (x: number, y: number) => ({
  x: 400 + x * zoom,
  y: 300 - y * zoom,
});

describe('screen-space node picking', () => {
  for (const zoom of [50, 1000, 10_000]) {
    it(`keeps a ${NODE_PICK_RADIUS_PX}px radius at ${zoom}px/m`, () => {
      const projected = nodes({ id: 1, x: 0, y: 0 });
      const worldToScreen = transformAtZoom(zoom);

      expect(findNearestNodeScreen(409, 300, NODE_PICK_RADIUS_PX, projected, worldToScreen)?.id).toBe(1);
      expect(findNearestNodeScreen(411, 300, NODE_PICK_RADIUS_PX, projected, worldToScreen)).toBeNull();
    });
  }

  it('returns the closest node when multiple nodes are inside the radius', () => {
    const projected = nodes(
      { id: 1, x: 404, y: 300 },
      { id: 2, x: 408, y: 300 },
    );
    const identity = (x: number, y: number) => ({ x, y });

    expect(findNearestNodeScreen(407, 300, NODE_PICK_RADIUS_PX, projected, identity)?.id).toBe(2);
  });

  it('uses the raw pointer rather than a grid-snapped position', () => {
    const projected = nodes({ id: 1, x: 420, y: 300 });
    const identity = (x: number, y: number) => ({ x, y });
    const rawPointer = { x: 400, y: 300 };
    const gridSnappedPointer = { x: 420, y: 300 };

    expect(findNearestNodeScreen(rawPointer.x, rawPointer.y, NODE_PICK_RADIUS_PX, projected, identity)).toBeNull();
    expect(findNearestNodeScreen(gridSnappedPointer.x, gridSnappedPointer.y, NODE_PICK_RADIUS_PX, projected, identity)?.id).toBe(1);
  });

  it('works with coordinates already projected from any 2D working plane', () => {
    const identity = (x: number, y: number) => ({ x, y });
    const planeProjections = [
      nodes({ id: 1, x: 100, y: 100 }), // XY
      nodes({ id: 1, x: 100, y: 100 }), // XZ
      nodes({ id: 1, x: 100, y: 100 }), // YZ
    ];

    for (const projected of planeProjections) {
      expect(findNearestNodeScreen(106, 108, NODE_PICK_RADIUS_PX, projected, identity)?.id).toBe(1);
    }
  });

  it('routes all interactive node targets through the shared screen-space picker', () => {
    const viewport = readFileSync(
      join(import.meta.dirname, '../../../components/Viewport.svelte'),
      'utf8',
    );
    const calls = viewport.match(/findNearestNodeAtScreen\(/g) ?? [];

    // Hover, create, element, hinge, support, load, influence-line, selection,
    // edit, context-menu and touch paths all share this helper.
    expect(calls.length).toBeGreaterThanOrEqual(17);
    expect(viewport).toContain('NODE_PICK_RADIUS_PX / uiStore.zoom');
    expect(viewport).not.toContain('findNearestNode(snapped.x');
  });

  it('routes element, support, and load targets through fixed pixel radii', () => {
    const viewport = readFileSync(
      join(import.meta.dirname, '../../../components/Viewport.svelte'),
      'utf8',
    );

    expect(ELEMENT_PICK_RADIUS_PX).toBeLessThanOrEqual(NODE_PICK_RADIUS_PX);
    expect(ATTACHMENT_PICK_RADIUS_PX).toBe(NODE_PICK_RADIUS_PX);
    expect(viewport).toContain('ELEMENT_PICK_RADIUS_PX / uiStore.zoom');
    expect(viewport).toContain('ATTACHMENT_PICK_RADIUS_PX / uiStore.zoom');
    expect(viewport).not.toMatch(/findNearestElement\([^\n]+,\s*(?:0\.3|0\.5)\)/);
    expect(viewport).not.toMatch(/findNearestSupport\([^\n]+,\s*0\.5\)/);
    expect(viewport).not.toMatch(/findAllLoadsNear\([^\n]+,\s*0\.5\)/);
  });

  it('previews node and load member targets with the selection highlight', () => {
    const viewport = readFileSync(
      join(import.meta.dirname, '../../../components/Viewport.svelte'),
      'utf8',
    );

    expect(viewport).toContain("uiStore.currentTool === 'node' && uiStore.nodeMode === 'create'");
    expect(viewport).toContain("uiStore.currentTool === 'load'");
    expect(viewport.match(/drawElementTargetHighlight\(/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('never lets point-load priority expand the configured hit radius', () => {
    const projected = nodes({ id: 1, x: 20, y: 0 });
    const loads = [{ type: 'nodal', data: { id: 7, nodeId: 1, fx: 1, fz: 0, my: 0 } }] as any;

    // The 0.4 point-load sorting bonus previously turned a 10-unit radius
    // into an accidental 25-unit hit area.
    expect(findNearestLoad(0, 0, 10, loads, new Map(), projected as any)).toBeNull();
  });
});
