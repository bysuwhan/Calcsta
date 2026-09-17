// URL sharing: compress/decompress model snapshots for sharing via URL hash
// v1: LZ-String (legacy, still decoded for old links)
// v2: compact JSON + fflate deflate + base64url (new default)

import { validateBlocks } from '../model/block-validation';
import { emptyBlocks } from '../model/blocks';
import { deflateSync, inflateSync } from 'fflate';
import type { ModelSnapshot } from '../store/history.svelte';
import type { DiagramType } from '../store/results.svelte';
import { modelStore } from '../store/model.svelte';
import { NO_RELEASE, type Release } from '../store/model.svelte';
import { uiStore } from '../store/ui.svelte';
import { resultsStore } from '../store/results.svelte';
import { isBasic2DConstraint, isBasic2DLoad, isBasic2DSupport, sanitizeBasicSnapshot } from '../store/file';
import { t } from '../i18n';

const SHARE_VERSION = 5;

function packRelease(r: Release | undefined): Record<string, unknown> | undefined {
  if (!r) return undefined;
  const out: Record<string, unknown> = {};
  if (r.my) out.my = true;
  if (r.mz) out.mz = true;
  if (r.t) out.t = true;
  // 2D sliding joint (translational release) — carry the kind + axis frame so a
  // shared sliding-joint model isn't silently rebuilt as rigid.
  if (r.slide) out.s = r.slide;
  if (r.slideAxis) out.sa = r.slideAxis;
  return Object.keys(out).length > 0 ? out : undefined;
}

function unpackRelease(packed: unknown): Release {
  const r: Release = { ...NO_RELEASE };
  if (packed && typeof packed === 'object') {
    const p = packed as Record<string, unknown>;
    if (p.my) r.my = true;
    if (p.mz) r.mz = true;
    if (p.t) r.t = true;
    if (p.s) r.slide = p.s as Release['slide'];
    if (p.sa) r.slideAxis = p.sa as Release['slideAxis'];
  }
  return r;
}

const MAX_URL_SAFE = 2000; // Characters — beyond this, many browsers/servers truncate

// ─── v2 format prefix ─────────────────────────────────────────────────────
// v2 compressed strings start with "2." so we can tell them apart from v1
const V2_PREFIX = '2.';

// ─── ShareMeta defaults ───────────────────────────────────────────────────
// Only non-default values are serialized → smaller payloads
const META_DEFAULTS: Record<string, unknown> = {
  diagramType: 'none',
  deformedScale: 100,
  diagramScale: 1,
  showDiagramValues: true,
  autoSolve: false,
  showGrid: true,
  gridSize: 1,
  snapToGrid: true,
  showNodeLabels: false,
  showElementLabels: false,
  showLengths: false,
  elementColorMode: 'uniform',
  showLoads: true,
  hideLoadsWithDiagram: true,
  showAxes: true,
  includeSelfWeight: false,
  liveCalc: false,
};

/** Metadata saved alongside the model to restore the exact view state */
export interface ShareMeta {
  diagramType?: DiagramType;
  deformedScale?: number;
  diagramScale?: number;
  autoSolve?: boolean;
  // 2D config
  showGrid?: boolean;
  gridSize?: number;
  snapToGrid?: boolean;
  showNodeLabels?: boolean;
  showElementLabels?: boolean;
  showLengths?: boolean;
  elementColorMode?: string;
  showLoads?: boolean;
  hideLoadsWithDiagram?: boolean;
  showAxes?: boolean;
  showDiagramValues?: boolean;
  // Self-weight
  includeSelfWeight?: boolean;
  // Live calc
  liveCalc?: boolean;
  // Viewport state (2D)
  zoom?: number;
  panX?: number;
  panY?: number;
}

// ─── Base64-URL helpers ───────────────────────────────────────────────────
function uint8ToBase64url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlToUint8(str: string): Uint8Array {
  // Restore standard base64
  let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ─── Round numbers to reduce JSON noise ───────────────────────────────────
function r(n: number, decimals = 6): number {
  if (Number.isInteger(n)) return n;
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}

// ─── v2 compact serialization ─────────────────────────────────────────────
// Converts verbose ModelSnapshot+ShareMeta into a compact object with short keys
// and positional arrays instead of key-value objects.

function toCompact(input: ModelSnapshot, meta?: ShareMeta): Record<string, unknown> {
  const snapshot = sanitizeBasicSnapshot(input);
  const c: Record<string, unknown> = {};

  if (snapshot.name) c.nm = snapshot.name;
  // Nodes: [[id, x, y, z?], ...]  (z omitted when undefined/0 in 2D)
  c.n = snapshot.nodes.map(([, v]) => {
    const arr: number[] = [v.id, r(v.x), r(v.y)];
    if (v.z !== undefined && v.z !== 0) arr.push(r(v.z));
    return arr;
  });

  // Materials: [[id, name, e, nu, rho, fy?], ...]
  c.mt = snapshot.materials.map(([, v]) => {
    const arr: (string | number)[] = [v.id, v.name, r(v.e), r(v.nu), r(v.rho)];
    if ((v as any).fy != null) arr.push(r((v as any).fy));
    return arr;
  });

  // Schema version: 4 = typed per-axis releases (`ri`/`rj`) on elements.
  // 3 = legacy `hs`/`he` booleans + iy/iz section convention. 4 keeps the iy/iz convention.
  c.sv = SHARE_VERSION;
  c.bl = snapshot.blocks ?? emptyBlocks();

  // Sections: [[id, name, a, iz, {s?, b?, h?, w?, f?, t?, iy?, j?}], ...]
  c.sc = snapshot.sections.map(([, v]) => {
    const base: (string | number)[] = [v.id, v.name, r(v.a), r(v.iz)];
    const opt: Record<string, number | string> = {};
    if (v.shape) opt.s = v.shape;
    if (v.b != null) opt.b = r(v.b);
    if (v.h != null) opt.h = r(v.h);
    if (v.tw != null) opt.w = r(v.tw);
    if (v.tf != null) opt.f = r(v.tf);
    if (v.t != null) opt.t = r(v.t);
    if (v.iy != null) opt.iy = r(v.iy);
    if (v.j != null) opt.j = r(v.j);
    if ((v as any).rotation) opt.rot = r((v as any).rotation);
    if (Object.keys(opt).length > 0) base.push(opt as any);
    return base;
  });

  // Elements: [[id, type(0=frame/1=truss), nodeI, nodeJ, matId, secId, flags?], ...]
  c.e = snapshot.elements.map(([, v]) => {
    const arr: (number | Record<string, unknown>)[] = [
      v.id, v.type === 'truss' ? 1 : 0, v.nodeI, v.nodeJ, v.materialId, v.sectionId,
    ];
    const opt: Record<string, unknown> = {};
    const ri = packRelease(v.releaseI);
    const rj = packRelease(v.releaseJ);
    if (ri) opt.ri = ri;
    if (rj) opt.rj = rj;
    const off = (v as any).offset;
    if (off && (off.i || off.j)) {
      const enc: Record<string, unknown> = { f: off.frame === 'local' ? 'l' : 'g' };
      if (off.i) enc.i = [r(off.i.x), r(off.i.y)];
      if (off.j) enc.j = [r(off.j.x), r(off.j.y)];
      opt.of = enc;
    }
    if (Object.keys(opt).length > 0) arr.push(opt);
    return arr;
  });

  // Supports: [[id, nodeId, type, opts?], ...]
  c.s = snapshot.supports.map(([, v]) => {
    const arr: (number | string | Record<string, unknown>)[] = [v.id, v.nodeId, v.type];
    const opt: Record<string, unknown> = {};
    if (v.angle) opt.a = r(v.angle);
    if (v.isGlobal) opt.g = true;
    if (v.kx) opt.kx = r(v.kx);
    if (v.ky) opt.ky = r(v.ky);
    if (v.kz) opt.kz = r(v.kz);
    if (v.dx) opt.dx = r(v.dx);
    if (v.dy) opt.dy = r(v.dy);
    if (v.drz) opt.rz = r(v.drz);
    if (v.dz) opt.dz = r(v.dz);
    if (v.drx) opt.rx = r(v.drx);
    if (v.dry) opt.ry = r(v.dry);
    if (v.krx) opt.Rx = r(v.krx);
    if (v.kry) opt.Ry = r(v.kry);
    if (v.krz) opt.Rz = r(v.krz);
    if (Object.keys(opt).length > 0) arr.push(opt);
    return arr;
  });

  // Loads: kept as-is (already compact-ish, type+data varies widely)
  c.l = snapshot.loads;

  // Load cases
  if (snapshot.loadCases?.length) c.lc = snapshot.loadCases;
  // Combinations
  if (snapshot.combinations?.length) c.co = snapshot.combinations;

  // Plates: [[id, [n1,n2,n3], matId, thickness, shellFamily?, offset?], ...]
  // Slot 4 is the family string (or 0 when absent but an offset follows);
  // slot 5 is a compact offset [frame, x, y, z]. Decode disambiguates by type.
  const encShellOffset = (v: any): unknown[] | null => {
    const o = v.offset;
    return o ? [o.frame === 'local' ? 'l' : 'g', r(o.x), r(o.y), r(o.z)] : null;
  };
  if (snapshot.plates?.length) {
    c.pl = snapshot.plates.map(([, v]) => {
      const arr: unknown[] = [v.id, v.nodes, v.materialId, r(v.thickness)];
      const off = encShellOffset(v);
      if (off) { arr.push((v as any).shellFamily ?? 0); arr.push(off); }
      else if ((v as any).shellFamily) arr.push((v as any).shellFamily);
      return arr;
    });
  }

  // Quads: [[id, [n1,n2,n3,n4], matId, thickness, shellFamily?, offset?], ...]
  if (snapshot.quads?.length) {
    c.qu = snapshot.quads.map(([, v]) => {
      const arr: unknown[] = [v.id, v.nodes, v.materialId, r(v.thickness)];
      const off = encShellOffset(v);
      if (off) { arr.push((v as any).shellFamily ?? 0); arr.push(off); }
      else if ((v as any).shellFamily) arr.push((v as any).shellFamily);
      return arr;
    });
  }

  // Constraints: kept as-is (already compact, type+data varies by variant)
  if (snapshot.constraints?.length) {
    c.cn = snapshot.constraints;
  }

  // Connectors (joint/spring/bearing primitives): kept as-is, [id, payload] entries
  if (snapshot.connectors?.length) {
    c.cx = snapshot.connectors;
  }

  // Footings and the ground they bear on: kept verbatim, like connectors. Both travel
  // together on purpose — a shared footing without its soil profile is a foundation whose
  // bearing check cannot run, which is worse than not sharing it at all.
  if (snapshot.footings?.length) c.fo = snapshot.footings;
  if (snapshot.geotechnical?.profiles.length) c.gt = snapshot.geotechnical;
  // Bottom-mat preferences ride with the footings for the same reason the soil does: they set
  // the effective depth every footing in the link was designed at, so a shared project without
  // them would reopen designed to a different mat than the one that was shared. Emitted only
  // when a footing exists — a link with no foundation has nothing to state a mat about.
  if (snapshot.footings?.length && snapshot.footingMatPreferences) {
    c.fm = snapshot.footingMatPreferences;
  }

  // Provenance (CAD-draft "unreviewed" tag + assumptions): kept verbatim so the
  // honesty badge survives URL share/embed — the one persistence path that
  // crosses a trust boundary. Small structured object; deflate handles the size.
  if (snapshot.provenance) c.pv = snapshot.provenance;

  // NextId: [node, mat, sec, elem, sup, load, loadCase?, combination?, plate?, quad?,
  //          connector?, footing?, soilProfile?]
  // Appended at the END so a link shared before footings existed still decodes: the
  // missing trailing slots read as undefined and fall back.
  const nid = snapshot.nextId;
  c.ni = [nid.node, nid.material, nid.section, nid.element, nid.support, nid.load,
    nid.loadCase ?? 3, nid.combination ?? 1, nid.plate ?? 1, nid.quad ?? 1, nid.connector ?? 1,
    nid.footing ?? 1, nid.soilProfile ?? 1];

  // ShareMeta: only non-default values
  if (meta) {
    const sm: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(meta)) {
      if (val !== META_DEFAULTS[key]) {
        sm[key] = val;
      }
    }
    if (Object.keys(sm).length > 0) c._ = sm;
  }

  return c;
}

function fromCompact(c: Record<string, unknown>): ModelSnapshot {
  const snapshot: ModelSnapshot = {
    blocks: c.bl as ModelSnapshot['blocks'],
    // Legacy links carried `m`; retain it only long enough for the 2D gate below.
    analysisMode: c.m as '2d' | '3d' | 'pro' | undefined,
    name: c.nm as string | undefined,

    // Nodes
    nodes: (c.n as number[][]).map(a => [a[0], { id: a[0], x: a[1], y: a[2], ...(a[3] !== undefined ? { z: a[3] } : {}) }]),

    // Materials
    materials: (c.mt as (string | number)[][]).map(a => [
      a[0] as number,
      { id: a[0] as number, name: a[1] as string, e: a[2] as number, nu: a[3] as number, rho: a[4] as number, ...(a[5] != null ? { fy: a[5] as number } : {}) },
    ]),

    // Sections — handle iy/iz convention migration
    // sv=3: new convention (iz = about Z vertical, iy = about Y horizontal)
    // no sv: old convention (iz was about Y / large, iy was about Z / small) → swap
    sections: (c.sc as any[]).map(a => {
      const opt = typeof a[4] === 'object' ? a[4] : {};
      const isNewConvention = (c.sv as number) >= 3;

      let iz: number, iy: number | undefined;
      if (isNewConvention) {
        iz = a[3]; // about Z vertical (new convention)
        iy = opt.iy ?? undefined; // about Y horizontal
      } else {
        // Old convention: a[3] was the large (about Y) value, opt.iy was the small (about Z) value
        iy = a[3]; // old iz → now iy (about Y horizontal)
        iz = opt.iy ?? a[3]; // old iy → now iz (about Z vertical); fallback to same value
      }

      return [a[0], {
        id: a[0], name: a[1], a: a[2], iz,
        ...(opt.s ? { shape: opt.s } : {}),
        ...(opt.b != null ? { b: opt.b } : {}),
        ...(opt.h != null ? { h: opt.h } : {}),
        ...(opt.w != null ? { tw: opt.w } : {}),
        ...(opt.f != null ? { tf: opt.f } : {}),
        ...(opt.t != null ? { t: opt.t } : {}),
        ...(iy != null ? { iy } : {}),
        ...(opt.j != null ? { j: opt.j } : {}),
        ...(opt.rot != null ? { rotation: opt.rot } : {}),
      }];
    }),

    // Elements — sv ≥ 4 carries typed releases (`ri`/`rj`); sv ≤ 3 carries legacy `hs`/`he`
    // booleans which migrate to releaseI.mz / releaseJ.mz.
    elements: (c.e as any[]).map(a => {
      const opt = typeof a[6] === 'object' ? a[6] : {};
      const sv = (c.sv as number | undefined) ?? 0;
      const releaseI: Release = sv >= 4 ? unpackRelease(opt.ri) : { ...NO_RELEASE, mz: opt.hs === true };
      const releaseJ: Release = sv >= 4 ? unpackRelease(opt.rj) : { ...NO_RELEASE, mz: opt.he === true };
      return [a[0], {
        id: a[0], type: a[1] === 1 ? 'truss' : 'frame', nodeI: a[2], nodeJ: a[3],
        materialId: a[4], sectionId: a[5],
        releaseI, releaseJ,
        ...(opt.of ? { offset: {
          frame: opt.of.f === 'l' ? 'local' : 'global',
          ...(opt.of.i ? { i: { x: opt.of.i[0], y: opt.of.i[1], z: 0 } } : {}),
          ...(opt.of.j ? { j: { x: opt.of.j[0], y: opt.of.j[1], z: 0 } } : {}),
        } } : {}),
      }];
    }),

    // Supports
    supports: (c.s as any[]).map(a => {
      const opt = typeof a[3] === 'object' ? a[3] : {};
      return [a[0], {
        id: a[0], nodeId: a[1], type: a[2],
        ...(opt.a ? { angle: opt.a } : {}),
        ...(opt.g ? { isGlobal: true } : {}),
        ...(opt.kx ? { kx: opt.kx } : {}),
        ...(opt.ky ? { ky: opt.ky } : {}),
        ...(opt.kz ? { kz: opt.kz } : {}),
        ...(opt.dx ? { dx: opt.dx } : {}),
        ...(opt.dy ? { dy: opt.dy } : {}),
        ...(opt.rz ? { drz: opt.rz } : {}),
        ...(opt.dz ? { dz: opt.dz } : {}),
        ...(opt.rx ? { drx: opt.rx } : {}),
        ...(opt.ry ? { dry: opt.ry } : {}),
        ...(opt.Rx ? { krx: opt.Rx } : {}),
        ...(opt.Ry ? { kry: opt.Ry } : {}),
        ...(opt.Rz ? { krz: opt.Rz } : {}),
      }];
    }),

    // Loads
    loads: c.l as ModelSnapshot['loads'],

    // Load cases & combinations
    loadCases: c.lc as ModelSnapshot['loadCases'],
    combinations: c.co as ModelSnapshot['combinations'],

    // Planar constraints used by sliding joints/member offsets.
    constraints: c.cn as ModelSnapshot['constraints'],

    // Plates (a[4] = family string when truthy; a[5] = offset [f,x,y,z])
    // Provenance (CAD-draft tag) — undefined for ordinary models
    provenance: c.pv as ModelSnapshot['provenance'],

    // NextId
    nextId: (() => {
      const a = c.ni as number[];
      return { node: a[0], material: a[1], section: a[2], element: a[3], support: a[4], load: a[5], loadCase: a[6], combination: a[7] };
    })(),
  };

  // Restore ShareMeta from compact format
  const sm = c._ as Record<string, unknown> | undefined;
  if (sm) {
    const meta: Record<string, unknown> = { ...META_DEFAULTS };
    for (const [key, val] of Object.entries(sm)) {
      meta[key] = val;
    }
    (snapshot as any)._shareMeta = meta;
  }

  return snapshot;
}

// ─── v2 compress/decompress ───────────────────────────────────────────────

function compressV2(snapshot: ModelSnapshot, meta?: ShareMeta): string {
  const compact = toCompact(snapshot, meta);
  const json = JSON.stringify(compact);
  const bytes = new TextEncoder().encode(json);
  const deflated = deflateSync(bytes, { level: 9 });
  return V2_PREFIX + uint8ToBase64url(deflated);
}

function decompressV2(data: string): ModelSnapshot | null {
  try {
    const b64 = data.slice(V2_PREFIX.length);
    const deflated = base64urlToUint8(b64);
    const bytes = inflateSync(deflated);
    const json = new TextDecoder().decode(bytes);
    const compact = JSON.parse(json) as Record<string, any>;
    if (compact.sv !== SHARE_VERSION) return null;
    // Reject removed product payloads before decoding them into a partial 2D
    // snapshot. Silently dropping a shell/connector would change the model.
    if (compact.m !== undefined && compact.m !== '2d') return null;
    for (const key of ['pl', 'qu', 'cx', 'fo', 'gt', 'fm', 'lx']) {
      if (compact[key] !== undefined && Array.isArray(compact[key]) && compact[key].length > 0) return null;
      if (compact[key] !== undefined && !Array.isArray(compact[key])) return null;
    }
    if (compact.cn !== undefined && (!Array.isArray(compact.cn) || compact.cn.some((constraint: unknown) => !isBasic2DConstraint(constraint)))) return null;
    if (Array.isArray(compact.n) && compact.n.some((n: unknown) => Array.isArray(n) && n.length > 3 && Number(n[3]) !== 0)) return null;
    if (Array.isArray(compact.e) && compact.e.some((e: unknown) => Array.isArray(e) && e[6] && typeof e[6] === 'object' && ['ji', 'jj', 'lx', 'ly', 'lz', 'ra'].some(k => (e[6] as any)[k] !== undefined))) return null;
    const snapshot = fromCompact(compact);
    return isValidBasic2DSnapshot(snapshot) ? snapshot : null;
  } catch {
    return null;
  }
}

// ─── v1 (legacy LZ-String) ───────────────────────────────────────────────

/**
 * Compress a ModelSnapshot to a URL-safe string (v2 — fflate + base64url, sv:4).
 */
export function compressSnapshot(snapshot: ModelSnapshot): string {
  return compressV2(snapshot);
}

/**
 * Decompress a URL-safe string back to a ModelSnapshot.
 * Auto-detects v2 (prefix "2.") vs v1 (LZ-String) format.
 */
export function decompressSnapshot(data: string): ModelSnapshot | null {
  // v2 format
  if (data.startsWith(V2_PREFIX)) {
    return decompressV2(data);
  }
  return null;
}

// ─── Shared meta builder ──────────────────────────────────────────────────

function buildShareMeta(includeViewport: boolean): ShareMeta {
  const hasResults = resultsStore.results !== null;
  const meta: ShareMeta = {
    diagramType: resultsStore.diagramType,
    deformedScale: resultsStore.deformedScale,
    diagramScale: resultsStore.diagramScale,
    showDiagramValues: resultsStore.showDiagramValues,
    autoSolve: hasResults,
    showGrid: uiStore.showGrid,
    gridSize: uiStore.gridSize,
    snapToGrid: uiStore.snapToGrid,
    showNodeLabels: uiStore.showNodeLabels,
    showElementLabels: uiStore.showElementLabels,
    showLengths: uiStore.showLengths,
    elementColorMode: uiStore.elementColorMode,
    showLoads: uiStore.showLoads,
    hideLoadsWithDiagram: uiStore.hideLoadsWithDiagram,
    showAxes: uiStore.showAxes,
    includeSelfWeight: uiStore.includeSelfWeight,
    liveCalc: uiStore.liveCalc,
  };
  if (includeViewport) {
    meta.zoom = uiStore.zoom;
    meta.panX = uiStore.panX;
    meta.panY = uiStore.panY;
  }
  return meta;
}

// ─── Generate URLs ────────────────────────────────────────────────────────

/**
 * Generate a share URL with the current model compressed in the hash fragment.
 * Returns { url, length } or null if model is empty.
 */
export function generateShareURL(): { url: string; length: number } | null {
  const snapshot = modelStore.snapshot();
  if (snapshot.nodes.length === 0) return null;

  const meta = buildShareMeta(true);

  const compressed = compressV2(snapshot, meta);
  const url = `${location.origin}${location.pathname}#data=${compressed}`;
  return { url, length: compressed.length };
}

/**
 * Generate an embed URL (same as share but with #embed= prefix).
 */
export function generateEmbedURL(): { url: string; length: number } | null {
  const snapshot = modelStore.snapshot();
  if (snapshot.nodes.length === 0) return null;

  const meta = buildShareMeta(false);

  const compressed = compressV2(snapshot, meta);
  const url = `${location.origin}${location.pathname}#embed=${compressed}`;
  return { url, length: compressed.length };
}

// ─── Restore meta helper ──────────────────────────────────────────────────

function restoreMeta(snapshot: ModelSnapshot): void {
  const meta = (snapshot as any)._shareMeta as ShareMeta | undefined;
  if (!meta) return;

  // Results visualization
  if (meta.deformedScale !== undefined) resultsStore.deformedScale = meta.deformedScale;
  if (meta.diagramScale !== undefined) resultsStore.diagramScale = meta.diagramScale;
  if (meta.showDiagramValues !== undefined) resultsStore.showDiagramValues = meta.showDiagramValues;
  // 2D visualization config
  if (meta.showGrid !== undefined) uiStore.showGrid = meta.showGrid;
  if (meta.gridSize !== undefined) uiStore.gridSize = meta.gridSize;
  if (meta.snapToGrid !== undefined) uiStore.snapToGrid = meta.snapToGrid;
  if (meta.showNodeLabels !== undefined) uiStore.showNodeLabels = meta.showNodeLabels;
  if (meta.showElementLabels !== undefined) uiStore.showElementLabels = meta.showElementLabels;
  if (meta.showLengths !== undefined) uiStore.showLengths = meta.showLengths;
  if (meta.elementColorMode !== undefined) uiStore.elementColorMode = meta.elementColorMode as any;
  if (meta.showLoads !== undefined) uiStore.showLoads = meta.showLoads;
  if (meta.hideLoadsWithDiagram !== undefined) uiStore.hideLoadsWithDiagram = meta.hideLoadsWithDiagram;
  if (meta.showAxes !== undefined) uiStore.showAxes = meta.showAxes;
  // Other settings
  if (meta.includeSelfWeight !== undefined) uiStore.includeSelfWeight = meta.includeSelfWeight;
  if (meta.liveCalc !== undefined) uiStore.liveCalc = meta.liveCalc;
  // Viewport state
  if (meta.zoom !== undefined) uiStore.zoom = meta.zoom;
  if (meta.panX !== undefined) uiStore.panX = meta.panX;
  if (meta.panY !== undefined) uiStore.panY = meta.panY;
  // Diagram type + autoSolve
  if (meta.autoSolve) {
    uiStore.pendingSolveFromURL = meta.diagramType ?? 'deformed';
  } else if (meta.diagramType) {
    resultsStore.diagramType = meta.diagramType;
  }
}

// ─── Load from URL / link ─────────────────────────────────────────────────

function isLegacyEducationSnapshot(snapshot: unknown): boolean {
  if (!snapshot || typeof snapshot !== 'object') return false;
  const data = snapshot as {
    analysisMode?: string;
    appMode?: string;
    snapshot?: unknown;
    modelSnapshot?: unknown;
    tabs?: unknown[];
  };
  if (data.analysisMode === 'edu' || data.appMode === 'educativo') return true;
  if (isLegacyEducationSnapshot(data.snapshot) || isLegacyEducationSnapshot(data.modelSnapshot)) return true;
  return Array.isArray(data.tabs) && data.tabs.some(isLegacyEducationSnapshot);
}

function isValidBasic2DSnapshot(snapshot: ModelSnapshot): boolean {
  if (!validateBlocks(snapshot)) return false;
  if (!snapshot || !Array.isArray(snapshot.nodes) || !Array.isArray(snapshot.elements)
    || !Array.isArray(snapshot.materials) || !Array.isArray(snapshot.sections)
    || !Array.isArray(snapshot.supports) || !Array.isArray(snapshot.loads)) return false;
  const legacy = snapshot as ModelSnapshot & { appMode?: string };
  if (legacy.appMode !== undefined && legacy.appMode !== 'basico') return false;
  if (snapshot.analysisMode !== undefined && snapshot.analysisMode !== '2d') return false;
  if (snapshot.nodes.some(([, node]) => node.z !== undefined && node.z !== 0)) return false;
  for (const key of ['plates', 'quads', 'constraints', 'connectors', 'footings'] as const) {
    const values = snapshot[key];
    if (values !== undefined && !Array.isArray(values)) return false;
    if (key === 'constraints') {
      if (Array.isArray(values) && values.some((constraint) => !isBasic2DConstraint(constraint))) return false;
    } else if (Array.isArray(values) && values.length > 0) return false;
  }
  // Old Basic snapshots could carry empty foundation/detailing containers because
  // the former shell emitted them unconditionally.  They are harmless only when
  // empty; any populated value is removed-product data and invalidates the link.
  for (const key of ['geotechnical', 'detailing'] as const) {
    const value = (snapshot as unknown as Record<string, unknown>)[key];
    if (value === undefined) continue;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const entries = (value as Record<string, unknown>)[key === 'geotechnical' ? 'profiles' : 'assemblies'];
    if (!Array.isArray(entries) || entries.length > 0) return false;
  }
  if (snapshot.elements.some(([, element]) => {
    const e = element as unknown as Record<string, unknown>;
    if (e.jointI !== undefined || e.jointJ !== undefined) return true;
    if (['localYx', 'localYy', 'localYz', 'rollAngle'].some((key) => e[key] !== undefined && Number(e[key]) !== 0)) return true;
    const offset = e.offset as Record<string, unknown> | undefined;
    return ['i', 'j'].some((side) => {
      const vec = offset?.[side] as Record<string, unknown> | undefined;
      return vec?.z !== undefined && Number(vec.z) !== 0;
    });
  })) return false;
  if (snapshot.loads.some((load) => !isBasic2DLoad(load))) return false;
  return !snapshot.supports.some((entry) => !isBasic2DSupport(entry[1]));
}

function stripLegacy2DFields(snapshot: ModelSnapshot): void {
  for (const entry of snapshot.nodes) if (entry[1].z === 0) delete entry[1].z;
  delete (snapshot as any).analysisMode;
  delete (snapshot as any).appMode;
  delete (snapshot as any).localAxisConvention;
  // Keep the in-memory model on the same normalized contract as newly written
  // files.  Empty legacy containers are ignored; populated ones were rejected
  // by isValidBasic2DSnapshot before this function runs.
  for (const key of ['plates', 'quads', 'connectors', 'footings', 'geotechnical', 'detailing'] as const) {
    delete (snapshot as any)[key];
  }
  for (const [, element] of snapshot.elements) {
    const e = element as unknown as Record<string, any>;
    delete e.jointI;
    delete e.jointJ;
    for (const key of ['localYx', 'localYy', 'localYz', 'rollAngle']) delete e[key];
    if (e.offset && typeof e.offset === 'object') {
      for (const side of ['i', 'j']) if (e.offset[side] && typeof e.offset[side] === 'object') delete e.offset[side].z;
    }
  }
}

/**
 * Try to load a model from the current URL hash.
 * Returns 'data' | 'embed' | null depending on what was found.
 */
export function loadFromURLHash(): 'data' | 'embed' | null {
  const hash = location.hash;
  if (!hash) return null;

  let mode: 'data' | 'embed' | null = null;
  let compressed: string | null = null;

  if (hash.startsWith('#data=')) {
    mode = 'data';
    compressed = hash.slice(6);
  } else if (hash.startsWith('#embed=')) {
    mode = 'embed';
    compressed = hash.slice(7);
  }

  if (!mode || !compressed) return null;

  const snapshot = decompressSnapshot(compressed);
  if (!snapshot) return null;
  if (!isValidBasic2DSnapshot(snapshot)) return null;
  if (isLegacyEducationSnapshot(snapshot)) {
    uiStore.toast(t('file.unsupportedLegacyMode'), 'error');
    return null;
  }

  stripLegacy2DFields(snapshot);
  uiStore.analysisMode = '2d';
  modelStore.restore(snapshot);
  restoreMeta(snapshot);

  // Clean hash from URL without triggering navigation
  history.replaceState(null, '', location.pathname + location.search);

  return mode;
}

/**
 * Parse a share URL and return the compressed data portion (or null if invalid).
 * Accepts full URLs like "https://calcsta.pages.dev/#data=..." or just the hash "#data=..."
 */
export function parseShareURL(url: string): { compressed: string; mode: 'data' | 'embed' } | null {
  try {
    let hash: string;
    if (url.includes('#')) {
      hash = '#' + url.split('#')[1];
    } else {
      return null;
    }
    if (hash.startsWith('#data=')) {
      return { compressed: hash.slice(6), mode: 'data' };
    } else if (hash.startsWith('#embed=')) {
      return { compressed: hash.slice(7), mode: 'embed' };
    }
    return null;
  } catch {
    return null;
  }
}

/** Preflight a pasted link so a rejected legacy project cannot create a tab. */
export function shareLinkContainsLegacyEducationMode(url: string): boolean {
  const parsed = parseShareURL(url);
  if (!parsed) return false;
  return isLegacyEducationSnapshot(decompressSnapshot(parsed.compressed));
}

/** Validate a pasted link without changing the active model or tab state. */
export function isValidBasic2DShareLink(url: string): boolean {
  const parsed = parseShareURL(url);
  if (!parsed) return false;
  const snapshot = decompressSnapshot(parsed.compressed);
  return !!snapshot && isValidBasic2DSnapshot(snapshot) && !isLegacyEducationSnapshot(snapshot);
}

/**
 * Load a model from a share link string (for "Pegar enlace" — opens in current context).
 * Returns true if successfully loaded, false otherwise.
 */
export function loadFromShareLink(url: string): boolean {
  const parsed = parseShareURL(url);
  if (!parsed) return false;

  const snapshot = decompressSnapshot(parsed.compressed);
  if (!snapshot) return false;
  if (!isValidBasic2DSnapshot(snapshot)) return false;
  if (isLegacyEducationSnapshot(snapshot)) {
    uiStore.toast(t('file.unsupportedLegacyMode'), 'error');
    return false;
  }

  stripLegacy2DFields(snapshot);
  uiStore.analysisMode = '2d';
  modelStore.restore(snapshot);
  restoreMeta(snapshot);

  return true;
}

export { MAX_URL_SAFE };
