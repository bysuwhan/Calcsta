/** Sketch-only geometric constraints. They never enter the structural solver. */
export type SketchConstraint =
  | SmartDimension
  | { id: number; kind: 'fixedNode'; nodeId: number; x: number; y: number }
  | { id: number; kind: 'fixedElement'; elementId: number; angle: number; offset: number }
  | { id: number; kind: 'length'; elementId: number; value: number }
  | { id: number; kind: 'angle'; elementA: number; elementB: number; value: number }
  | { id: number; kind: 'distance'; elementA: number; elementB: number; axisAngle: number; value: number };

export interface SketchNode { id: number; x: number; y: number; z?: number }
export interface SketchElement { id: number; nodeI: number; nodeJ: number }
export interface SketchPose { x: number; y: number; angle: number }
export type SketchReference = { kind: 'node' | 'element'; id: number };
export interface SmartDimension {
  id: number;
  kind: 'dimension';
  references: [SketchReference, SketchReference];
  measure: 'pointDistance' | 'pointLineDistance' | 'lineDistance' | 'angle';
  /** Signed distance or radians; the sign retains the selected side. */
  value: number;
  /** User-chosen annotation position in the 2D sketch world. */
  position?: { x: number; y: number };
  /** A driven/reference dimension reports geometry but does not constrain it. */
  readOnly?: boolean;
}

export function sketchReferences(c: SketchConstraint): SketchReference[] {
  if (c.kind === 'dimension') return c.references;
  if (c.kind === 'fixedNode') return [{ kind: 'node', id: c.nodeId }];
  const ids = c.kind === 'fixedElement' || c.kind === 'length' ? [c.elementId] : [c.elementA, c.elementB];
  return ids.map(id => ({ kind: 'element', id }));
}

export function remapSketchReferences(c: SketchConstraint, node: (id: number) => number, element: (id: number) => number): SketchConstraint {
  if (c.kind === 'dimension') return { ...c, references: c.references.map(r => ({ ...r, id: r.kind === 'node' ? node(r.id) : element(r.id) })) as SmartDimension['references'] };
  if (c.kind === 'fixedNode') return { ...c, nodeId: node(c.nodeId) };
  if (c.kind === 'fixedElement' || c.kind === 'length') return { ...c, elementId: element(c.elementId) };
  return { ...c, elementA: element(c.elementA), elementB: element(c.elementB) };
}

const lineAngle = (angle: number) => Math.atan2(Math.sin(2 * angle), Math.cos(2 * angle)) / 2;

/** Select the acute or obtuse line-angle sector containing the annotation position. */
export function angleDimensionSector(
  pointA: { x: number; y: number }, angleA: number,
  pointB: { x: number; y: number }, angleB: number,
  position: { x: number; y: number },
): { centre: { x: number; y: number }; start: number; sweep: number } | null {
  const av = { x: Math.cos(angleA), y: Math.sin(angleA) };
  const bv = { x: Math.cos(angleB), y: Math.sin(angleB) };
  const cross = av.x * bv.y - av.y * bv.x;
  if (Math.abs(cross) < 1e-10) return null;
  const t = ((pointB.x - pointA.x) * bv.y - (pointB.y - pointA.y) * bv.x) / cross;
  const centre = { x: pointA.x + t * av.x, y: pointA.y + t * av.y };
  const turn = Math.PI * 2;
  const normalise = (angle: number) => (angle % turn + turn) % turn;
  const rays = [angleA, angleA + Math.PI, angleB, angleB + Math.PI]
    .map(normalise)
    .sort((a, b) => a - b);
  const cursor = normalise(Math.atan2(position.y - centre.y, position.x - centre.x));

  // Consecutive rays bound exactly one of the four visible sectors. Testing
  // containment directly avoids the old nearest-midpoint ambiguity, where
  // opposite sectors compared equal and the preview jumped by 180 degrees.
  for (let i = 0; i < rays.length; i++) {
    const start = rays[i];
    const end = i === rays.length - 1 ? rays[0] + turn : rays[i + 1];
    const unwrappedCursor = cursor < start ? cursor + turn : cursor;
    if (unwrappedCursor >= start && unwrappedCursor < end) {
      return { centre, start, sweep: end - start };
    }
  }
  return null;
}

export function inferSketchDimension(a: SketchReference, b: SketchReference, nodes: Map<number, SketchNode>, elements: Map<number, SketchElement>): SmartDimension | null {
  if (a.kind === b.kind && a.id === b.id) return null;
  const refs: [SketchReference, SketchReference] = [{ ...a }, { ...b }];
  if (refs[0].kind === 'element' && refs[1].kind === 'node') refs.reverse();
  for (const r of refs) {
    if (r.kind === 'node') { if (!nodes.has(r.id)) return null; }
    else { const e = elements.get(r.id); if (!e || (elementGeometry(e, nodes)?.length ?? 0) < EPS) return null; }
  }
  let measure: SmartDimension['measure'];
  if (refs.every(r => r.kind === 'node')) measure = 'pointDistance';
  else if (refs[0].kind === 'node') {
    const e = elements.get(refs[1].id)!;
    if (e.nodeI === refs[0].id || e.nodeJ === refs[0].id) return null;
    measure = 'pointLineDistance';
  } else {
    const ga = elementGeometry(elements.get(refs[0].id)!, nodes)!;
    const gb = elementGeometry(elements.get(refs[1].id)!, nodes)!;
    measure = Math.abs(Math.sin(gb.angle - ga.angle)) < 1e-6 ? 'lineDistance' : 'angle';
  }
  const c: SmartDimension = { id: 0, kind: 'dimension', references: refs, measure, value: 0 };
  const residual = dimensionResiduals(c, nodes, elements);
  if (!residual.length) return null;
  c.value = residual[0];
  return c;
}

/** Distances follow the live line, including its rotation; parallelism is part of line separation. */
export function dimensionResiduals(c: SmartDimension, nodes: Map<number, SketchNode>, elements: Map<number, SketchElement>): number[] {
  const [a, b] = c.references;
  const ga = a.kind === 'element' && elements.has(a.id) ? elementGeometry(elements.get(a.id)!, nodes) : null;
  const gb = b.kind === 'element' && elements.has(b.id) ? elementGeometry(elements.get(b.id)!, nodes) : null;
  if (c.measure === 'pointDistance') {
    const p = nodes.get(a.id), q = nodes.get(b.id);
    return p && q ? [Math.hypot(q.x - p.x, q.y - p.y) - c.value] : [];
  }
  if (c.measure === 'pointLineDistance') {
    const p = nodes.get(a.id); if (!p || !gb || gb.length < EPS) return [];
    return [-(p.x - gb.a.x) * Math.sin(gb.angle) + (p.y - gb.a.y) * Math.cos(gb.angle) - c.value];
  }
  if (!ga || !gb || ga.length < EPS || gb.length < EPS) return [];
  if (c.measure === 'angle') return [lineAngle(gb.angle - ga.angle - c.value)];
  const ac = { x: (ga.a.x + ga.b.x) / 2, y: (ga.a.y + ga.b.y) / 2 };
  const bc = { x: (gb.a.x + gb.b.x) / 2, y: (gb.a.y + gb.b.y) / 2 };
  return [-(bc.x - ac.x) * Math.sin(ga.angle) + (bc.y - ac.y) * Math.cos(ga.angle) - c.value,
    lineAngle(gb.angle - ga.angle)];
}

const EPS = 1e-10;

export function elementGeometry(
  element: SketchElement,
  nodes: Map<number, SketchNode>,
): { a: SketchNode; b: SketchNode; angle: number; length: number } | null {
  const a = nodes.get(element.nodeI), b = nodes.get(element.nodeJ);
  if (!a || !b) return null;
  const dx = b.x - a.x, dy = b.y - a.y;
  return { a, b, angle: Math.atan2(dy, dx), length: Math.hypot(dx, dy) };
}

/** Convert a definition-local constraint to/from a block instance's world frame. */
export function transformSketchConstraint(c: SketchConstraint, pose: SketchPose, toWorld: boolean): SketchConstraint {
  const sign = toWorld ? 1 : -1;
  const rotatePoint = (x: number, y: number) => {
    if (!toWorld) {
      x -= pose.x; y -= pose.y;
      const co = Math.cos(-pose.angle), si = Math.sin(-pose.angle);
      return { x: co * x - si * y, y: si * x + co * y };
    }
    const co = Math.cos(pose.angle), si = Math.sin(pose.angle);
    return { x: pose.x + co * x - si * y, y: pose.y + si * x + co * y };
  };
  if (c.kind === 'fixedNode') return { ...c, ...rotatePoint(c.x, c.y) };
  if (c.kind === 'dimension' && c.position) {
    return { ...c, position: rotatePoint(c.position.x, c.position.y) };
  }
  if (c.kind === 'fixedElement') {
    const localAngle = c.angle;
    const n = { x: -Math.sin(localAngle), y: Math.cos(localAngle) };
    const point = rotatePoint(n.x * c.offset, n.y * c.offset);
    const angle = c.angle + sign * pose.angle;
    const nw = { x: -Math.sin(angle), y: Math.cos(angle) };
    return { ...c, angle, offset: nw.x * point.x + nw.y * point.y };
  }
  if (c.kind === 'distance') return { ...c, axisAngle: c.axisAngle + sign * pose.angle };
  return c;
}

function rotateElement(
  e: SketchElement,
  target: number,
  positions: Map<number, SketchNode>,
  movable: Set<number>,
) {
  const a = positions.get(e.nodeI), b = positions.get(e.nodeJ);
  if (!a || !b) return;
  const ma = movable.has(a.id), mb = movable.has(b.id);
  if (!ma && !mb) return;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length < EPS) return;
  const ux = Math.cos(target), uy = Math.sin(target);
  if (ma && mb) {
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    a.x = cx - ux * length / 2; a.y = cy - uy * length / 2;
    b.x = cx + ux * length / 2; b.y = cy + uy * length / 2;
  } else if (mb) {
    b.x = a.x + ux * length; b.y = a.y + uy * length;
  } else {
    a.x = b.x - ux * length; a.y = b.y - uy * length;
  }
}

/**
 * Project a requested node move onto all applicable sketch constraints.
 * Only `movable` nodes are corrected, so unconstrained directions remain free.
 */
export function solveSketchMove(
  nodes: Map<number, SketchNode>,
  elements: Map<number, SketchElement>,
  constraints: SketchConstraint[],
  desired: Map<number, Pick<SketchNode, 'x' | 'y'>>,
  movable: Set<number>,
): Map<number, SketchNode> {
  const p = new Map([...nodes].map(([id, n]) => [id, { ...n }]));
  movable = new Set(movable);
  for (const c of constraints) if (c.kind === 'fixedNode') movable.delete(c.nodeId);
  for (const [id, d] of desired) {
    const n = p.get(id); if (n && movable.has(id)) { n.x = d.x; n.y = d.y; }
  }

  for (let pass = 0; pass < 120; pass++) {
    for (const c of constraints) {
      if (c.kind === 'dimension') {
        if (c.readOnly) continue;
        const ids = new Set(c.references.flatMap(r => {
          const e = elements.get(r.id);
          return r.kind === 'node' ? [r.id] : e ? [e.nodeI, e.nodeJ] : [];
        }).filter(id => movable.has(id)));
        const count = dimensionResiduals(c, p, elements).length;
        for (let row = 0; row < count; row++) {
          const error = dimensionResiduals(c, p, elements)[row];
          if (Math.abs(error) < 1e-9) continue;
          const gradient: { n: SketchNode; axis: 'x' | 'y'; d: number }[] = [];
          for (const id of ids) for (const axis of ['x', 'y'] as const) {
            const n = p.get(id)!; const initial = n[axis];
            const h = 1e-6;
            n[axis] = initial + h; const plus = dimensionResiduals(c, p, elements)[row];
            n[axis] = initial - h; const minus = dimensionResiduals(c, p, elements)[row];
            n[axis] = initial;
            gradient.push({ n, axis, d: (plus - minus) / (2 * h) });
          }
          const norm = gradient.reduce((s, g) => s + g.d * g.d, 0);
          if (norm > EPS) for (const g of gradient) g.n[g.axis] -= error * g.d / norm;
        }
        continue;
      }
      if (c.kind === 'fixedNode') {
        const n = p.get(c.nodeId);
        if (n && movable.has(n.id)) { n.x = c.x; n.y = c.y; }
        continue;
      }
      if (c.kind === 'fixedElement') {
        const e = elements.get(c.elementId); if (!e) continue;
        const nx = -Math.sin(c.angle), ny = Math.cos(c.angle);
        for (const id of [e.nodeI, e.nodeJ]) {
          const n = p.get(id); if (!n || !movable.has(id)) continue;
          const error = nx * n.x + ny * n.y - c.offset;
          n.x -= error * nx; n.y -= error * ny;
        }
        continue;
      }
      if (c.kind === 'length') {
        const e = elements.get(c.elementId); if (!e || !(c.value > EPS)) continue;
        const a = p.get(e.nodeI), b = p.get(e.nodeJ); if (!a || !b) continue;
        const ma = movable.has(a.id), mb = movable.has(b.id); if (!ma && !mb) continue;
        let dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
        if (length < EPS) { dx = 1; dy = 0; length = 1; }
        const ux = dx / length, uy = dy / length, error = length - c.value;
        const share = ma && mb ? 0.5 : 1;
        if (ma) { a.x += ux * error * share; a.y += uy * error * share; }
        if (mb) { b.x -= ux * error * share; b.y -= uy * error * share; }
        continue;
      }
      if (c.kind === 'angle') {
        const ea = elements.get(c.elementA), eb = elements.get(c.elementB);
        if (!ea || !eb) continue;
        const ga = elementGeometry(ea, p), gb = elementGeometry(eb, p); if (!ga || !gb) continue;
        const bCanMove = movable.has(eb.nodeI) || movable.has(eb.nodeJ);
        if (bCanMove) rotateElement(eb, ga.angle + c.value, p, movable);
        else rotateElement(ea, gb.angle - c.value, p, movable);
        continue;
      }
      const ea = elements.get(c.elementA), eb = elements.get(c.elementB);
      if (!ea || !eb) continue;
      const ga = elementGeometry(ea, p), gb = elementGeometry(eb, p); if (!ga || !gb) continue;
      const nx = -Math.sin(c.axisAngle), ny = Math.cos(c.axisAngle);
      const ca = { x: (ga.a.x + ga.b.x) / 2, y: (ga.a.y + ga.b.y) / 2 };
      const cb = { x: (gb.a.x + gb.b.x) / 2, y: (gb.a.y + gb.b.y) / 2 };
      const error = (cb.x - ca.x) * nx + (cb.y - ca.y) * ny - c.value;
      const bm = [eb.nodeI, eb.nodeJ].filter(id => movable.has(id));
      const am = [ea.nodeI, ea.nodeJ].filter(id => movable.has(id));
      const targets = bm.length ? bm : am;
      const direction = bm.length ? -1 : 1;
      for (const id of targets) {
        const n = p.get(id)!;
        const scale = targets.length === 1 ? 1 : 1;
        n.x += direction * error * nx * scale; n.y += direction * error * ny * scale;
      }
    }
  }
  return p;
}

export function constraintTouchesNode(c: SketchConstraint, nodeId: number, elements: Map<number, SketchElement>): boolean {
  if (c.kind === 'dimension') return c.references.some(r => r.kind === 'node' ? r.id === nodeId : (() => { const e = elements.get(r.id); return e?.nodeI === nodeId || e?.nodeJ === nodeId; })());
  if (c.kind === 'fixedNode') return c.nodeId === nodeId;
  const ids = c.kind === 'fixedElement' || c.kind === 'length' ? [c.elementId] : [c.elementA, c.elementB];
  return ids.some(id => { const e = elements.get(id); return !!e && (e.nodeI === nodeId || e.nodeJ === nodeId); });
}
