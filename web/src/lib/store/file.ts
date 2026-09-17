import { validateBlocks } from '../model/block-validation';
// File operations: save/load projects, export results, autosave

import { modelStore } from './model.svelte';
import { resultsStore } from './results.svelte';
import { historyStore } from './history.svelte';
import { uiStore } from './ui.svelte';
import type { ModelSnapshot } from './history.svelte';
import { NO_RELEASE, type Release } from './model.svelte';
import { exportToExcel } from '../export/excel';
import { tabManager } from './tabs.svelte';
import type { TabState } from './tabs.svelte';
import { t } from '../i18n';
import { plainDeepCopy, findUncloneablePath } from '../utils/plain-deep-copy';
import {
  LEGACY_AUTOSAVE_KEY,
  autosaveClear, autosaveRead, autosaveStatus, autosaveWrite,
  type AutosaveFingerprint, type AutosavePolicy, type AutosaveReadResult, type AutosaveWriteResult,
} from './autosave-db';
import {
  TWO_D_DISPLACEMENT_LABELS,
  TWO_D_REACTION_LABELS,
  TWO_D_VERTICAL_AXIS_LABEL,
  get2DDisplayDisplacementVertical,
  get2DDisplayMoment,
  get2DDisplayReactionVertical,
  get2DDisplayRotation,
  get2DDisplayedVertical,
} from '../geometry/coordinate-system';

// ─── File Format ────────────────────────────────────────────────

/**
 * v2.0: typed per-axis releases on elements (`releaseI`/`releaseJ`).
 * v1.0: legacy `hingeStart`/`hingeEnd` booleans — read-migrated on load, never written.
 * Unknown versions are rejected.
 */
export const DEDAL_FILE_VERSION = '3.0' as const;
const KNOWN_VERSIONS = new Set(['3.0']);

export interface DedalFile {
  version: typeof DEDAL_FILE_VERSION;
  name: string;
  timestamp: string;
  snapshot: ModelSnapshot;
  /** Legacy metadata accepted only when it describes the Basic 2D format. */
  appMode?: string;
  analysisMode?: string;
}

/** Migrate a snapshot in place: converts legacy hingeStart/hingeEnd → releaseI.mz/releaseJ.mz. */
export function migrateSnapshotV1ToV2(snapshot: Record<string, unknown>): void {
  const elements = snapshot.elements;
  if (!Array.isArray(elements)) return;
  for (const entry of elements as Array<[number, Record<string, unknown>]>) {
    const elem = entry[1];
    if (!elem) continue;
    const releaseI: Release = elem.releaseI as Release | undefined ?? { ...NO_RELEASE };
    const releaseJ: Release = elem.releaseJ as Release | undefined ?? { ...NO_RELEASE };
    if (elem.hingeStart === true) releaseI.mz = true;
    if (elem.hingeEnd === true) releaseJ.mz = true;
    elem.releaseI = releaseI;
    elem.releaseJ = releaseJ;
    delete elem.hingeStart;
    delete elem.hingeEnd;
  }
}

export interface DedalSessionFile {
  version: '2.0';
  type: 'session';
  timestamp: string;
  activeTabId: string;
  tabs: TabState[];
}

/** Detect removed Education metadata before any store or migration is touched. */
export function containsLegacyEducationMode(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  if (d.appMode === 'educativo' || d.analysisMode === 'edu') return true;
  const snapshot = d.snapshot;
  if (snapshot && typeof snapshot === 'object') {
    const item = snapshot as Record<string, unknown>;
    if (item.appMode === 'educativo' || item.analysisMode === 'edu') return true;
  }
  if (Array.isArray(d.tabs)) {
    return d.tabs.some((tab) => {
      if (!tab || typeof tab !== 'object') return false;
      const item = tab as Record<string, unknown>;
      if (item.appMode === 'educativo' || item.analysisMode === 'edu') return true;
      const tabSnapshot = item.modelSnapshot;
      if (!tabSnapshot || typeof tabSnapshot !== 'object') return false;
      const nested = tabSnapshot as Record<string, unknown>;
      return nested.appMode === 'educativo' || nested.analysisMode === 'edu';
    });
  }
  return false;
}

// ─── Download Helpers ───────────────────────────────────────────

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadText(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  downloadBlob(blob, filename);
}

// ─── Serialize / Deserialize ────────────────────────────────────

/**
 * The current project as a plain, structured-cloneable `DedalFile`.
 *
 * `plainDeepCopy` rather than trusting `modelStore.snapshot()` alone: the snapshot is built
 * with `$state.snapshot`, which is the right tool inside a component and is the IDENTITY
 * FUNCTION when the module is compiled for the server — so the "no reactive proxies" property
 * holds in the browser and evaporates under Vitest, which is where it is asserted. It also
 * matters more than it used to: `localStorage` took a string, so a proxy could only ever have
 * cost a slower `JSON.stringify`, whereas IndexedDB takes the object itself and structured
 * clone refuses a proxy outright with `DataCloneError`.
 */
export function buildProjectFile(): DedalFile {
  const snapshot = sanitizeBasicSnapshot(modelStore.snapshot());
  return plainDeepCopy<DedalFile>({
    version: DEDAL_FILE_VERSION,
    name: modelStore.model.name,
    timestamp: new Date().toISOString(),
    snapshot,
  });
}

/**
 * Project files, autosaves and share payloads are deliberately Basic-only.
 * The in-memory model still has a few compatibility slots for the standalone
 * engine, but none of those 3D presentation/spatial fields belong in a new
 * web-product artifact.
 */
export function sanitizeBasicSnapshot(input: ModelSnapshot): ModelSnapshot {
  const snapshot = plainDeepCopy<ModelSnapshot>(input);
  const raw = snapshot as Record<string, any>;
  delete raw.appMode;
  delete raw.analysisMode;
  delete raw.localAxisConvention;
  for (const key of ['plates', 'quads', 'connectors', 'footings', 'geotechnical', 'detailing']) {
    delete raw[key];
  }
  // Keep the small 2D constraint vocabulary used by member offsets and
  // sliding-joint expansion.  Spatial constraints are rejected by the
  // validator and are never silently flattened into a Basic file.
  if (Array.isArray(raw.constraints)) {
    const constraints = raw.constraints.filter(isBasic2DConstraint);
    if (constraints.length > 0) raw.constraints = constraints;
    else delete raw.constraints;
  } else {
    delete raw.constraints;
  }
  if (raw.nextId && typeof raw.nextId === 'object') {
    for (const key of ['plate', 'quad', 'connector', 'footing', 'soilProfile']) delete raw.nextId[key];
  }
  for (const entry of snapshot.nodes ?? []) {
    if (entry[1] && entry[1].z === 0) delete entry[1].z;
  }
  // Local-axis/roll metadata is a 3D presentation concern. Keep the
  // supported 2D member offset (x/y) but never persist its out-of-plane z.
  for (const [, element] of snapshot.elements ?? []) {
    const e = element as Record<string, any>;
    delete e.localYx;
    delete e.localYy;
    delete e.localYz;
    delete e.rollAngle;
    delete e.jointI;
    delete e.jointJ;
    if (e.offset && typeof e.offset === 'object') {
      for (const side of ['i', 'j']) {
        if (e.offset[side] && typeof e.offset[side] === 'object') delete e.offset[side].z;
      }
    }
  }
  // Keep only the planar support vocabulary.  The in-memory store still knows
  // about legacy 3D fields for engine compatibility, but they must never leak
  // into a new Basic artifact.
  for (const [, support] of snapshot.supports ?? []) {
    const s = support as Record<string, any>;
    for (const key of ['drx', 'krx', 'kry', 'krz', 'normalX', 'normalY', 'normalZ',
      'isInclined', 'dofRestraints', 'dofFrame', 'dofLocalElementId']) delete s[key];
  }
  // A saved Basic file contains only the four supported planar load kinds.
  // Invalid spatial loads are rejected on load; this filter only removes
  // compatibility padding from snapshots produced by the old store.
  snapshot.loads = (snapshot.loads ?? []).filter(isBasic2DLoad) as ModelSnapshot['loads'];
  return snapshot;
}

function sanitizeBasicTab(input: TabState): TabState {
  const tab = plainDeepCopy<TabState>(input);
  const raw = tab as Record<string, any>;
  delete raw.appMode;
  delete raw.analysisMode;
  delete raw.viewportPresentation3D;
  delete raw.cameraPosition3D;
  delete raw.cameraTarget3D;
  tab.modelSnapshot = sanitizeBasicSnapshot(tab.modelSnapshot);
  tab.undoStack = (tab.undoStack ?? []).map(sanitizeBasicSnapshot);
  tab.redoStack = (tab.redoStack ?? []).map(sanitizeBasicSnapshot);
  return tab;
}

/**
 * The project as a `.ded`, serialised COMPACT.
 *
 * ── What the indentation was costing ───────────────────────────────
 *
 * Measured on `pro-edificio-7p` after the whole chain — 203 members solved, designed, detailed,
 * floors designed, about 21 000 bars in the coordinated document:
 *
 *     JSON.stringify(payload, null, 2)   110 341 310 bytes    202 ms
 *     JSON.stringify(payload)             47 783 950 bytes     56 ms
 *
 * Sixty-two megabytes of a hundred-and-ten were spaces and newlines. A detailing document is
 * mostly deeply-nested arrays of numbers, and at that depth `null, 2` spends about twenty bytes
 * of indentation on every six-byte coordinate.
 *
 * ── Why this is safe ───────────────────────────────────────────────
 *
 * Whitespace is not part of the format. `deserializeProject` and `loadFile` both go through
 * `JSON.parse`, which does not care, and every `.ded` ever written — including the committed
 * `rc-footing-cad-poc.ded.json`, which stays pretty-printed on disk — still opens. The change is
 * one-directional and needs no migration: new files are smaller, old files are unaffected.
 *
 * One consequence worth knowing rather than discovering: regenerating that committed fixture
 * (`WRITE_FIXTURE=1`) now writes it on one line, because it is deliberately produced by this
 * same production writer.
 *
 * `saveSession` keeps its indentation. A session is a handful of tab records and is read by
 * people far more often than it is large.
 */
export function serializeProject(): string {
  return JSON.stringify(buildProjectFile());
}

/**
 * Pure deserializer for a single-tab .ded file. Parses, validates, migrates legacy
 * v1.0 snapshots into the typed-release shape, restores the model, and returns
 * `true` on success. Unknown/invalid payloads return `false` without mutating state.
 */
export function deserializeProject(text: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== 'object') return false;
  const d = parsed as Record<string, unknown>;
  if (containsLegacyEducationMode(d)) return false;
  if (typeof d.version !== 'string' || !KNOWN_VERSIONS.has(d.version)) return false;
  const snapshot = d.snapshot as Record<string, unknown> | undefined;
  if (!snapshot) return false;
  if (d.version === '1.0') migrateSnapshotV1ToV2(snapshot);
  if (!validateDedalFile({ ...d, version: DEDAL_FILE_VERSION })) return false;

  const data = plainDeepCopy(d) as unknown as DedalFile;
  // Normalize legacy Basic metadata and empty compatibility containers before
  // handing the snapshot to the reactive model store.  Validation above has
  // already rejected every populated spatial/3D value, so this is a lossless
  // cleanup rather than a conversion of an unsupported model.
  data.snapshot = sanitizeBasicSnapshot(data.snapshot);
  historyStore.pushState();
  modelStore.restore(data.snapshot);
  modelStore.model.name = data.name;
  uiStore.analysisMode = '2d';
  resultsStore.clear(); // stale results dropped — the model must be re-solved
  return true;
}

/**
 * Surface the one-time "loaded under the corrected local-axis convention" note
 * for a pre-metadata 3D/PRO model that carries members. Shared by EVERY load
 * path — .ded open, URL share, autosave restore, tab/session restore — so the
 * warning is not silently skipped on the non-.ded entry points (under the new
 * convention the model's member diagrams/checks change). 2D models are
 * unaffected. New models always carry localAxisConvention, so the note never
 * fires for them — provided every serializer round-trips the field (URL sharing
 * included, see url-sharing.ts).
 */
export function validateDedalFile(data: unknown): data is DedalFile {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;

  // The web product has one mode. Keep accepting old neutral metadata so Basic
  // files remain readable, but reject PRO/3D payloads before touching stores.
  if (d.appMode !== undefined && d.appMode !== 'basico') return false;
  if (d.analysisMode !== undefined && d.analysisMode !== '2d') return false;

  if (typeof d.version !== 'string' || !KNOWN_VERSIONS.has(d.version)) return false;
  if (typeof d.name !== 'string') return false;

  const s = d.snapshot as Record<string, unknown> | undefined;
  if (!s || !validateBlocks(s as unknown as ModelSnapshot)) return false;
  if (s.appMode !== undefined && s.appMode !== 'basico') return false;
  if (s.analysisMode !== undefined && s.analysisMode !== '2d') return false;
  if (!Array.isArray(s.nodes)) return false;
  if (!Array.isArray(s.elements)) return false;
  if (!Array.isArray(s.materials)) return false;
  if (!Array.isArray(s.sections)) return false;
  if (!Array.isArray(s.supports)) return false;
  if (!Array.isArray(s.loads)) return false;

  const spatialArrays = ['plates', 'quads', 'connectors', 'footings'];
  for (const key of spatialArrays) {
    if (s[key] !== undefined && !Array.isArray(s[key])) return false;
    if (Array.isArray(s[key]) && s[key].length > 0) return false;
  }
  // Legacy Basic snapshots may carry empty foundation/detailing containers
  // because the old store emitted them unconditionally. Any populated
  // container belongs to the removed PRO product and invalidates the payload.
  if (s.geotechnical !== undefined) {
    const geo = s.geotechnical as Record<string, unknown>;
    if (!geo || typeof geo !== 'object' || !Array.isArray(geo.profiles) || geo.profiles.length > 0) return false;
  }
  if (s.detailing !== undefined) {
    const detailing = s.detailing as Record<string, unknown>;
    if (!detailing || typeof detailing !== 'object' || !Array.isArray(detailing.assemblies) || detailing.assemblies.length > 0) return false;
  }
  if (s.constraints !== undefined) {
    if (!Array.isArray(s.constraints) || s.constraints.some((constraint) => !isBasic2DConstraint(constraint))) return false;
  }
  if ((s.loads as unknown[]).some((load) => {
    // Current loads are `{type,data}` objects; older snapshots also used
    // `[id,{type,data}]` tuples. Inspect both so a spatial load can never be
    // smuggled through the legacy representation.
    const candidate = Array.isArray(load) ? load[1] : load;
    if (!candidate || typeof candidate !== 'object') return false;
    const direct = (candidate as { type?: unknown }).type;
    const nested = (candidate as { data?: { type?: unknown } }).data?.type;
    return [direct, nested].some((kind) => typeof kind === 'string' && kind.toLowerCase().endsWith('3d'));
  })) return false;

  const nextId = s.nextId as Record<string, unknown> | undefined;
  if (!nextId || typeof nextId.node !== 'number') return false;

  // Verify referential integrity: element nodes exist
  const nodeIds = new Set<number>();
  for (const entry of s.nodes as unknown[]) {
    if (!Array.isArray(entry) || entry.length < 2 || typeof entry[0] !== 'number' || !entry[1] || typeof entry[1] !== 'object') return false;
    if (nodeIds.has(entry[0])) return false;
    nodeIds.add(entry[0]);
    const node = entry[1] as { z?: unknown };
    if (node.z !== undefined && node.z !== 0) return false;
  }
  for (const entries of [s.elements, s.materials, s.sections, s.supports] as unknown[][]) {
    const ids = new Set<number>();
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length < 2 || typeof entry[0] !== 'number' || ids.has(entry[0])) return false;
      ids.add(entry[0]);
    }
  }
  for (const entry of s.supports as unknown[]) {
    if (!Array.isArray(entry) || !entry[1] || typeof entry[1] !== 'object') return false;
    if (!isBasic2DSupport(entry[1])) return false;
  }
  if ((s.loads as unknown[]).some((load) => !isBasic2DLoad(load))) return false;
  for (const entry of s.elements as unknown[]) {
    if (!Array.isArray(entry) || entry.length < 2 || !entry[1] || typeof entry[1] !== 'object') return false;
    const elem = entry[1] as { nodeI?: unknown; nodeJ?: unknown };
    if (typeof elem.nodeI !== 'number' || typeof elem.nodeJ !== 'number') return false;
    if (!nodeIds.has(elem.nodeI) || !nodeIds.has(elem.nodeJ)) {
      return false;
    }
    if ((elem as any).jointI !== undefined || (elem as any).jointJ !== undefined) return false;
  }

  // 3D element metadata and out-of-plane offsets are not valid Basic input.
  for (const entry of s.elements as unknown[]) {
    const elem = (entry as [unknown, Record<string, any>])[1];
    for (const key of ['localYx', 'localYy', 'localYz', 'rollAngle']) {
      if (elem[key] !== undefined && Number(elem[key]) !== 0) return false;
    }
    const offset = elem.offset;
    if (offset && typeof offset === 'object') {
      for (const side of ['i', 'j']) {
        const vec = offset[side];
        if (vec && typeof vec === 'object' && vec.z !== undefined && Number(vec.z) !== 0) return false;
      }
    }
  }

  return true;
}

/** Constraints that have a genuine planar meaning in the Basic solver. */
export function isBasic2DConstraint(value: unknown): boolean {
  const candidate = Array.isArray(value) ? value[1] : value;
  if (!candidate || typeof candidate !== 'object') return false;
  const c = candidate as Record<string, any>;
  const kind = typeof c.type === 'string' ? c.type.toLowerCase() : '';
  if (kind === 'rigidlink' || kind === 'equaldof') {
    return c.dofs === undefined || (Array.isArray(c.dofs) && c.dofs.every((d: unknown) => Number.isInteger(d) && Number(d) >= 0 && Number(d) <= 2));
  }
  if (kind === 'linearmpc') {
    return Array.isArray(c.terms) && c.terms.length > 0
      && c.terms.every((term: any) => term && Number.isInteger(term.dof) && term.dof >= 0 && term.dof <= 2);
  }
  if (kind === 'eccentricconnection') {
    if (c.offsetZ !== undefined && Number(c.offsetZ) !== 0) return false;
    return c.releases === undefined || (Array.isArray(c.releases) && c.releases.length <= 3 && c.releases.every((released: unknown) => typeof released === 'boolean'));
  }
  return false;
}

/** True for one of the planar support types and no 3D-only support payload. */
export function isBasic2DSupport(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const support = value as Record<string, any>;
  const kind = typeof support.type === 'string' ? support.type.toLowerCase() : '';
  if (!new Set(['fixed', 'pinned', 'rollerx', 'rollery', 'rollerz', 'spring', 'inclinedroller']).has(kind)) return false;
  return !['drx', 'krx', 'kry', 'krz', 'normalX', 'normalY', 'normalZ',
    'isInclined', 'dofRestraints', 'dofFrame', 'dofLocalElementId'].some((key) => support[key] !== undefined);
}

/** True for a supported Basic 2D load (including legacy tuple/wrapper forms). */
export function isBasic2DLoad(value: unknown): boolean {
  const candidate = Array.isArray(value) ? value[1] : value;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
  const outer = candidate as Record<string, any>;
  const data = outer.data && typeof outer.data === 'object' && !Array.isArray(outer.data)
    ? outer.data as Record<string, any>
    : outer;
  const kind = typeof outer.type === 'string' ? outer.type.toLowerCase()
    : typeof data.type === 'string' ? data.type.toLowerCase() : '';
  if (!new Set(['nodal', 'distributed', 'pointonelement', 'cylinder']).has(kind)) return false;
  if (kind === 'nodal') return data.mx === undefined;
  if (kind === 'distributed') return data.qyi === undefined && data.qyj === undefined && data.qzi === undefined && data.qzj === undefined;
  if (kind === 'pointonelement') return data.py === undefined && data.pz === undefined;
  if (kind === 'cylinder') return Number.isFinite(data.nodeI) && Number.isFinite(data.nodeJ) && Number.isFinite(data.force);
  return false;
}

// ─── Save / Load ────────────────────────────────────────────────

export function saveProject(): void {
  const json = serializeProject();
  const safeName = modelStore.model.name.replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ _-]/g, '').trim() || t('file.defaultProject');
  downloadText(json, `${safeName}.ded`, 'application/json');
}

export async function loadProject(file: File): Promise<void> {
  const text = await file.text();
  try {
    if (containsLegacyEducationMode(JSON.parse(text))) {
      throw new Error(t('file.unsupportedLegacyMode'));
    }
  } catch (error) {
    if (error instanceof Error && error.message === t('file.unsupportedLegacyMode')) throw error;
  }

  if (!deserializeProject(text)) {
    throw new Error('현재 블록 프로젝트 형식(3.0)이 아니거나 파일이 손상되었습니다. 이전 프로젝트는 지원하지 않습니다.');
  }
}

// ─── Session Save / Load (all tabs) ─────────────────────────────

export function saveSession(): void {
  // Ensure the active tab is up-to-date before serializing
  tabManager.syncCurrentTab();
  const session: DedalSessionFile = {
    version: '2.0',
    type: 'session',
    timestamp: new Date().toISOString(),
    activeTabId: tabManager.activeTabId ?? '',
    tabs: ($state.snapshot(tabManager.tabs) as TabState[]).map(sanitizeBasicTab),
  };
  const json = JSON.stringify(session, null, 2);
  const tabCount = session.tabs.length;
  downloadText(json, `${t('file.session')}-${tabCount}-${t('file.tabs')}.ded`, 'application/json');
}

function isSessionFile(data: unknown): data is DedalSessionFile {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return d.type === 'session' && d.version === '2.0' && Array.isArray(d.tabs);
}

function validateSessionPayload(data: DedalSessionFile): boolean {
  const envelope = data as unknown as Record<string, unknown>;
  if (envelope.appMode !== undefined && envelope.appMode !== 'basico') return false;
  if (envelope.analysisMode !== undefined && envelope.analysisMode !== '2d') return false;
  return data.tabs.every((tab) => {
    if (!tab || typeof tab !== 'object') return false;
    const item = tab as unknown as Record<string, any>;
    if (item.appMode !== undefined && item.appMode !== 'basico') return false;
    if (item.analysisMode !== undefined && item.analysisMode !== '2d') return false;
    const snapshots = [item.modelSnapshot,
      ...(Array.isArray(item.undoStack) ? item.undoStack : []),
      ...(Array.isArray(item.redoStack) ? item.redoStack : [])];
    return snapshots.every((snapshot) => validateDedalFile({
      version: DEDAL_FILE_VERSION,
      name: String(item.name ?? ''),
      timestamp: '',
      snapshot,
    }));
  });
}

/** Load a .ded file — auto-detects single tab vs full session */
export async function loadFile(file: File): Promise<{ type: 'tab' | 'session'; count: number }> {
  const text = await file.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(t('file.invalidJson'));
  }
  if (containsLegacyEducationMode(data)) {
    throw new Error(t('file.unsupportedLegacyMode'));
  }

  if (isSessionFile(data)) {
    // Validate every tab and its undo/redo snapshots before mutating the tab
    // manager. A single spatial/PRO tab invalidates the whole session.
    if (!validateSessionPayload(data)) throw new Error(t('file.invalidFormat'));
    // Session file: restore all tabs
    tabManager.restoreSession(data.tabs.map(sanitizeBasicTab), data.activeTabId);
    return { type: 'session', count: data.tabs.length };
  } else if (deserializeProject(text)) {
    return { type: 'tab', count: 1 };
  } else {
    throw new Error(t('file.invalidFormat'));
  }
}

// ─── Export Results CSV ─────────────────────────────────────────

export function exportResultsCSV(): string {
  const r2d = resultsStore.results;

  if (!r2d) return '';

  const lines: string[] = [];
  lines.push(`# Dedaliano — ${t('file.csvResults')} 2D`);
  lines.push(`# ${t('file.csvProject')}: ${modelStore.model.name}`);
  lines.push(`# ${t('file.csvDate')}: ${new Date().toLocaleString()}`);
  lines.push('');

  {
    // 2D Displacements
    lines.push(`# ${t('file.displacements')}`);
    lines.push(`${t('file.node')},ux (m),uz (m),ry (rad)`);
    for (const d of r2d.displacements) {
      lines.push(`${d.nodeId},${d.ux.toExponential(6)},${get2DDisplayDisplacementVertical(d).toExponential(6)},${get2DDisplayRotation(d).toExponential(6)}`);
    }
    lines.push('');

    // 2D Reactions
    lines.push(`# ${t('file.reactions')}`);
    lines.push(`${t('file.node')},Rx (kN),Rz (kN),My (kN·m)`);
    for (const r of r2d.reactions) {
      lines.push(`${r.nodeId},${r.rx.toFixed(4)},${get2DDisplayReactionVertical(r).toFixed(4)},${(-get2DDisplayMoment(r)).toFixed(4)}`);
    }
    lines.push('');

    // 2D Element forces
    lines.push(`# ${t('file.internalForces')}`);
    lines.push(`${t('file.element')},N_i (kN),N_j (kN),V_i (kN),V_j (kN),M_i (kN·m),M_j (kN·m),L (m),qI (kN/m),qJ (kN/m)`);
    for (const f of r2d.elementForces) {
      lines.push(`${f.elementId},${f.nStart.toFixed(4)},${f.nEnd.toFixed(4)},${f.vStart.toFixed(4)},${f.vEnd.toFixed(4)},${(-f.mStart).toFixed(4)},${(-f.mEnd).toFixed(4)},${f.length.toFixed(4)},${f.qI.toFixed(4)},${f.qJ.toFixed(4)}`);
    }
  }

  return lines.join('\n');
}

export function downloadResultsCSV(): void {
  const csv = exportResultsCSV();
  if (!csv) return;
  const safeName = modelStore.model.name.replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ _-]/g, '').trim() || t('file.defaultResults');
  downloadText(csv, `${safeName}_${t('file.defaultResults')}.csv`, 'text/csv');
}

// ─── Export PNG ─────────────────────────────────────────────────

export function downloadCanvasPNG(canvas: HTMLCanvasElement): void {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const safeName = modelStore.model.name.replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ _-]/g, '').trim() || t('file.defaultStructure');
    downloadBlob(blob, `${safeName}.png`);
  }, 'image/png');
}

// ─── Export DXF ─────────────────────────────────────────────────

import { exportDxfWithResults } from '../dxf/writer';

export function exportDXF(): string {
  return exportDxfWithResults({
    includeResults: !!resultsStore.results,
    diagramScale: resultsStore.diagramScale,
    deformedScale: resultsStore.deformedScale,
    includeValues: true,
    includeSummary: true,
  });
}

export function downloadDXF(): void {
  const dxf = exportDXF();
  const safeName = modelStore.model.name.replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ _-]/g, '').trim() || t('file.defaultStructure');
  downloadText(dxf, `${safeName}.dxf`, 'application/dxf');
}

// ─── Export SVG ─────────────────────────────────────────────────

export function exportSVG(): string {
  // Compute bounding box
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [, node] of modelStore.nodes) {
    if (node.x < minX) minX = node.x;
    if (node.x > maxX) maxX = node.x;
    if (node.y < minY) minY = node.y;
    if (node.y > maxY) maxY = node.y;
  }
  if (!isFinite(minX)) return '';

  const pad = 1; // 1m padding
  minX -= pad; maxX += pad; minY -= pad; maxY += pad;
  const worldW = maxX - minX;
  const worldH = maxY - minY;
  const scale = 100; // px per meter
  const svgW = worldW * scale;
  const svgH = worldH * scale;

  // Transform: world → SVG (flip Y)
  const tx = (wx: number) => (wx - minX) * scale;
  const ty = (wy: number) => (maxY - wy) * scale;

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${svgW.toFixed(0)}" height="${svgH.toFixed(0)}" viewBox="0 0 ${svgW.toFixed(0)} ${svgH.toFixed(0)}">`);
  parts.push(`<rect width="100%" height="100%" fill="white"/>`);

  // Elements
  parts.push(`<g stroke="#333" stroke-width="2" fill="none">`);
  for (const [, elem] of modelStore.elements) {
    const ni = modelStore.getNode(elem.nodeI);
    const nj = modelStore.getNode(elem.nodeJ);
    if (!ni || !nj) continue;
    const dashAttr = elem.type === 'truss' ? ' stroke-dasharray="8,4"' : '';
    parts.push(`  <line x1="${tx(ni.x).toFixed(1)}" y1="${ty(ni.y).toFixed(1)}" x2="${tx(nj.x).toFixed(1)}" y2="${ty(nj.y).toFixed(1)}"${dashAttr}/>`);
  }
  parts.push('</g>');

  // Nodes
  parts.push(`<g fill="#4ecdc4" stroke="none">`);
  for (const [, node] of modelStore.nodes) {
    parts.push(`  <circle cx="${tx(node.x).toFixed(1)}" cy="${ty(node.y).toFixed(1)}" r="4"/>`);
  }
  parts.push('</g>');

  // Node labels
  parts.push(`<g fill="#666" font-size="11" font-family="sans-serif" text-anchor="start">`);
  for (const [, node] of modelStore.nodes) {
    parts.push(`  <text x="${(tx(node.x) + 6).toFixed(1)}" y="${(ty(node.y) - 6).toFixed(1)}">${node.id}</text>`);
  }
  parts.push('</g>');

  // Supports
  const supSize = 12;
  parts.push(`<g stroke="#ff8800" stroke-width="2" fill="none">`);
  for (const [, sup] of modelStore.supports) {
    const node = modelStore.getNode(sup.nodeId);
    if (!node) continue;
    const sx = tx(node.x);
    const sy = ty(node.y);
    if (sup.type === 'fixed') {
      parts.push(`  <rect x="${(sx - supSize).toFixed(1)}" y="${sy.toFixed(1)}" width="${(supSize * 2).toFixed(0)}" height="${(supSize / 2).toFixed(0)}" fill="#ff8800" opacity="0.3"/>`);
      for (let i = -supSize; i <= supSize; i += 6) {
        parts.push(`  <line x1="${(sx + i).toFixed(1)}" y1="${(sy + supSize / 2).toFixed(1)}" x2="${(sx + i - 5).toFixed(1)}" y2="${(sy + supSize).toFixed(1)}"/>`);
      }
    } else if (sup.type === 'pinned') {
      parts.push(`  <polygon points="${sx.toFixed(1)},${sy.toFixed(1)} ${(sx - supSize).toFixed(1)},${(sy + supSize).toFixed(1)} ${(sx + supSize).toFixed(1)},${(sy + supSize).toFixed(1)}"/>`);
    } else if (sup.type === 'rollerX' || sup.type === 'rollerY' || sup.type === 'rollerZ') {
      // Compute visual angle
      const baseAngleDeg = sup.type === 'rollerX' ? 0 : 90;
      let angleDeg = baseAngleDeg;
      if (sup.isGlobal === false) {
        const elemAngle = modelStore.getElementAngleAtNode(sup.nodeId);
        angleDeg = (elemAngle * 180 / Math.PI) + baseAngleDeg;
      }
      angleDeg += (sup.angle ?? 0);
      // Draw rotated roller with 2 circles
      const s2 = supSize * 0.5;
      const triH = supSize * 0.7;
      const cr = 3;
      const cy2 = triH + cr + 1;
      const groundY = cy2 + cr + 1;
      parts.push(`  <g transform="translate(${sx.toFixed(1)},${sy.toFixed(1)}) rotate(${angleDeg.toFixed(1)})">`);
      parts.push(`    <polygon points="0,0 ${(-s2).toFixed(1)},${triH.toFixed(1)} ${s2.toFixed(1)},${triH.toFixed(1)}"/>`);
      parts.push(`    <circle cx="-4" cy="${cy2.toFixed(1)}" r="${cr}"/>`);
      parts.push(`    <circle cx="4" cy="${cy2.toFixed(1)}" r="${cr}"/>`);
      parts.push(`    <line x1="${(-supSize).toFixed(1)}" y1="${groundY.toFixed(1)}" x2="${supSize.toFixed(1)}" y2="${groundY.toFixed(1)}"/>`);
      parts.push(`  </g>`);
    } else if (sup.type === 'spring') {
      // Simple zigzag
      let path = `M${sx.toFixed(1)},${sy.toFixed(1)}`;
      const h = supSize * 1.5;
      const w = supSize * 0.6;
      const nCoils = 4;
      for (let i = 0; i < nCoils; i++) {
        const y1 = sy + 3 + (i + 0.25) / nCoils * h;
        const y2 = sy + 3 + (i + 0.75) / nCoils * h;
        path += ` L${(sx + w).toFixed(1)},${y1.toFixed(1)} L${(sx - w).toFixed(1)},${y2.toFixed(1)}`;
      }
      path += ` L${sx.toFixed(1)},${(sy + 3 + h).toFixed(1)}`;
      parts.push(`  <path d="${path}" stroke="#44bb88"/>`);
      parts.push(`  <line x1="${(sx - supSize).toFixed(1)}" y1="${(sy + 3 + h + 3).toFixed(1)}" x2="${(sx + supSize).toFixed(1)}" y2="${(sy + 3 + h + 3).toFixed(1)}" stroke="#44bb88"/>`);
    }
  }
  parts.push('</g>');

  // Title
  parts.push(`<text x="10" y="20" fill="#333" font-size="14" font-family="sans-serif">${escapeXml(modelStore.model.name)}</text>`);

  parts.push('</svg>');
  return parts.join('\n');
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function downloadSVG(): void {
  const svg = exportSVG();
  if (!svg) return;
  const safeName = modelStore.model.name.replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ _-]/g, '').trim() || t('file.defaultStructure');
  downloadText(svg, `${safeName}.svg`, 'image/svg+xml');
}

// ─── Export Excel ────────────────────────────────────────────────

export async function downloadExcel(): Promise<void> {
  const safeName = modelStore.model.name.replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ _-]/g, '').trim() || t('file.defaultAnalysis');
  // Async because xlsx is fetched on demand — see lib/export/excel.ts.
  await exportToExcel({ filename: `${safeName}.xlsx` });
}

// ─── PDF Report ─────────────────────────────────────────────────

function fmtNum(v: number, dec = 4): string {
  if (Math.abs(v) < 1e-10) return '0';
  if (Math.abs(v) >= 1000 || Math.abs(v) < 0.01) return v.toExponential(3);
  return v.toFixed(dec);
}

function supportLabel(type: string): string {
  switch (type) {
    case 'fixed': return t('file.supportFixed');
    case 'pinned': return t('file.supportPinned');
    case 'rollerX': return t('file.supportRollerX');
    case 'rollerZ':
    case 'rollerY': return t('file.supportRollerY');
    case 'spring': return t('file.supportSpring');
    default: return type;
  }
}

export function generateReportHTML(): string {
  const m = modelStore;
  const r = resultsStore.results;
  const name = escapeXml(m.model.name);
  const date = new Date().toLocaleString();

  // Get SVG of the structure
  const svg = exportSVG();

  let html = `<!DOCTYPE html>
<html lang="${t('file.htmlLang')}">
<head>
<meta charset="UTF-8">
<title>${t('file.report')} — ${name}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; font-size: 11px; color: #222; padding: 20mm 15mm; }
  h1 { font-size: 20px; margin-bottom: 4px; color: #1a1a2e; }
  h2 { font-size: 14px; margin: 16px 0 6px; color: #1a1a2e; border-bottom: 2px solid #e94560; padding-bottom: 2px; }
  h3 { font-size: 12px; margin: 10px 0 4px; color: #333; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
  .header-info { color: #666; font-size: 10px; text-align: right; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; font-size: 10px; }
  th, td { border: 1px solid #ccc; padding: 3px 6px; text-align: right; }
  th { background: #f0f0f0; font-weight: 600; text-align: center; }
  td:first-child { text-align: center; font-weight: 600; }
  .svg-container { text-align: center; margin: 10px 0; page-break-inside: avoid; }
  .svg-container svg { max-width: 100%; height: auto; max-height: 300px; }
  .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 12px; }
  .summary-card { border: 1px solid #ddd; border-radius: 4px; padding: 8px; text-align: center; }
  .summary-card .num { font-size: 20px; font-weight: 700; color: #e94560; }
  .summary-card .lbl { font-size: 9px; color: #666; text-transform: uppercase; }
  .no-results { color: #999; font-style: italic; margin: 8px 0; }
  @media print {
    body { padding: 10mm; }
    h2 { page-break-after: avoid; }
    table { page-break-inside: auto; }
    tr { page-break-inside: avoid; }
  }
</style>
</head>
<body>
<div class="header">
  <div>
    <h1>${name}</h1>
    <div style="color:#666;font-size:10px">${t('file.structuralAnalysisReport')}</div>
  </div>
  <div class="header-info">
    <div>Dedaliano</div>
    <div>${escapeXml(date)}</div>
  </div>
</div>`;

  // Summary cards
  html += `
<div class="summary-grid">
  <div class="summary-card"><div class="num">${m.nodes.size}</div><div class="lbl">${t('file.nodes')}</div></div>
  <div class="summary-card"><div class="num">${m.elements.size}</div><div class="lbl">${t('file.elements')}</div></div>
  <div class="summary-card"><div class="num">${m.supports.size}</div><div class="lbl">${t('file.supports')}</div></div>
  <div class="summary-card"><div class="num">${m.model.loads.length}</div><div class="lbl">${t('file.loads')}</div></div>
</div>`;

  // Structure SVG
  if (svg) {
    html += `<div class="svg-container">${svg}</div>`;
  }

  // Nodes table
  html += `<h2>${t('file.geometry')}</h2>`;
  html += `<h3>${t('file.nodes')}</h3>
<table><thead><tr><th>ID</th><th>X (m)</th><th>${TWO_D_VERTICAL_AXIS_LABEL} (m)</th></tr></thead><tbody>`;
  for (const [, node] of m.nodes) {
    html += `<tr><td>${node.id}</td><td>${fmtNum(node.x, 3)}</td><td>${fmtNum(get2DDisplayedVertical(node), 3)}</td></tr>`;
  }
  html += `</tbody></table>`;

  // Elements table
  html += `<h3>${t('file.elements')}</h3>
<table><thead><tr><th>ID</th><th>${t('file.type')}</th><th>${t('file.nodeI')}</th><th>${t('file.nodeJ')}</th><th>${t('file.material')}</th><th>${t('file.section')}</th><th>${t('file.hingeI')}</th><th>${t('file.hingeJ')}</th></tr></thead><tbody>`;
  for (const [, elem] of m.elements) {
    const mat = m.materials.get(elem.materialId);
    const sec = m.sections.get(elem.sectionId);
    const hI = elem.releaseI?.mz === true;
    const hJ = elem.releaseJ?.mz === true;
    html += `<tr><td>${elem.id}</td><td>${elem.type}</td><td>${elem.nodeI}</td><td>${elem.nodeJ}</td><td>${mat ? escapeXml(mat.name) : elem.materialId}</td><td>${sec ? escapeXml(sec.name) : elem.sectionId}</td><td>${hI ? t('file.yes') : '-'}</td><td>${hJ ? t('file.yes') : '-'}</td></tr>`;
  }
  html += `</tbody></table>`;

  // Materials
  html += `<h3>${t('file.materials')}</h3>
<table><thead><tr><th>ID</th><th>${t('file.name')}</th><th>E (MPa)</th><th>ν</th><th>ρ (kN/m³)</th></tr></thead><tbody>`;
  for (const [, mat] of m.materials) {
    html += `<tr><td>${mat.id}</td><td style="text-align:left">${escapeXml(mat.name)}</td><td>${fmtNum(mat.e, 0)}</td><td>${fmtNum(mat.nu, 2)}</td><td>${fmtNum(mat.rho, 1)}</td></tr>`;
  }
  html += `</tbody></table>`;

  // Sections
  html += `<h3>${t('file.sections')}</h3>
<table><thead><tr><th>ID</th><th>${t('file.name')}</th><th>A (m²)</th><th>Iy (m⁴)</th><th>Iz (m⁴)</th></tr></thead><tbody>`;
  for (const [, sec] of m.sections) {
    html += `<tr><td>${sec.id}</td><td style="text-align:left">${escapeXml(sec.name)}</td><td>${fmtNum(sec.a)}</td><td>${fmtNum(sec.iy ?? sec.iz)}</td><td>${fmtNum(sec.iz)}</td></tr>`;
  }
  html += `</tbody></table>`;

  // Supports
  html += `<h2>${t('file.boundaryConditions')}</h2>`;
  html += `<h3>${t('file.supports')}</h3>
<table><thead><tr><th>ID</th><th>${t('file.node')}</th><th>${t('file.type')}</th><th>${t('file.details')}</th></tr></thead><tbody>`;
  for (const [, sup] of m.supports) {
    let details = '';
    if (sup.type === 'spring') {
      const parts: string[] = [];
      if (sup.kx) parts.push(`kx=${sup.kx}`);
      if (sup.ky) parts.push(`ky=${sup.ky}`);
      if (sup.kz) parts.push(`kz=${sup.kz}`);
      details = parts.join(', ') + ' kN/m';
    } else {
      const parts: string[] = [];
      if (sup.dx) parts.push(`dx=${fmtNum(sup.dx)} m`);
      if (sup.dz) parts.push(`dz=${fmtNum(sup.dz)} m`);
      if (sup.dry) parts.push(`dθy=${fmtNum(sup.dry)} rad`);
      details = parts.length > 0 ? parts.join(', ') : '-';
    }
    html += `<tr><td>${sup.id}</td><td>${sup.nodeId}</td><td>${supportLabel(sup.type)}</td><td style="text-align:left">${details}</td></tr>`;
  }
  html += `</tbody></table>`;

  // Loads
  html += `<h3>${t('file.loads')}</h3>
<table><thead><tr><th>#</th><th>${t('file.type')}</th><th>${t('file.target')}</th><th>${t('file.values')}</th></tr></thead><tbody>`;
  for (let i = 0; i < m.model.loads.length; i++) {
    const load = m.model.loads[i];
    let tipo = '', destino = '', valores = '';
    switch (load.type) {
      case 'nodal': {
        const d = load.data;
        tipo = t('file.loadNodal');
        destino = `${t('file.node')} ${d.nodeId}`;
        const fz = 'fz' in d ? Number((d as { fz?: number }).fz ?? 0) : Number((d as { fy?: number }).fy ?? 0);
        const my = 'my' in d ? Number((d as { my?: number }).my ?? 0) : Number((d as { mz?: number }).mz ?? 0);
        valores = `Fx=${fmtNum(d.fx)} kN, Fz=${fmtNum(fz)} kN, My=${fmtNum(my)} kN·m`;
        break;
      }
      case 'distributed': {
        const d = load.data;
        tipo = t('file.loadDistributed');
        destino = `Elem ${d.elementId}`;
        valores = d.qI === d.qJ ? `q=${fmtNum(d.qI)} kN/m` : `qI=${fmtNum(d.qI)}, qJ=${fmtNum(d.qJ)} kN/m`;
        break;
      }
      case 'pointOnElement': {
        const d = load.data;
        tipo = t('file.loadPointOnElement');
        destino = `Elem ${d.elementId}`;
        valores = `P=${fmtNum(d.p)} kN, a=${fmtNum(d.a)} m`;
        break;
      }
      case 'cylinder': {
        const d = load.data;
        tipo = '실린더';
        destino = `${t('file.node')} ${d.nodeI}–${d.nodeJ}`;
        valores = `F=${fmtNum(d.force)} kN (${d.force >= 0 ? '밀어냄' : '당김'})`;
        break;
      }
    }
    html += `<tr><td>${i + 1}</td><td>${tipo}</td><td>${destino}</td><td style="text-align:left">${valores}</td></tr>`;
  }
  html += `</tbody></table>`;

  // Results (Basic 2D)
  if (r) {
    html += `<h2>${t('file.results')}</h2>`;

    // Displacements
    html += `<h3>${t('file.displacements')}</h3>
<table><thead><tr><th>${t('file.node')}</th><th>${TWO_D_DISPLACEMENT_LABELS.horizontal} (m)</th><th>${TWO_D_DISPLACEMENT_LABELS.vertical} (m)</th><th>${TWO_D_DISPLACEMENT_LABELS.rotation} (rad)</th></tr></thead><tbody>`;
    for (const d of r.displacements) {
      html += `<tr><td>${d.nodeId}</td><td>${fmtNum(d.ux)}</td><td>${fmtNum(get2DDisplayDisplacementVertical(d))}</td><td>${fmtNum(get2DDisplayRotation(d))}</td></tr>`;
    }
    html += `</tbody></table>`;

    // Reactions
    html += `<h3>${t('file.reactions')}</h3>
<table><thead><tr><th>${t('file.node')}</th><th>${TWO_D_REACTION_LABELS.horizontal} (kN)</th><th>${TWO_D_REACTION_LABELS.vertical} (kN)</th><th>${TWO_D_REACTION_LABELS.moment} (kN·m)</th></tr></thead><tbody>`;
    for (const rx of r.reactions) {
      html += `<tr><td>${rx.nodeId}</td><td>${fmtNum(rx.rx)}</td><td>${fmtNum(get2DDisplayReactionVertical(rx))}</td><td>${fmtNum(-get2DDisplayMoment(rx))}</td></tr>`;
    }
    html += `</tbody></table>`;

    // Internal forces
    html += `<h3>${t('file.internalForces')}</h3>
<table><thead><tr><th>Elem</th><th>L (m)</th><th>N_i (kN)</th><th>N_j (kN)</th><th>V_i (kN)</th><th>V_j (kN)</th><th>M_i (kN·m)</th><th>M_j (kN·m)</th></tr></thead><tbody>`;
    for (const f of r.elementForces) {
      html += `<tr><td>${f.elementId}</td><td>${fmtNum(f.length, 3)}</td><td>${fmtNum(f.nStart)}</td><td>${fmtNum(f.nEnd)}</td><td>${fmtNum(f.vStart)}</td><td>${fmtNum(f.vEnd)}</td><td>${fmtNum(-f.mStart)}</td><td>${fmtNum(-f.mEnd)}</td></tr>`;
    }
    html += `</tbody></table>`;
  } else {
    html += `<h2>${t('file.results')}</h2><p class="no-results">${t('file.noResultsMsg')}</p>`;
  }

  html += `
<div style="margin-top:20px;padding-top:8px;border-top:1px solid #ddd;color:#999;font-size:9px;text-align:center">
  ${t('file.generatedWith')} 2D
</div>
</body></html>`;

  return html;
}

export function openPDFReport(): void {
  const html = generateReportHTML();
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(html);
  w.document.close();
  // Auto-trigger print dialog after a short delay for rendering
  setTimeout(() => w.print(), 400);
}

// ─── AutoSave ───────────────────────────────────────────────────

function hasLocalStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function';
  } catch { return false; }
}

/**
 * The oldest storage key, from before the rename.
 *
 * Still migrated forward: `autosave-db` imports the `stabileo-autosave` slot into IndexedDB
 * once and then removes it, so a project last saved under the original name still survives
 * two migrations rather than one.
 */
if (hasLocalStorage()) {
  if (localStorage.getItem('dedaliano-autosave') !== null && localStorage.getItem(LEGACY_AUTOSAVE_KEY) === null) {
    localStorage.setItem(LEGACY_AUTOSAVE_KEY, localStorage.getItem('dedaliano-autosave')!);
    localStorage.removeItem('dedaliano-autosave');
  }
}

const WORKSPACE_KEY = 'stabileo-workspace';

// ─── AutoSave (IndexedDB) ───────────────────────────────────────

/**
 * Validate and migrate one stored autosave payload, or refuse it.
 *
 * Same gate as opening a `.ded`, deliberately: the migrations, the version allow-list and the
 * referential-integrity checks are the project's, not the storage layer's, and a payload that
 * would be rejected as a file has no business being restored as an autosave.
 */
export function acceptAutosavePayload(raw: unknown): DedalFile | null {
  if (!raw || typeof raw !== 'object') return null;
  // Copied before migrating: `migrateSnapshotV1ToV2` rewrites in place, and mutating a record
  // that is still sitting in IndexedDB would make a read a write.
  const data = plainDeepCopy(raw) as Record<string, unknown>;
  if (typeof data.version !== 'string' || !KNOWN_VERSIONS.has(data.version)) return null;

  if (!validateDedalFile(data)) return null;
  const accepted = data as unknown as DedalFile;
  accepted.snapshot = sanitizeBasicSnapshot(accepted.snapshot);
  delete accepted.appMode;
  delete accepted.analysisMode;
  return accepted;
}

/**
 * Structural census of a stored project.
 *
 * A count per family, not a hash — see the note in `autosave-db.ts`. It is here rather than
 * there because only this module knows what families a project has.
 */
export function autosaveFingerprint(raw: unknown): AutosaveFingerprint {
  const snap = (raw as { snapshot?: Record<string, unknown> } | null)?.snapshot;
  const n = (k: string): number => {
    const v = snap?.[k];
    return Array.isArray(v) ? v.length : 0;
  };
  return {
    nodes: n('nodes'),
    elements: n('elements'),
    materials: n('materials'),
    sections: n('sections'),
    supports: n('supports'),
    loads: n('loads'),
    plates: n('plates'),
    quads: n('quads'),
    footings: n('footings'),
    // Reinforcement is the payload that overflowed localStorage in the first place, so it is
    // the one whose disappearance between write and read must not go unnoticed.
    reinforced: Array.isArray(snap?.elements)
      ? (snap.elements as Array<[number, { reinforcement?: unknown }]>)
        .filter((e) => Array.isArray(e) && !!e[1]?.reinforcement).length
      : 0,
  };
}

export const projectAutosavePolicy: AutosavePolicy<DedalFile> = {
  accept: acceptAutosavePayload,
  fingerprint: autosaveFingerprint,
};

/** Reported once per session per kind — a warning on a 30 s timer is a warning nobody reads. */
const autosaveNoticesShown = new Set<string>();

/** Test seam: forget which notices have already been shown. */
export function resetAutosaveNotices(): void {
  autosaveNoticesShown.clear();
}

function noticeOnce(kind: string, message: string, type: 'error' | 'info' = 'error'): void {
  if (autosaveNoticesShown.has(kind)) return;
  autosaveNoticesShown.add(kind);
  uiStore.toast(message, type);
}

/**
 * Autosave the project, and SAY SO when it cannot.
 *
 * ── The silence this removes ───────────────────────────────────────
 *
 * `localStorage` gives an origin a few megabytes. A structural model fits easily; the same
 * model once every member carries reinforcement and a coordinated detailing does not. Measured
 * on `Edificio H.A. 7 pisos — PRO`: 172 kB before the design, over quota after `designAll`.
 *
 * The write therefore started throwing `QuotaExceededError` at exactly the moment the project
 * became worth saving. The consequence was not a missing feature, it was lost work presented
 * as saved work: the key still held the PRE-DESIGN snapshot, so a reload offered a restore
 * banner, the user pressed Restaurar believing they were getting their afternoon back, and
 * they got the model as it was before they designed anything.
 *
 * IndexedDB removes the ceiling. It does not remove the obligation, which is why this returns
 * the write result rather than a bare boolean: a caller — the timer, a post-design hook, a
 * test — can tell "saved as revision 7" from "refused for quota" from "this browser has no
 * storage at all". Nothing here ever reports a save that did not happen.
 */
export async function saveAutosave(): Promise<AutosaveWriteResult> {
  let payload: DedalFile;
  try {
    payload = buildProjectFile();
  } catch (err) {
    noticeOnce('build', t('file.autosaveFailed'));
    return {
      ok: false, backend: 'none', revision: null,
      failure: { kind: 'unknown', detail: err instanceof Error ? err.message : String(err) },
    };
  }

  const result = await autosaveWrite(payload, projectAutosavePolicy);
  if (result.ok) {
    if (result.backend === 'localstorage') noticeOnce('degraded', t('file.autosaveDegraded'), 'info');
    return result;
  }

  switch (result.failure?.kind) {
    case 'quota':
      noticeOnce('quota', t('file.autosaveTooLarge'));
      break;
    case 'clone':
      // A payload the browser refuses to clone is a defect in this app, not in the project.
      // Name the field so the report is actionable instead of `[object Array]`.
      console.error('[stabileo] autosave payload is not structured-cloneable:',
        findUncloneablePath(payload, 'project'));
      noticeOnce('clone', t('file.autosaveFailed'));
      break;
    case 'unavailable':
      noticeOnce('unavailable', t('file.autosaveUnavailable'));
      break;
    default:
      noticeOnce('unknown', t('file.autosaveFailed'));
  }
  return result;
}

/**
 * The newest autosave that survives every check — and a plain statement of what did not.
 *
 * A caller that ignores `rejected` and `unfinishedRevision` gets the old behaviour, which is
 * why they are on the result rather than in a log: handing back an older save without saying
 * so is the exact defect this whole change exists to remove.
 */
export async function loadAutosave(): Promise<AutosaveReadResult<DedalFile>> {
  const result = await autosaveRead(projectAutosavePolicy);

  // Keep the stored revision intact, but never expose a removed Education
  // project as a restore candidate or silently reinterpret it as Basic.
  if (result.value && containsLegacyEducationMode(result.value)) {
    uiStore.toast(t('file.unsupportedLegacyMode'), 'error');
    return { ...result, value: null };
  }

  if (result.unfinishedRevision !== null) {
    noticeOnce('unfinished', t('file.autosaveUnfinished'));
  }
  if (result.rejected.length > 0) {
    console.warn('[stabileo] autosave revisions refused on read:', result.rejected);
    noticeOnce('rejected', result.value
      ? t('file.autosaveOlderRestored')
      : t('file.autosaveCorrupt'));
  }
  if (result.backend === 'localstorage') {
    noticeOnce('degraded', t('file.autosaveDegraded'), 'info');
  } else if (result.backend === 'none') {
    noticeOnce('unavailable', t('file.autosaveUnavailable'));
  }
  return result;
}

/** Drop every stored autosave revision. Used by Descartar and by "new project". */
export async function clearAutosave(): Promise<void> {
  await autosaveClear();
}

export { autosaveStatus };

export function saveWorkspaceToLocalStorage(): void {
  try {
    tabManager.syncCurrentTab();
    const session: DedalSessionFile = {
      version: '2.0',
      type: 'session',
      timestamp: new Date().toISOString(),
      activeTabId: tabManager.activeTabId ?? '',
      tabs: ($state.snapshot(tabManager.tabs) as TabState[]).map(sanitizeBasicTab),
    };
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(session));
  } catch {
    // localStorage might be full or unavailable — silently ignore
  }
}

export function loadWorkspaceFromLocalStorage(): DedalSessionFile | null {
  try {
    const raw = localStorage.getItem(WORKSPACE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!isSessionFile(data)) { uiStore.toast('이전 작업 세션은 지원하지 않습니다. 새 프로젝트를 시작하세요.', 'info'); return null; }
    if (containsLegacyEducationMode(data)) {
      uiStore.toast(t('file.unsupportedLegacyMode'), 'error');
      return null;
    }
    if (!validateSessionPayload(data)) return null;
    return { ...data, tabs: data.tabs.map(sanitizeBasicTab) };
  } catch {
    return null;
  }
}

export function clearWorkspaceFromLocalStorage(): void {
  try {
    localStorage.removeItem(WORKSPACE_KEY);
  } catch {
    // ignore
  }
}

// ─── Aggregate API ──────────────────────────────────────────────

export const fileOps = {
  serializeProject,
  deserializeProject,
  saveProject,
  loadProject,
  loadFile,
  saveSession,
  exportResultsCSV,
  downloadResultsCSV,
  downloadCanvasPNG,
  exportDXF,
  downloadDXF,
  exportSVG,
  downloadSVG,
  downloadExcel,
  generateReportHTML,
  openPDFReport,
  saveAutosave,
  loadAutosave,
  clearAutosave,
  saveWorkspaceToLocalStorage,
  loadWorkspaceFromLocalStorage,
  clearWorkspaceFromLocalStorage,
};
