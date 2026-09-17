import { localToWorld, resolveNodeRef, type Blocks } from './blocks';
import type { ModelSnapshot } from '../store/history.svelte';

/** Files are untrusted. Reject broken definitions/mappings before restoring any store. */
export function validateBlocks(snapshot: ModelSnapshot): boolean {
  try {
    const b = snapshot.blocks as Blocks;
    if (!b || !Array.isArray(b.definitions) || !Array.isArray(b.instances) || !Array.isArray(b.joints) || !Number.isSafeInteger(b.nextId)) return false;
    const nodes = new Map(snapshot.nodes), elements = new Map(snapshot.elements);
    const usedNodes = new Set<number>(), usedElements = new Set<number>();
    const instanceIds = new Set<number>(), definitionIds = new Set<number>(), jointIds = new Set<number>();
    const validId = (id: number) => Number.isSafeInteger(id) && id > 0;
    for (const d of b.definitions) {
      if (!validId(d.id) || definitionIds.has(d.id) || !Array.isArray(d.nodes) || !Array.isArray(d.elements) || 'loads' in d || 'supports' in d) return false;
      definitionIds.add(d.id);
      const localNodes = new Set(d.nodes.map(n => n.id)), localElements = new Set(d.elements.map(e => e.id));
      if (localNodes.size !== d.nodes.length || localElements.size !== d.elements.length) return false;
      if (d.nodes.some(n => !validId(n.id) || !Number.isFinite(n.x) || !Number.isFinite(n.y) || (n.z !== undefined && n.z !== 0))) return false;
      if (d.elements.some(e => !validId(e.id) || !localNodes.has(e.nodeI) || !localNodes.has(e.nodeJ) || !e.releaseI || !e.releaseJ || !snapshot.materials.some(([id]) => id === e.materialId) || !snapshot.sections.some(([id]) => id === e.sectionId))) return false;
    }
    for (const instance of b.instances) {
      if (!validId(instance.id) || instanceIds.has(instance.id) || ![instance.x, instance.y, instance.angle].every(Number.isFinite) || typeof instance.name !== 'string' || typeof instance.visible !== 'boolean' || !/^#[0-9a-f]{6}$/i.test(instance.color)) return false;
      instanceIds.add(instance.id);
      const d = b.definitions.find(d => d.id === instance.definitionId);
      if (!d || Object.keys(instance.nodeIds).length !== d.nodes.length || Object.keys(instance.elementIds).length !== d.elements.length) return false;
      for (const n of d.nodes) {
        const id = instance.nodeIds[n.id], world = nodes.get(id), expected = localToWorld(n, instance);
        if (!validId(id) || usedNodes.has(id) || !world || Math.hypot(world.x - expected.x, world.y - expected.y) > 1e-6) return false;
        usedNodes.add(id);
      }
      for (const e of d.elements) {
        const id = instance.elementIds[e.id], world = elements.get(id);
        if (!validId(id) || usedElements.has(id) || !world || world.nodeI !== instance.nodeIds[e.nodeI] || world.nodeJ !== instance.nodeIds[e.nodeJ]) return false;
        usedElements.add(id);
      }
    }
    for (const j of b.joints) {
      if (!validId(j.id) || jointIds.has(j.id) || !['pin', 'continuous'].includes(j.kind)) return false;
      jointIds.add(j.id);
      if (![j.a, j.b].every(r => r && (r.kind === 'base' || r.kind === 'block'))) return false;
      const a = resolveNodeRef(b, j.a), z = resolveNodeRef(b, j.b);
      if (a === undefined || z === undefined || a === z || !nodes.has(a) || !nodes.has(z)) return false;
      const na = nodes.get(a)!, nz = nodes.get(z)!;
      if (Math.hypot(na.x - nz.x, na.y - nz.y) > 1e-7) return false;
    }
    return b.nextId > Math.max(0, ...instanceIds, ...definitionIds, ...jointIds);
  } catch { return false; }
}
