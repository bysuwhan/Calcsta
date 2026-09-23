import type { StructureModel } from '../store/model.svelte';
import { blockForNode, localToWorld, materializedSketchConstraints, resolveNodeRef, worldToLocal,
  type BlockPose, type BlockNodeRef, type Point2 } from './blocks';
import { dimensionResiduals, sketchReferences } from './sketch-constraints';

export interface BlockGrip { source: Point2; target: Point2 }
export interface AssemblyPlacement {
  poses: Map<number, BlockPose>;
  baseNodes: Map<number, Point2>;
  nodePositions: Map<number, Point2>;
}

const angleDelta = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const distance = (a: Point2, b: Point2) => Math.hypot(a.x - b.x, a.y - b.y);
const maxAbs = (values: number[]) => values.reduce((m, value) => Math.max(m, Math.abs(value)), 0);

function linearSolve(matrix: number[][], rhs: number[]): number[] | null {
  const n = rhs.length;
  const a = matrix.map((row, i) => [...row, rhs[i]]);
  for (let k = 0; k < n; k++) {
    let pivot = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(a[i][k]) > Math.abs(a[pivot][k])) pivot = i;
    if (Math.abs(a[pivot][k]) < 1e-14) return null;
    [a[k], a[pivot]] = [a[pivot], a[k]];
    const divisor = a[k][k];
    for (let j = k; j <= n; j++) a[k][j] /= divisor;
    for (let i = 0; i < n; i++) {
      if (i === k) continue;
      const factor = a[i][k];
      for (let j = k; j <= n; j++) a[i][j] -= factor * a[k][j];
    }
  }
  return a.map(row => row[n]);
}

/** A damped least-squares step. The last pass below projects the hard conditions exactly. */
function step(q: number[], residuals: (q: number[]) => number[], damping: number): number[] | null {
  const r = residuals(q);
  const n = q.length;
  const jacobian = Array.from({ length: r.length }, () => Array<number>(n).fill(0));
  for (let col = 0; col < n; col++) {
    const h = 1e-6 * Math.max(1, Math.abs(q[col]));
    const plus = [...q], minus = [...q];
    plus[col] += h; minus[col] -= h;
    const rp = residuals(plus), rm = residuals(minus);
    for (let row = 0; row < r.length; row++) jacobian[row][col] = (rp[row] - rm[row]) / (2 * h);
  }
  const normal = Array.from({ length: n }, () => Array<number>(n).fill(0));
  const rhs = Array<number>(n).fill(0);
  for (let row = 0; row < r.length; row++) {
    for (let i = 0; i < n; i++) {
      const ji = jacobian[row][i];
      rhs[i] -= ji * r[row];
      for (let j = 0; j <= i; j++) normal[i][j] += ji * jacobian[row][j];
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) normal[i][j] = normal[j][i];
    normal[i][i] += damping;
  }
  return linearSolve(normal, rhs);
}

/**
 * Solve only the bodies reachable through locked joints. Block shape is rigid;
 * base nodes keep the sketch's existing point/line constraint vocabulary.
 * Returns undefined for an ordinary (unlocked) placement, null for invalid geometry.
 */
export function solveLockedBlockDrag(
  model: StructureModel, blockId: number, desiredPose: BlockPose, grip?: BlockGrip,
): AssemblyPlacement | null | undefined {
  const blocks = model.blocks;
  const driven = blocks?.instances.find(b => b.id === blockId && b.visible);
  if (!blocks || !driven) return null;
  const locked = blocks.joints.filter(j => j.locked === true);
  const blockIds = new Set<number>([blockId]);
  const baseIds = new Set<number>();
  const entityKey = (ref: BlockNodeRef) => ref.kind === 'block' ? `b:${ref.instanceId}` : `n:${ref.nodeId}`;
  const reached = new Set<string>([`b:${blockId}`]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const joint of locked) {
      const a = entityKey(joint.a), b = entityKey(joint.b);
      if (reached.has(a) === reached.has(b)) continue;
      const next = reached.has(a) ? joint.b : joint.a;
      const id = resolveNodeRef(blocks, next);
      if (id === undefined || !model.nodes.has(id)) continue;
      if (next.kind === 'block' && !blocks.instances.find(item => item.id === next.instanceId)?.visible) continue;
      reached.add(entityKey(next));
      if (next.kind === 'block') blockIds.add(next.instanceId);
      else baseIds.add(next.nodeId);
      changed = true;
    }
  }

  const joints = locked.filter(j => reached.has(entityKey(j.a)) && reached.has(entityKey(j.b)));
  if (!joints.length) return undefined;

  const constraints = materializedSketchConstraints(model);
  const movingNodeIds = new Set<number>(baseIds);
  for (const id of blockIds) {
    const block = blocks.instances.find(b => b.id === id)!;
    for (const nodeId of Object.values(block.nodeIds)) movingNodeIds.add(nodeId);
  }
  // A base sketch constraint can pull further free endpoints into the movement.
  changed = true;
  while (changed) {
    changed = false;
    for (const c of constraints) {
      const refs = sketchReferences(c).flatMap(ref => {
        if (ref.kind === 'node') return [ref.id];
        const e = model.elements.get(ref.id);
        return e ? [e.nodeI, e.nodeJ] : [];
      });
      if (!refs.some(id => movingNodeIds.has(id))) continue;
      for (const id of refs) {
        if (movingNodeIds.has(id) || !model.nodes.has(id) || blockForNode(blocks, id)) continue;
        movingNodeIds.add(id); baseIds.add(id); changed = true;
      }
    }
  }

  const relevantConstraints = constraints.filter(c => sketchReferences(c).some(ref => {
    if (ref.kind === 'node') return movingNodeIds.has(ref.id);
    const element = model.elements.get(ref.id);
    return !!element && (movingNodeIds.has(element.nodeI) || movingNodeIds.has(element.nodeJ));
  }));

  const orderedBlocks = [...blockIds].sort((a, b) => a - b);
  const orderedBase = [...baseIds].sort((a, b) => a - b);
  const blockIndex = new Map(orderedBlocks.map((id, i) => [id, 3 * i]));
  const baseIndex = new Map(orderedBase.map((id, i) => [id, 3 * (orderedBlocks.length + i)]));
  const initial = [
    ...orderedBlocks.flatMap(id => {
      const b = blocks.instances.find(item => item.id === id)!;
      return [b.x, b.y, b.angle];
    }),
    ...orderedBase.flatMap(id => {
      const node = model.nodes.get(id)!;
      return [node.x, node.y, 0];
    }),
  ];
  const localNodes = new Map<number, Point2>();
  for (const id of orderedBlocks) {
    const block = blocks.instances.find(b => b.id === id)!;
    for (const nodeId of Object.values(block.nodeIds)) {
      const node = model.nodes.get(nodeId);
      if (node) localNodes.set(nodeId, worldToLocal(node, block));
    }
  }
  const gripLocal = grip ? worldToLocal(grip.source, driven) : null;
  const poseOf = (q: number[], id: number): BlockPose => {
    const i = blockIndex.get(id)!;
    return { x: q[i], y: q[i + 1], angle: q[i + 2] };
  };
  const positionsOf = (q: number[]) => {
    const positions = new Map(model.nodes);
    for (const [id, local] of localNodes) {
      const block = blockForNode(blocks, id)!;
      positions.set(id, { ...model.nodes.get(id)!, ...localToWorld(local, poseOf(q, block.id)) });
    }
    for (const id of orderedBase) {
      const i = baseIndex.get(id)!;
      positions.set(id, { ...model.nodes.get(id)!, x: q[i], y: q[i + 1] });
    }
    return positions;
  };
  const location = (positions: Map<number, { x: number; y: number }>, ref: BlockNodeRef) => {
    const id = resolveNodeRef(blocks, ref);
    return id === undefined ? undefined : positions.get(id);
  };
  const hard = (q: number[]): number[] => {
    const positions = positionsOf(q);
    const r: number[] = [];
    for (const joint of joints) {
      const a = location(positions, joint.a), b = location(positions, joint.b);
      if (!a || !b) continue;
      r.push(a.x - b.x, a.y - b.y);
      if (joint.kind === 'continuous') {
        const angle = (ref: BlockNodeRef) => ref.kind === 'block'
          ? q[blockIndex.get(ref.instanceId)! + 2] : q[baseIndex.get(ref.nodeId)! + 2];
        const initialAngle = (ref: BlockNodeRef) => ref.kind === 'block'
          ? initial[blockIndex.get(ref.instanceId)! + 2] : 0;
        r.push(angleDelta(angle(joint.a) - angle(joint.b) - initialAngle(joint.a) + initialAngle(joint.b)));
      }
    }
    for (const support of model.supports.values()) {
      if (!movingNodeIds.has(support.nodeId)) continue;
      const old = model.nodes.get(support.nodeId), p = positions.get(support.nodeId);
      if (!old || !p) continue;
      const owner = blockForNode(blocks, support.nodeId);
      const angleIndex = owner && blockIndex.has(owner.id) ? blockIndex.get(owner.id)! + 2 : baseIndex.get(support.nodeId)! + 2;
      const initialAngle = initial[angleIndex];
      if (support.type === 'fixed' || support.type === 'fixed3d') {
        r.push(p.x - old.x, p.y - old.y, angleDelta(q[angleIndex] - initialAngle));
      } else if (support.type === 'pinned' || support.type === 'pinned3d') {
        r.push(p.x - old.x, p.y - old.y);
      } else if (support.type === 'rollerX' || support.type === 'rollerY' || support.type === 'rollerZ') {
        let axis = (support.type === 'rollerX' ? 0 : 90) + (support.angle ?? 0);
        if (support.isGlobal === false) {
          const angles: number[] = [];
          for (const e of model.elements.values()) {
            if (e.nodeI !== support.nodeId && e.nodeJ !== support.nodeId) continue;
            const other = model.nodes.get(e.nodeI === support.nodeId ? e.nodeJ : e.nodeI);
            if (other) angles.push(Math.atan2(other.y - old.y, other.x - old.x));
          }
          if (angles.length) axis += angles.reduce((sum, value) => sum + value, 0) / angles.length * 180 / Math.PI;
        }
        const radians = axis * Math.PI / 180;
        r.push(-(p.x - old.x) * Math.sin(radians) + (p.y - old.y) * Math.cos(radians));
      } else if (support.type === 'custom3d' && support.dofRestraints) {
        if (support.dofRestraints.tx) r.push(p.x - old.x);
        if (support.dofRestraints.tz || support.dofRestraints.ty) r.push(p.y - old.y);
        if (support.dofRestraints.ry || support.dofRestraints.rz) r.push(angleDelta(q[angleIndex] - initialAngle));
      }
    }
    for (const c of relevantConstraints) {
      if (c.kind === 'fixedNode') {
        if (movingNodeIds.has(c.nodeId)) {
          const old = model.nodes.get(c.nodeId), p = positions.get(c.nodeId);
          if (old && p) r.push(p.x - old.x, p.y - old.y);
        }
        continue;
      }
      if (c.kind === 'dimension') {
        if (!c.readOnly) r.push(...dimensionResiduals(c, positions, model.elements));
        continue;
      }
      const element = model.elements.get(c.kind === 'fixedElement' || c.kind === 'length' ? c.elementId : c.elementA);
      if (!element) continue;
      const a = positions.get(element.nodeI), b = positions.get(element.nodeJ);
      if (!a || !b) continue;
      const theta = Math.atan2(b.y - a.y, b.x - a.x);
      if (c.kind === 'fixedElement') {
        const nx = -Math.sin(c.angle), ny = Math.cos(c.angle);
        r.push(angleDelta(theta - c.angle), nx * a.x + ny * a.y - c.offset);
      } else if (c.kind === 'length') {
        r.push(distance(a, b) - c.value);
      } else {
        const other = model.elements.get(c.elementB);
        const u = other && positions.get(other.nodeI), v = other && positions.get(other.nodeJ);
        if (!u || !v) continue;
        const otherAngle = Math.atan2(v.y - u.y, v.x - u.x);
        if (c.kind === 'angle') r.push(angleDelta(otherAngle - theta - c.value));
        else {
          const normalX = -Math.sin(c.axisAngle), normalY = Math.cos(c.axisAngle);
          r.push(((u.x + v.x - a.x - b.x) / 2) * normalX
            + ((u.y + v.y - a.y - b.y) / 2) * normalY - c.value);
        }
      }
    }
    return r;
  };
  const soft = (q: number[]): number[] => {
    const r: number[] = [];
    if (grip && gripLocal) {
      const point = localToWorld(gripLocal, poseOf(q, blockId));
      r.push(point.x - grip.target.x, point.y - grip.target.y);
    } else {
      const b = poseOf(q, blockId);
      r.push(b.x - desiredPose.x, b.y - desiredPose.y, angleDelta(b.angle - desiredPose.angle));
    }
    for (let i = 0; i < q.length; i++) {
      const weight = 0.001;
      r.push(weight * (q[i] - initial[i]));
    }
    return r;
  };
  const weighted = (q: number[]) => [...hard(q).map(value => 1000 * value), ...soft(q)];
  const cost = (values: number[]) => values.reduce((sum, value) => sum + value * value, 0);
  const project = (start: number[]) => {
    let projected = start;
    for (let pass = 0; pass < 20 && maxAbs(hard(projected)) > 1e-9; pass++) {
      const direction = step(projected, hard, 1e-10);
      if (!direction) break;
      const oldCost = cost(hard(projected));
      let accepted = false;
      for (let scale = 1; scale >= 1 / 128; scale /= 2) {
        const candidate = projected.map((value, i) => value + scale * direction[i]);
        if (cost(hard(candidate)) < oldCost) { projected = candidate; accepted = true; break; }
      }
      if (!accepted) break;
    }
    return projected;
  };
  let q = [...initial];
  for (let pass = 0; pass < 35; pass++) {
    const direction = step(q, weighted, 1e-6);
    if (!direction || maxAbs(direction) < 1e-10) break;
    const oldCost = cost(weighted(q));
    let accepted = false;
    for (let scale = 1; scale >= 1 / 128; scale /= 2) {
      const candidate = project(q.map((value, i) => value + scale * direction[i]));
      if (cost(weighted(candidate)) < oldCost) { q = candidate; accepted = true; break; }
    }
    if (!accepted) break;
  }
  q = project(q);
  if (maxAbs(hard(q)) > 1e-7 || q.some(value => !Number.isFinite(value))) return null;

  const poses = new Map(orderedBlocks.map(id => [id, poseOf(q, id)]));
  const baseNodes = new Map(orderedBase.map(id => {
    const i = baseIndex.get(id)!;
    return [id, { x: q[i], y: q[i + 1] }] as const;
  }));
  const positions = positionsOf(q);
  const nodePositions = new Map<number, Point2>();
  for (const id of movingNodeIds) {
    const p = positions.get(id);
    if (p) nodePositions.set(id, { x: p.x, y: p.y });
  }
  return { poses, baseNodes, nodePositions };
}
