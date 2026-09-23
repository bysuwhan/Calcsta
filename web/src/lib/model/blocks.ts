import type { Element, Node, StructureModel } from '../store/model.svelte';
import type { Constraint3D } from '../engine/types-3d';
import { transformSketchConstraint, remapSketchReferences, sketchReferences, type SketchConstraint } from './sketch-constraints';

export interface Point2 { x: number; y: number }
export interface BlockPose extends Point2 { angle: number }
export interface BlockDefinition {
  id: number;
  nodes: Node[];
  elements: Element[];
  /** Constraints are definition-local, so they move and rotate with every instance. */
  sketchConstraints?: SketchConstraint[];
}
export interface BlockInstance extends BlockPose {
  id: number;
  definitionId: number;
  name: string;
  color: string;
  visible: boolean;
  /** Stable local → model IDs. Model maps are the materialized world view. */
  nodeIds: Record<number, number>;
  elementIds: Record<number, number>;
}
export type BlockNodeRef = { kind: 'base'; nodeId: number } | { kind: 'block'; instanceId: number; localNodeId: number };
export interface BlockJoint { id: number; a: BlockNodeRef; b: BlockNodeRef; kind: 'pin' | 'continuous'; locked?: boolean }
export interface Blocks {
  definitions: BlockDefinition[];
  instances: BlockInstance[];
  joints: BlockJoint[];
  nextId: number;
}

/** Fixed, high-contrast hues used to distinguish block instances. */
export const BLOCK_COLOR_PALETTE = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16',
  '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#8b5cf6',
] as const;

/**
 * Return the simple closed loops in an element graph.
 *
 * A connected component is fillable only when every node has exactly two
 * neighbours. This deliberately leaves open chains and branched components
 * unfilled instead of guessing a face that the user did not define.
 */
export function closedElementLoops(elements: Iterable<Pick<Element, 'nodeI' | 'nodeJ'>>): number[][] {
  const neighbours = new Map<number, Set<number>>();
  for (const element of elements) {
    if (element.nodeI === element.nodeJ) continue;
    const atI = neighbours.get(element.nodeI) ?? new Set<number>();
    const atJ = neighbours.get(element.nodeJ) ?? new Set<number>();
    atI.add(element.nodeJ);
    atJ.add(element.nodeI);
    neighbours.set(element.nodeI, atI);
    neighbours.set(element.nodeJ, atJ);
  }

  const remaining = new Set(neighbours.keys());
  const loops: number[][] = [];
  while (remaining.size > 0) {
    const seed = remaining.values().next().value as number;
    const component: number[] = [];
    const pending = [seed];
    remaining.delete(seed);
    while (pending.length > 0) {
      const node = pending.pop()!;
      component.push(node);
      for (const next of neighbours.get(node) ?? []) {
        if (remaining.delete(next)) pending.push(next);
      }
    }
    if (component.length < 3 || component.some(node => neighbours.get(node)?.size !== 2)) continue;

    const start = component[0];
    const loop = [start];
    let previous: number | undefined;
    let current = start;
    while (loop.length <= component.length) {
      const next = [...neighbours.get(current)!].find(node => node !== previous);
      if (next === undefined) break;
      if (next === start) {
        if (loop.length === component.length) loops.push(loop);
        break;
      }
      if (loop.includes(next)) break;
      loop.push(next);
      previous = current;
      current = next;
    }
  }
  return loops;
}

/** Prefer an unused hue; once the palette is full, reuse the least-used hue. */
export function nextBlockColor(instances: Pick<BlockInstance, 'color'>[]): string {
  const counts = new Map(BLOCK_COLOR_PALETTE.map(color => [color, 0]));
  for (const instance of instances) {
    const color = instance.color.toLowerCase() as (typeof BLOCK_COLOR_PALETTE)[number];
    if (counts.has(color)) counts.set(color, counts.get(color)! + 1);
  }
  return BLOCK_COLOR_PALETTE.reduce((best, color) =>
    counts.get(color)! < counts.get(best)! ? color : best
  );
}

export const emptyBlocks = (): Blocks => ({ definitions: [], instances: [], joints: [], nextId: 1 });
export const copyBlockData = <T>(data: T): T => JSON.parse(JSON.stringify(data));
export function localToWorld(p: Point2, pose: BlockPose): Point2 {
  const c = Math.cos(pose.angle), s = Math.sin(pose.angle);
  return { x: pose.x + c * p.x - s * p.y, y: pose.y + s * p.x + c * p.y };
}
export function worldToLocal(p: Point2, pose: BlockPose): Point2 {
  return localToWorld({ x: p.x - pose.x, y: p.y - pose.y }, { x: 0, y: 0, angle: -pose.angle });
}
export function blockForNode(blocks: Blocks, id: number) {
  return blocks.instances.find(b => Object.values(b.nodeIds).includes(id));
}
export function blockForElement(blocks: Blocks, id: number) {
  return blocks.instances.find(b => Object.values(b.elementIds).includes(id));
}
export function nodeRef(blocks: Blocks, id: number): BlockNodeRef {
  const b = blockForNode(blocks, id);
  return b ? { kind: 'block', instanceId: b.id, localNodeId: Number(Object.keys(b.nodeIds).find(k => b.nodeIds[Number(k)] === id)) } : { kind: 'base', nodeId: id };
}
export function resolveNodeRef(blocks: Blocks, ref: BlockNodeRef): number | undefined {
  return ref.kind === 'base' ? ref.nodeId : blocks.instances.find(b => b.id === ref.instanceId)?.nodeIds[ref.localNodeId];
}
export function jointTouches(j: BlockJoint, id: number) {
  return [j.a, j.b].some(r => r.kind === 'block' && r.instanceId === id);
}
export function constraintNodes(c: Constraint3D): number[] {
  if (c.type === 'linearMPC') return c.terms.map(t => t.nodeId);
  if (c.type === 'diaphragm') return [c.masterNode, ...c.slaveNodes];
  return [c.masterNode, c.slaveNode];
}
export function materializeBlock(model: StructureModel, b: BlockInstance, ids: { node: number; element: number }) {
  const def = model.blocks!.definitions.find(d => d.id === b.definitionId)!;
  for (const [local, id] of Object.entries(b.nodeIds)) {
    if (!def.nodes.some(n => n.id === Number(local))) { model.nodes.delete(id); delete b.nodeIds[Number(local)]; }
  }
  for (const [local, id] of Object.entries(b.elementIds)) {
    if (!def.elements.some(e => e.id === Number(local))) { model.elements.delete(id); delete b.elementIds[Number(local)]; }
  }
  for (const n of def.nodes) {
    const id = b.nodeIds[n.id] ?? (b.nodeIds[n.id] = ids.node++);
    model.nodes.set(id, { ...n, id, ...localToWorld(n, b) });
  }
  for (const e of def.elements) {
    const id = b.elementIds[e.id] ?? (b.elementIds[e.id] = ids.element++);
    model.elements.set(id, { ...copyBlockData(e), id, nodeI: b.nodeIds[e.nodeI], nodeJ: b.nodeIds[e.nodeJ] });
  }
}

/** Definition-local constraints materialized for drawing and interactive solving. */
export function materializedSketchConstraints(model: StructureModel): SketchConstraint[] {
  const result = [...(model.sketchConstraints ?? [])];
  for (const b of model.blocks?.instances ?? []) {
    if (!b.visible) continue;
    const def = model.blocks!.definitions.find(d => d.id === b.definitionId);
    for (const local of def?.sketchConstraints ?? []) {
      let c = transformSketchConstraint(local, b, true);
      c = remapSketchReferences(c, id => b.nodeIds[id], id => b.elementIds[id]);
      result.push(c);
    }
  }
  return result;
}

/** Preserve boundary continuity explicitly; grouping must not introduce a hinge. */
export function createBlock(model: StructureModel, elementIds: number[], extraNodes: number[], origin: Point2, name: string, ids: { node: number; element: number }): number {
  const blocks = model.blocks ?? (model.blocks = emptyBlocks());
  const selected = new Set(elementIds);
  if (elementIds.some(id => blockForElement(blocks, id)) || extraNodes.some(id => blockForNode(blocks, id))) throw new Error('바탕의 요소만 블록으로 묶을 수 있습니다.');
  const elements = elementIds.map(id => model.elements.get(id)).filter((e): e is Element => !!e);
  const nodes = new Set([...extraNodes, ...elements.flatMap(e => [e.nodeI, e.nodeJ])]);
  if (!nodes.size) throw new Error('블록으로 묶을 요소를 선택하세요.');
  const id = blocks.nextId++;
  const b: BlockInstance = { id, definitionId: id, name: name.trim() || `블록 ${id}`, ...origin, angle: 0, color: nextBlockColor(blocks.instances), visible: true, nodeIds: {}, elementIds: {} };
  const def: BlockDefinition = { id, nodes: [], elements: [], sketchConstraints: [] };
  for (const nid of nodes) {
    const n = model.nodes.get(nid);
    if (!n) continue;
    const boundary = [...model.elements.values()].some(e => !selected.has(e.id) && (e.nodeI === nid || e.nodeJ === nid))
      || [...model.plates.values(), ...model.quads.values()].some(e => e.nodes.includes(nid))
      || [...model.connectors.values()].some(e => e.nodeI === nid || e.nodeJ === nid)
      || model.constraints.some(c => constraintNodes(c).includes(nid))
      || blocks.joints.some(j => resolveNodeRef(blocks, j.a) === nid || resolveNodeRef(blocks, j.b) === nid);
    const worldId = boundary ? ids.node++ : nid;
    b.nodeIds[nid] = worldId;
    def.nodes.push({ ...n, ...worldToLocal(n, b) });
    if (boundary) blocks.joints.push({ id: blocks.nextId++, a: nodeRef(blocks, nid), b: { kind: 'block', instanceId: id, localNodeId: nid }, kind: 'continuous' });
    // Existing attachments belong to the base workspace, but follow the selected part.
    for (const s of model.supports.values()) if (s.nodeId === nid) s.nodeId = worldId;
    for (const l of model.loads) if ('nodeId' in l.data && l.data.nodeId === nid) l.data.nodeId = worldId;
  }
  for (const e of elements) { b.elementIds[e.id] = e.id; def.elements.push(copyBlockData(e)); }
  const selectedNodes = new Set(nodes);
  const fullyContained = (c: SketchConstraint) => {
    return sketchReferences(c).every(r => r.kind === 'node' ? selectedNodes.has(r.id) : selected.has(r.id));
  };
  for (const c of (model.sketchConstraints ?? []).filter(fullyContained)) {
    def.sketchConstraints!.push(transformSketchConstraint(c, b, false));
  }
  model.sketchConstraints = (model.sketchConstraints ?? []).filter(c => !fullyContained(c));
  blocks.definitions.push(def); blocks.instances.push(b);
  materializeBlock(model, b, ids);
  return id;
}

export function cleanBlockReferences(model: StructureModel) {
  const blocks = model.blocks!;
  const before = { joints: blocks.joints.length, supports: model.supports.size, loads: model.loads.length };
  blocks.joints = blocks.joints.filter(j => {
    const ai = resolveNodeRef(blocks, j.a), bi = resolveNodeRef(blocks, j.b);
    const a = ai === undefined ? undefined : model.nodes.get(ai), b = bi === undefined ? undefined : model.nodes.get(bi);
    return !!a && !!b && Math.hypot(a.x - b.x, a.y - b.y) < 1e-7;
  });
  model.supports = new Map([...model.supports].filter(([, s]) => model.nodes.has(s.nodeId)));
  model.elements = new Map([...model.elements].filter(([, e]) => model.nodes.has(e.nodeI) && model.nodes.has(e.nodeJ)));
  model.loads = model.loads.filter(l => ('nodeId' in l.data ? model.nodes.has(l.data.nodeId) : 'elementId' in l.data ? model.elements.has(l.data.elementId) : true));
  model.constraints = model.constraints.filter(c => constraintNodes(c).every(id => model.nodes.has(id)));
  return { joints: before.joints - blocks.joints.length, supports: before.supports - model.supports.size, loads: before.loads - model.loads.length };
}

/** One active view is consumed by picking, rendering, preflight and every solver. */
export function activeBlockModel(model: StructureModel): StructureModel {
  const blocks = model.blocks;
  if (!blocks?.instances.length) return model;
  const hiddenNodes = new Set(blocks.instances.filter(b => !b.visible).flatMap(b => Object.values(b.nodeIds)));
  const hiddenElements = new Set(blocks.instances.filter(b => !b.visible).flatMap(b => Object.values(b.elementIds)));
  const nodes = new Map([...model.nodes].filter(([id]) => !hiddenNodes.has(id)));
  const elements = new Map([...model.elements].filter(([id, e]) => !hiddenElements.has(id) && nodes.has(e.nodeI) && nodes.has(e.nodeJ)));
  const constraints = model.constraints.filter(c => constraintNodes(c).every(id => nodes.has(id)));
  // Legacy cylinder placement could leave a separate base node exactly on a
  // block endpoint. Resolve only unambiguous, otherwise unused attachment nodes;
  // never merge structural nodes (coincident block nodes can be intentional pins).
  const connected = new Set([...elements.values()].flatMap(e => [e.nodeI, e.nodeJ]));
  const occupied = new Set([
    ...connected,
    ...model.constraints.flatMap(constraintNodes),
    ...[...model.connectors.values()].flatMap(c => [c.nodeI, c.nodeJ]),
    ...[...model.plates.values(), ...model.quads.values()].flatMap(e => e.nodes),
    ...[...model.supports.values()].map(s => s.nodeId),
    ...blocks.joints.flatMap(j => [resolveNodeRef(blocks, j.a), resolveNodeRef(blocks, j.b)]),
    ...model.loads.flatMap(l => 'nodeId' in l.data ? [l.data.nodeId] : []),
  ]);
  const aliases = new Map<number, number>();
  for (const load of model.loads) {
    if (load.type !== 'cylinder') continue;
    for (const id of [load.data.nodeI, load.data.nodeJ]) {
      const node = nodes.get(id);
      if (!node || occupied.has(id) || blockForNode(blocks, id)) continue;
      const candidates = [...nodes.values()].filter(n => connected.has(n.id)
        && blockForNode(blocks, n.id)
        && Math.hypot(n.x - node.x, n.y - node.y, (n.z ?? 0) - (node.z ?? 0)) < 1e-7);
      if (candidates.length === 1) aliases.set(id, candidates[0].id);
    }
  }
  for (const id of aliases.keys()) nodes.delete(id);
  const loads = model.loads.map(l => l.type === 'cylinder' ? {
    ...l, data: { ...l.data, nodeI: aliases.get(l.data.nodeI) ?? l.data.nodeI, nodeJ: aliases.get(l.data.nodeJ) ?? l.data.nodeJ },
  } : l);
  // A separate spanning forest per DOF avoids cyclic/repeated equalities in multi-part joints.
  const parents = new Map<number, Map<number, number>>();
  // The constraint solver eliminates slave DOFs. Keep supported DOFs on the
  // master side so their prescribed displacement remains in the reduced system.
  const supportsByNode = new Map([...model.supports.values()].map(s => [s.nodeId, s]));
  function supportPriority(id: number, dof: number): number {
    const s = supportsByNode.get(id);
    if (!s || s.type === 'spring') return 0;
    if (s.type === 'fixed') return 2;
    if (s.type === 'pinned') return dof === 4 ? 0 : 2;
    if (dof === 4) return 0;
    // Inclined/local rollers mix translations; retain their node as master.
    if (s.angle || s.isGlobal === false) return 1;
    if (s.type === 'rollerX') return dof === 2 ? 2 : 0;
    if (s.type === 'rollerY' || s.type === 'rollerZ') return dof === 0 ? 2 : 0;
    return 0;
  }
  function root(map: Map<number, number>, id: number): number {
    const p = map.get(id); if (p === undefined || p === id) return id;
    const r = root(map, p); map.set(id, r); return r;
  }
  for (const j of [...blocks.joints].sort((a, b) => a.id - b.id)) {
    const a = resolveNodeRef(blocks, j.a), b = resolveNodeRef(blocks, j.b);
    if (a === undefined || b === undefined || !nodes.has(a) || !nodes.has(b)) continue;
    (j.kind === 'pin' ? [0, 2] : [0, 2, 4]).filter(dof => {
      const map = parents.get(dof) ?? new Map<number, number>(); parents.set(dof, map);
      const ar = root(map, a), br = root(map, b);
      if (ar === br) return false;
      const ap = supportPriority(ar, dof), bp = supportPriority(br, dof);
      const master = ap === bp ? Math.min(ar, br) : ap > bp ? ar : br;
      map.set(master === ar ? br : ar, master); return true;
    });

  }
  const ties = new Map<string, { masterNode: number; slaveNode: number; dofs: number[] }>();
  for (const [dof, map] of parents) {
    for (const id of map.keys()) {
      const master = root(map, id); if (master === id) continue;
      const key = master + ':' + id;
      const tie = ties.get(key) ?? { masterNode: master, slaveNode: id, dofs: [] };
      tie.dofs.push(dof); ties.set(key, tie);
    }
  }
  for (const tie of ties.values()) constraints.push({ type: 'equalDOF', ...tie });
  return { ...model, nodes, elements, constraints,
    supports: new Map([...model.supports].filter(([, s]) => nodes.has(s.nodeId))),
    loads: loads.filter(l => l.type === 'cylinder' ? nodes.has(l.data.nodeI) && nodes.has(l.data.nodeJ) : 'nodeId' in l.data ? nodes.has(l.data.nodeId) : 'elementId' in l.data ? elements.has(l.data.elementId) : true),
    connectors: new Map([...model.connectors].filter(([, c]) => nodes.has(c.nodeI) && nodes.has(c.nodeJ))),
  };
}
