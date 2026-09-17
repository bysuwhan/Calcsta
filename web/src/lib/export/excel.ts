/**
 * Excel Export Module
 * Generates a professional structural analysis report in Excel format
 * Exports the Basic 2D analysis model and results.
 *
 * Sheets:
 * 1. Resumen - Project summary with key results
 * 2. Elementos - All elements with properties and internal forces
 * 3. Nodos - Node coordinates and displacements
 * 4. Reacciones - Support reactions
 * 5. Materiales - Material properties
 * 6. Secciones - Section properties
 */

/*
 * xlsx is loaded on demand, not with the module.
 *
 * It is 875 KB of source and it was in the main chunk, which every landing
 * and blog page downloads — to render an article, in a browser that may never
 * open the editor at all. Nothing here runs until someone asks for a
 * spreadsheet, so nothing here needs to be in the bundle until then.
 *
 * The helpers below keep using `XLSX` as a module-level binding: they are all
 * reachable only from `exportToExcel`, which awaits the import first. That is
 * why this is a `let` rather than being threaded through ten signatures.
 */
// Type-only: erased at build time, so it costs the bundle nothing.
import type * as Xlsx from 'xlsx';
type XlsxModule = typeof import('xlsx');
let XLSX!: XlsxModule;
import { modelStore, resultsStore, uiStore } from '../store';
import { t } from '../i18n';
import { toDisplay, unitLabel } from '../utils/units';
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

interface ExcelExportOptions {
  filename?: string;
  includeResults?: boolean;
  /**
   * Extra sheets to append, as arrays of arrays.
   *
   * The detailing bar schedule arrives this way: it is rendered from the DocumentModel by
   * `renderSchedule` and appended here rather than rebuilt, so the workbook the user
   * downloads contains the same numbers as the report and the drawings.
   */
  extraSheets?: ReadonlyArray<{ name: string; rows: (string | number)[][] }>;
  /**
   * Skip the standard model sheets and write only `extraSheets`.
   *
   * A bar schedule is a fabrication document; padding it with node coordinates and
   * reaction tables makes it harder to use, not more complete.
   */
  onlyExtras?: boolean;
}

/**
 * Resolve the spreadsheet library, or say that it could not be resolved.
 *
 * ── Why this returns null instead of throwing ──
 *
 * Splitting xlsx into its own chunk bought 142 KB off every public page, and
 * it introduced a failure mode that bundled code does not have: the import can
 * fail on its own. A deploy that replaced the hashed filename while a tab was
 * still open, a dropped connection, a proxy that blocks the request — none of
 * which could touch a library that was already in the chunk the app booted
 * from.
 *
 * Every caller is a click handler that does not await (`onclick={downloadExcel}`
 * and its two siblings), so a rejection here would surface as an unhandled
 * promise and NOTHING on screen: the reader presses Excel and the application
 * appears to ignore them. Reporting and returning null means every caller ends
 * the same way — the user has been told, and no path throws into a handler
 * that was never going to catch it.
 */
export async function loadXlsxModule(): Promise<XlsxModule | null> {
  try {
    XLSX ??= await import('xlsx');
    return XLSX;
  } catch (err) {
    console.error('[stabileo] the spreadsheet library failed to load:', err);
    uiStore.toast(t('excel.loadFailed'), 'error');
    return null;
  }
}

export const releaseLabel = (r?: { my: boolean; mz: boolean; t: boolean }): string => {
  if (!r) return '';
  const parts = [r.my && 'My', r.mz && 'Mz', r.t && 'T'].filter(Boolean);
  return parts.join('+');
};

function createSummarySheet(): Xlsx.WorkSheet {
  const r2d = resultsStore.results;
  const data: (string | number)[][] = [];

  data.push([`${t('excel.structuralAnalysis')} 2D - ${t('excel.summary')}`]);
  data.push([]);

  data.push([t('excel.model')]);
  data.push([t('excel.nodes'), modelStore.nodes.size]);
  data.push([t('excel.elements'), modelStore.elements.size]);
  data.push([t('excel.supports'), modelStore.supports.size]);
  data.push([t('excel.loads'), modelStore.loads.length]);
  data.push([]);

  if (r2d) {
    data.push([t('excel.maxResults')]);
    data.push([t('excel.maxDisplacement'), (resultsStore.maxDisplacement * 1000).toFixed(4), 'mm']);
    data.push([t('excel.maxMoment'), resultsStore.maxMoment.toFixed(2), 'kN·m']);
    data.push([t('excel.maxShear'), resultsStore.maxShear.toFixed(2), 'kN']);

    let maxAxial = 0;
    for (const ef of r2d.elementForces) {
      maxAxial = Math.max(maxAxial, Math.abs(ef.nStart), Math.abs(ef.nEnd));
    }
    data.push([t('excel.maxAxial'), maxAxial.toFixed(2), 'kN']);
    data.push([]);

    let sumRx = 0, sumRz = 0, sumMy = 0;
    for (const r of r2d.reactions) {
      sumRx += r.rx;
      sumRz += get2DDisplayReactionVertical(r);
      sumMy += get2DDisplayMoment(r);
    }
    data.push([t('excel.equilibriumCheck')]);
    data.push(['ΣRx', sumRx.toFixed(4), 'kN']);
    data.push(['ΣRz', sumRz.toFixed(4), 'kN']);
    data.push(['ΣMy', sumMy.toFixed(4), 'kN·m']);
  }

  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{ wch: 25 }, { wch: 15 }, { wch: 10 }];
  return ws;
}

function createElementsSheet(): Xlsx.WorkSheet {
  const r2d = resultsStore.results;
  const hasResults = !!r2d;

  const headers = [
    'ID', t('excel.type'), t('excel.nodeI'), t('excel.nodeJ'), 'L (m)',
    t('excel.material'), `E (${unitLabel('stress', uiStore.unitSystem)})`,
    t('excel.section'), 'A (m²)', 'Iy (m⁴)',
  ];
  headers.push(t('excel.releaseI'), t('excel.releaseJ'));

  if (hasResults) {
    headers.push(
      'Ni (kN)', 'Nj (kN)',
      'Vi (kN)', 'Vj (kN)',
      'Mi (kN·m)', 'Mj (kN·m)',
      '|N|max', '|V|max', '|M|max'
    );
  }

  const data: (string | number)[][] = [headers];

  for (const elem of modelStore.elements.values()) {
    const mat = modelStore.materials.get(elem.materialId);
    const sec = modelStore.sections.get(elem.sectionId);
    const L = modelStore.getElementLength(elem.id);

    const row: (string | number)[] = [
      elem.id,
      elem.type === 'frame' ? 'Frame' : 'Truss',
      elem.nodeI, elem.nodeJ,
      Number(L.toFixed(4)),
      mat?.name ?? '-', mat ? toDisplay(mat.e, 'stress', uiStore.unitSystem) : 0,
      sec?.name ?? '-', sec?.a ?? 0, sec?.iy ?? sec?.iz ?? 0,
    ];
    row.push(releaseLabel(elem.releaseI), releaseLabel(elem.releaseJ));

    if (hasResults && r2d) {
      const forces = r2d.elementForces.find(f => f.elementId === elem.id);
      if (forces) {
        row.push(
          Number(forces.nStart.toFixed(4)), Number(forces.nEnd.toFixed(4)),
          Number(forces.vStart.toFixed(4)), Number(forces.vEnd.toFixed(4)),
          Number(forces.mStart.toFixed(4)), Number(forces.mEnd.toFixed(4)),
          Number(Math.max(Math.abs(forces.nStart), Math.abs(forces.nEnd)).toFixed(4)),
          Number(Math.max(Math.abs(forces.vStart), Math.abs(forces.vEnd)).toFixed(4)),
          Number(Math.max(Math.abs(forces.mStart), Math.abs(forces.mEnd)).toFixed(4)),
        );
      } else {
        row.push('-', '-', '-', '-', '-', '-', '-', '-', '-');
      }
    }

    data.push(row);
  }

  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = headers.map(() => ({ wch: 12 }));
  return ws;
}

function createNodesSheet(): Xlsx.WorkSheet {
  const r2d = resultsStore.results;
  const hasResults = !!r2d;

  const headers = ['ID', 'X (m)', `${TWO_D_VERTICAL_AXIS_LABEL} (m)`];
  if (hasResults) {
    headers.push('ux (mm)', `${TWO_D_DISPLACEMENT_LABELS.vertical} (mm)`, `${TWO_D_DISPLACEMENT_LABELS.rotation} (mrad)`);
  }

  const data: (string | number)[][] = [headers];

  for (const node of modelStore.nodes.values()) {
    const row: (string | number)[] = [
      node.id,
      Number(node.x.toFixed(4)),
      Number(get2DDisplayedVertical(node).toFixed(4)),
    ];

    if (hasResults && r2d) {
      const disp = r2d.displacements.find(d => d.nodeId === node.id);
      if (disp) {
        row.push(
          Number((disp.ux * 1000).toFixed(4)),
          Number((get2DDisplayDisplacementVertical(disp) * 1000).toFixed(4)),
          Number((get2DDisplayRotation(disp) * 1000).toFixed(4)),
        );
      } else {
        row.push('-', '-', '-');
      }
    }

    data.push(row);
  }

  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = headers.map(() => ({ wch: 12 }));
  return ws;
}

function createReactionsSheet(): Xlsx.WorkSheet {
  const r2d = resultsStore.results;

  if (!r2d) {
    return XLSX.utils.aoa_to_sheet([[t('excel.noResults')]]);
  }
  const headers = [t('excel.node'), t('excel.supportType'), `${TWO_D_REACTION_LABELS.horizontal} (kN)`, `${TWO_D_REACTION_LABELS.vertical} (kN)`, `${TWO_D_REACTION_LABELS.moment} (kN·m)`];
  const data: (string | number)[][] = [headers];

  for (const r of r2d.reactions) {
    const sup = [...modelStore.supports.values()].find(s => s.nodeId === r.nodeId);
    const supType = sup ? ({
      fixed: t('excel.fixed'), pinned: t('excel.pinned'),
      rollerX: t('excel.rollerX'), rollerY: t('excel.rollerY'), rollerZ: t('excel.rollerY'), spring: t('excel.spring'),
    } as Record<string, string>)[sup.type] ?? sup.type : '-';

    data.push([
      r.nodeId, supType,
      Number(r.rx.toFixed(4)), Number(get2DDisplayReactionVertical(r).toFixed(4)), Number(get2DDisplayMoment(r).toFixed(4)),
    ]);
  }

  const totals = r2d.reactions.reduce(
    (acc, r) => ({ rx: acc.rx + r.rx, rz: acc.rz + get2DDisplayReactionVertical(r), my: acc.my + get2DDisplayMoment(r) }),
    { rx: 0, rz: 0, my: 0 }
  );
  data.push([]);
  data.push([t('excel.total'), '', Number(totals.rx.toFixed(4)), Number(totals.rz.toFixed(4)), Number(totals.my.toFixed(4))]);

  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{ wch: 8 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 14 }];
  return ws;
}

function createMaterialsSheet(): Xlsx.WorkSheet {
  const stressUnit = unitLabel('stress', uiStore.unitSystem);
  const headers = ['ID', t('excel.name'), `E (${stressUnit})`, 'ν', 'ρ (kN/m³)', `fy (${stressUnit})`];
  const data: (string | number)[][] = [headers];

  for (const mat of modelStore.materials.values()) {
    data.push([
      mat.id,
      mat.name,
      toDisplay(mat.e, 'stress', uiStore.unitSystem),
      mat.nu,
      mat.rho,
      mat.fy == null ? '-' : toDisplay(mat.fy, 'stress', uiStore.unitSystem),
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{ wch: 5 }, { wch: 20 }, { wch: 12 }, { wch: 8 }, { wch: 12 }, { wch: 12 }];
  return ws;
}

function createSectionsSheet(): Xlsx.WorkSheet {
  const headers = ['ID', t('excel.name'), t('excel.shape'), 'A (m²)', 'Iy (m⁴)'];
  headers.push('b (m)', 'h (m)', 'tw (m)', 'tf (m)');

  const data: (string | number)[][] = [headers];

  for (const sec of modelStore.sections.values()) {
    const row: (string | number)[] = [sec.id, sec.name, sec.shape ?? 'rect', sec.a, sec.iy ?? sec.iz];
    row.push(sec.b ?? '-', sec.h ?? '-', sec.tw ?? '-', sec.tf ?? '-');
    data.push(row);
  }

  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = headers.map(() => ({ wch: 12 }));
  return ws;
}

export async function exportToExcel(options: ExcelExportOptions = {}): Promise<void> {
  if (!(await loadXlsxModule())) return;

  /*
   * Everything below reads the stores, and it reads them AFTER the await.
   *
   * Only the first export of a session actually waits — the module is cached
   * afterwards — and nobody edits a model between pressing a button and the
   * file arriving. But the workbook is a snapshot taken at resolution, not at
   * the click, and in an application that spends this much effort on a result
   * matching the model that produced it, that is worth saying out loud rather
   * than leaving for someone to discover.
   */
  const {
    filename = 'analisis-estructural.xlsx',
    includeResults = true,
    extraSheets = [],
    onlyExtras = false,
  } = options;

  const hasResults = !!resultsStore.results;

  const wb = XLSX.utils.book_new();

  if (!onlyExtras) {
    XLSX.utils.book_append_sheet(wb, createSummarySheet(), t('excel.sheetSummary'));
    XLSX.utils.book_append_sheet(wb, createElementsSheet(), t('excel.sheetElements'));
    XLSX.utils.book_append_sheet(wb, createNodesSheet(), t('excel.sheetNodes'));

    if (includeResults && hasResults) {
      XLSX.utils.book_append_sheet(wb, createReactionsSheet(), t('excel.sheetReactions'));
    }

    XLSX.utils.book_append_sheet(wb, createMaterialsSheet(), t('excel.sheetMaterials'));
    XLSX.utils.book_append_sheet(wb, createSectionsSheet(), t('excel.sheetSections'));
  }

  for (const extra of extraSheets) {
    XLSX.utils.book_append_sheet(
      wb, XLSX.utils.aoa_to_sheet(extra.rows as (string | number)[][]),
      extra.name.slice(0, 31));
  }

  XLSX.writeFile(wb, filename);
}
