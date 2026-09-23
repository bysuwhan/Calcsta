import { modelStore, uiStore, resultsStore, historyStore } from './index';
import { closedElementLoops, localToWorld, worldToLocal, type BlockPose, type Point2 } from '../model/blocks';
import { to2D, to3D } from '../geometry/plane-projection';
import type { Node } from './model.svelte';

type Command = {
  kind: 'create' | 'move' | 'rotate';
  step: 'select' | 'base' | 'reference' | 'destination' | 'name';
  id?: number;
  base?: Point2;
  source?: number;
  reference?: number;
  elements?: number[];
  nodes?: number[];
  pose?: BlockPose;
  gripTarget?: Point2;
  target?: 'block' | 'entities';
  originalNodes?: Node[];
  nodePreview?: Map<number, Node>;
};
let selected = $state<number | null>(null);
let command = $state<Command | null>(null);
let context = $state<{ x: number; y: number; id: number } | null>(null);
let cursor = $state<Point2 | null>(null);
function nearest(point: Point2, predicate: (id: number) => boolean = () => true) {
  let best: (Point2 & { id: number }) | null = null, distance = 10 / uiStore.zoom;
  // Read committed coordinates so a preview cannot snap onto itself.
  for (const n of modelStore.model.nodes.values()) {
    if (!predicate(n.id)) continue;
    const d = Math.hypot(point.x - n.x, point.y - n.y);
    if (d < distance) { distance = d; best = n; }
  }
  return best;
}
function snap(point: Point2, predicate?: (id: number) => boolean) { return nearest(point, predicate) ?? uiStore.snapWorld(point.x, point.y); }
function instanceAt(point: Point2): number | null {
  const node = nearest(point);
  const owner = node && modelStore.blockForNode(node.id);
  if (owner) return owner.id;
  let best: number | null = null, distance = 8 / uiStore.zoom;
  for (const e of modelStore.elements.values()) {
    const b = modelStore.blockForElement(e.id); if (!b) continue;
    const a = modelStore.getNode(e.nodeI), z = modelStore.getNode(e.nodeJ); if (!a || !z) continue;
    const dx = z.x - a.x, dy = z.y - a.y;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    const d = Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
    if (d < distance) { distance = d; best = b.id; }
  }
  if (best !== null) return best;

  // A closed block has a visible body, so its body is a valid selection and
  // drag target too. Check newest instances first when filled blocks overlap.
  for (const block of [...modelStore.blocks.instances].reverse()) {
    if (!block.visible) continue;
    const elements = Object.values(block.elementIds)
      .map(id => modelStore.elements.get(id))
      .filter((element): element is NonNullable<typeof element> => !!element);
    for (const loop of closedElementLoops(elements)) {
      const polygon = loop
        .map(id => modelStore.getNode(id))
        .filter((node): node is NonNullable<typeof node> => !!node);
      if (polygon.length !== loop.length) continue;
      let inside = false;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[i], b = polygon[j];
        if ((a.y > point.y) !== (b.y > point.y)
          && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
      }
      if (inside) return block.id;
    }
  }
  return null;
}
function baseElementAt(point: Point2): number | null {
  let best: number | null = null, distance = 8 / uiStore.zoom;
  for (const element of modelStore.elements.values()) {
    if (!modelStore.canEditElement(element.id)) continue;
    const a = modelStore.getNode(element.nodeI), b = modelStore.getNode(element.nodeJ);
    if (!a || !b) continue;
    const pa = to2D(uiStore.drawPlane2D, a.x, a.y, a.z ?? 0);
    const pb = to2D(uiStore.drawPlane2D, b.x, b.y, b.z ?? 0);
    const dx = pb.x - pa.x, dy = pb.y - pa.y;
    const t = Math.max(0, Math.min(1, ((point.x - pa.x) * dx + (point.y - pa.y) * dy) / (dx * dx + dy * dy || 1)));
    const d = Math.hypot(point.x - pa.x - t * dx, point.y - pa.y - t * dy);
    if (d < distance) { distance = d; best = element.id; }
  }
  return best;
}
function baseNodeAt(point: Point2): Node | null {
  let best: Node | null = null, distance = 10 / uiStore.zoom;
  for (const node of modelStore.nodes.values()) {
    if (!modelStore.canEditNode(node.id)) continue;
    const projected = to2D(uiStore.drawPlane2D, node.x, node.y, node.z ?? 0);
    const d = Math.hypot(point.x - projected.x, point.y - projected.y);
    if (d < distance) { distance = d; best = node; }
  }
  return best;
}
function cancel() {
  modelStore.previewBlock(0, null);
  modelStore.previewNodeTransform(null);
  command = null;
  cursor = null;
}
function select(id: number | null) { selected = id; uiStore.clearSelection(); context = null; }
function resolveTargetBlockId(id?: number): number | undefined {
  if (id !== undefined) return id;
  if (selected !== null) return selected;
  for (const elemId of uiStore.selectedElements) {
    const b = modelStore.blockForElement(elemId);
    if (b) return b.id;
  }
  for (const nodeId of uiStore.selectedNodes) {
    const b = modelStore.blockForNode(nodeId);
    if (b) return b.id;
  }
  return undefined;
}

/** Selected members transform through their end nodes, matching CAD selection semantics. */
function selectedTransformNodes(): Node[] {
  const ids = new Set<number>();
  for (const id of uiStore.selectedNodes) {
    if (modelStore.canEditNode(id)) ids.add(id);
  }
  for (const id of uiStore.selectedElements) {
    if (!modelStore.canEditElement(id)) continue;
    const element = modelStore.elements.get(id);
    if (!element) continue;
    if (modelStore.canEditNode(element.nodeI)) ids.add(element.nodeI);
    if (modelStore.canEditNode(element.nodeJ)) ids.add(element.nodeJ);
  }
  return [...ids].flatMap(id => {
    const node = modelStore.getNode(id);
    return node ? [{ ...node }] : [];
  });
}

function begin(kind: Command['kind'], id?: number) {
  if (modelStore.editingBlockId !== null) return;
  const explicitBlockId = id ?? (selected ?? undefined);
  const entityNodes = kind === 'create' ? [] : selectedTransformNodes();
  const targetId = explicitBlockId ?? (entityNodes.length === 0 ? resolveTargetBlockId() : undefined);
  cancel(); context = null;
  if (kind === 'create') {
    const elements = [...uiStore.selectedElements], nodes = [...uiStore.selectedNodes];
    if (!elements.length && !nodes.length) { uiStore.toast('바탕에서 블록으로 묶을 요소를 선택하세요.', 'info'); return; }
    if (elements.some(e => modelStore.blockForElement(e)) || nodes.some(n => modelStore.blockForNode(n))) {
      uiStore.toast('바탕의 요소만 블록으로 묶을 수 있습니다.', 'info'); return;
    }
    try {
      select(modelStore.createBlock(elements, nodes, { x: 0, y: 0 }, nextDefaultBlockName()));
    } catch (e) {
      uiStore.toast(String(e instanceof Error ? e.message : e), 'error');
    }
    cancel();
  } else {
    if (targetId !== undefined) {
      selected = targetId;
      command = { kind, step: 'base', id: targetId, target: 'block' };
    } else if (entityNodes.length > 0) {
      selected = null;
      command = { kind, step: 'base', target: 'entities', originalNodes: entityNodes };
    } else {
      command = { kind, step: 'select', target: 'block' };
    }
  }
  uiStore.currentTool = 'select';
}
function preview(point: Point2) {
  cursor = point;
  if (!command || command.step !== 'destination' || !command.base) return;
  if (command.target === 'entities' && command.originalNodes) {
    const movingIds = new Set(command.originalNodes.map(node => node.id));
    const target = snap(point, id => !movingIds.has(id));
    const angle = command.kind === 'rotate'
      ? Math.atan2(target.y - command.base.y, target.x - command.base.x) - command.reference!
      : 0;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const dx = target.x - command.base.x, dy = target.y - command.base.y;
    const positions = new Map<number, Node>();
    for (const original of command.originalNodes) {
      const projected = to2D(uiStore.drawPlane2D, original.x, original.y, original.z ?? 0);
      const u = command.kind === 'move'
        ? projected.x + dx
        : command.base.x + (projected.x - command.base.x) * cos - (projected.y - command.base.y) * sin;
      const v = command.kind === 'move'
        ? projected.y + dy
        : command.base.y + (projected.x - command.base.x) * sin + (projected.y - command.base.y) * cos;
      positions.set(original.id, { id: original.id, ...to3D(uiStore.drawPlane2D, u, v, original) });
    }
    command.nodePreview = positions;
    modelStore.previewNodeTransform(positions);
    return;
  }
  if (command.id === undefined) return;
  const b = modelStore.blocks.instances.find(b => b.id === command!.id); if (!b) { cancel(); return; }
  if (command.kind === 'move') {
    const target = snap(point, id => modelStore.blockForNode(id)?.id !== b.id);
    command.gripTarget = target;
    command.pose = { x: b.x + target.x - command.base.x, y: b.y + target.y - command.base.y, angle: b.angle };
  } else {
    const p = snap(point);
    const angle = Math.atan2(p.y - command.base.y, p.x - command.base.x) - command.reference!;
    const origin = localToWorld({ x: b.x - command.base.x, y: b.y - command.base.y }, { ...command.base, angle });
    command.pose = { ...origin, angle: b.angle + angle };
  }
  modelStore.previewBlock(b.id, command.pose,
    command.kind === 'move' ? { source: command.base, target: command.gripTarget! } : undefined);
}
function nextDefaultBlockName(): string {
  const existingNames = new Set(modelStore.blocks.instances.map(b => b.name));
  let num = 1;
  while (existingNames.has(`블록 ${num}`)) {
    num++;
  }
  return `블록 ${num}`;
}

function click(point: Point2): boolean {
  if (!command) return false;
  if (command.step === 'select') {
    const node = uiStore.selectsKind('nodes')
      ? baseNodeAt(point)
      : null;
    const elementId = !node && uiStore.selectsKind('elements') ? baseElementAt(point) : null;
    if (node || elementId !== null) {
      selected = null;
      if (node) uiStore.selectNode(node.id);
      else uiStore.selectElement(elementId!);
      command.target = 'entities';
      command.originalNodes = selectedTransformNodes();
      command.step = 'base';
    } else {
      const id = instanceAt(point);
      if (id !== null) { selected = id; command.id = id; command.target = 'block'; command.step = 'base'; }
    }
  } else if (command.step === 'base') {
    const transformIds = new Set(command.originalNodes?.map(node => node.id) ?? []);
    const n = nearest(point, command.target === 'entities'
      ? id => transformIds.has(id)
      : command.kind === 'move' ? id => modelStore.blockForNode(id)?.id === command!.id : undefined);
    command.base = n ?? uiStore.snapWorld(point.x, point.y);
    command.source = n?.id;
    if (command.kind === 'create') {
      const defaultName = nextDefaultBlockName();
      try {
        select(modelStore.createBlock(command.elements!, command.nodes!, command.base!, defaultName));
      } catch (e) {
        uiStore.toast(String(e instanceof Error ? e.message : e), 'error');
      }
      cancel();
      return true;
    }
    command.step = command.kind === 'rotate' ? 'reference' : 'destination';
  } else if (command.step === 'reference') {
    const p = snap(point);
    if (Math.hypot(p.x - command.base!.x, p.y - command.base!.y) < 1e-9) return true;
    command.reference = Math.atan2(p.y - command.base!.y, p.x - command.base!.x); command.step = 'destination';
  } else if (command.step === 'destination') {
    preview(point);
    if (command.target === 'entities') {
      const positions = command.nodePreview;
      const originals = command.originalNodes ?? [];
      const changed = positions && originals.some(original => {
        const next = positions.get(original.id);
        return next && (Math.abs(next.x - original.x) > 1e-10 || Math.abs(next.y - original.y) > 1e-10 || Math.abs((next.z ?? 0) - (original.z ?? 0)) > 1e-10);
      });
      modelStore.previewNodeTransform(null);
      if (positions && changed) {
        historyStore.pushState();
        modelStore.updateNodesConstrained(positions);
        resultsStore.clear();
      }
      cancel();
      return true;
    }
    const target = nearest(point, id => modelStore.blockForNode(id)?.id !== command!.id);
    const pin = command.kind === 'move' && command.source !== undefined && target ? { source: command.source, target: target.id } : undefined;
    modelStore.placeBlock(command.id!, command.pose!, pin,
      command.kind === 'move' && command.base && command.gripTarget
        ? { source: command.base, target: command.gripTarget } : undefined); cancel();
  }
  return true;
}
export const blockUI = {
  get selected() { return selected; }, get command() { return command; }, get context() { return context; }, get cursor() { return cursor; },
  get hint() {
    if (!command) return '';
    return ({ select: '이동하거나 회전할 절점, 요소 또는 블록을 선택하세요', base: command.kind === 'rotate' ? '회전 중심을 선택하세요' : '기준점을 선택하세요', reference: '두 번째 기준점을 선택하세요', destination: '마우스로 배치한 뒤 클릭하세요 · Esc 취소', name: '블록 이름을 입력하세요' })[command.step];
  },
  select, begin, cancel, preview, click, instanceAt,
  openContext(id: number, x: number, y: number) { select(id); context = { id, x, y }; },
  closeContext() { context = null; },
  moveNodeTo(nodeId: number, point: Point2) {
    if (modelStore.editingBlockId !== null) return false;
    const block = modelStore.blockForNode(nodeId);
    const node = modelStore.getNode(nodeId);
    if (!block || !node || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
    const dx = point.x - node.x, dy = point.y - node.y;
    if (Math.abs(dx) <= 1e-10 && Math.abs(dy) <= 1e-10) return true;
    modelStore.placeBlock(block.id, { x: block.x + dx, y: block.y + dy, angle: block.angle },
      undefined, { source: { x: node.x, y: node.y }, target: point });
    resultsStore.clear();
    return true;
  },
  create(name: string) {
    if (command?.kind !== 'create' || command.step !== 'name') return;
    try { select(modelStore.createBlock(command.elements!, command.nodes!, command.base!, name)); cancel(); }
    catch (e) { uiStore.toast(String(e instanceof Error ? e.message : e), 'error'); cancel(); }
  },
  duplicate(id: number) { const newId = modelStore.duplicateBlock(id); if (newId !== null) { select(newId); begin('move', newId); } },
  edit(id: number) { cancel(); select(id); uiStore.editingNodeId = null; uiStore.editingElementId = null; uiStore.currentTool = 'select'; modelStore.beginBlockEdit(id); resultsStore.clear(); },
  finish(commit: boolean) {
    const removed = modelStore.finishBlockEdit(commit); uiStore.clearSelection(); uiStore.currentTool = 'select';
    uiStore.editingNodeId = null; uiStore.editingElementId = null;
    if (removed && (removed.joints || removed.loads || removed.supports)) uiStore.toast(`연결 ${removed.joints}개, 하중 ${removed.loads}개, 지점 ${removed.supports}개 해제됨`, 'info');
  },
  localCursor(point: Point2) { const b = modelStore.blocks.instances.find(b => b.id === modelStore.editingBlockId); return b ? worldToLocal(point, b) : point; },
};
