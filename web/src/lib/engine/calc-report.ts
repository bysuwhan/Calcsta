/**
 * Basic Structural Calc-Book Report Generator
 *
 * Generates a printable HTML report covering model data, loads, and analysis results.
 * Generates reports for the Basic 2D analysis path.
 * Uses a Blob URL and the browser print dialog for PDF output.
 */

import type { Node, Material, Section, Element, Support } from '../store/model.svelte';
import type { AnalysisResults } from './types';
import { releaseLabel } from '../export/excel';
import { toDisplay, unitLabel, type Quantity, type UnitSystem } from '../utils/units';

// ─── Types ───────────────────────────────────────────────────────

export interface CalcReportConfig {
  projectName: string;
  engineerName: string;
  companyName: string;
  date: string;
  notes: string;
}

export type ResultProvenance =
  | { kind: 'single'; caseName?: string }
  | { kind: 'combo'; comboName: string }
  | { kind: 'envelope' };

export type AnalysisModeLabel = '2D';

export interface CalcReportData {
  config: CalcReportConfig;
  analysisMode: AnalysisModeLabel;
  provenance: ResultProvenance;
  hasDesignChecks: boolean;
  unitSystem: UnitSystem;
  // Model
  nodes: Node[];
  elements: Element[];
  materials: Material[];
  sections: Section[];
  supports: Support[];
  loads: Array<{ type: string; description: string; caseLabel?: string }>;
  loadCases: Array<{ id: number; type: string; name: string }>;
  combinations: Array<{ id: number; name: string; factors: Array<{ caseName: string; factor: number }> }>;
  // Basic 2D results
  results2D?: AnalysisResults;
}

// ─── Formatting utilities ────────────────────────────────────────

function fmt(n: number, dec = 2): string {
  if (Math.abs(n) < 1e-10) return '0';
  if (Math.abs(n) < 0.001 && Math.abs(n) > 1e-10) return n.toExponential(2);
  return n.toFixed(dec);
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const value = (n: number, quantity: Quantity, data: CalcReportData) => toDisplay(n, quantity, data.unitSystem);
const unit = (quantity: Quantity, data: CalcReportData) => unitLabel(quantity, data.unitSystem);

// ─── CSS ─────────────────────────────────────────────────────────

const CALC_REPORT_CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; font-size: 10pt; color: #222; line-height: 1.5; padding: 0; }

  /* Print controls */
  .print-btn { position: fixed; top: 12px; right: 12px; z-index: 999; padding: 8px 20px; background: #1a4a7a; color: white; border: none; border-radius: 5px; cursor: pointer; font-size: 11pt; font-weight: 600; }
  .print-btn:hover { background: #0f3460; }
  @media print { .no-print { display: none !important; } }

  /* Pages */
  .page { max-width: 210mm; margin: 0 auto; padding: 15mm 20mm; }
  .page-break { page-break-after: always; break-after: page; }
  @media print { .page { max-width: none; margin: 0; padding: 10mm 15mm; } }

  /* Cover */
  .cover { text-align: center; padding-top: 80px; min-height: 90vh; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .cover h1 { font-size: 22pt; color: #1a4a7a; margin-bottom: 12px; }
  .cover .subtitle { font-size: 12pt; color: #555; margin-bottom: 4px; }
  .cover .meta { font-size: 9pt; color: #888; margin-top: 30px; }
  .cover .meta div { margin: 3px 0; }
  .cover .footer { margin-top: 40px; font-size: 8pt; color: #aaa; }

  /* Headings */
  h1 { font-size: 16pt; color: #1a4a7a; border-bottom: 2px solid #1a4a7a; padding-bottom: 4px; margin: 24px 0 12px; }
  h2 { font-size: 12pt; color: #333; margin: 16px 0 8px; }
  h3 { font-size: 10pt; color: #555; margin: 10px 0 6px; }

  /* Tables */
  table { width: 100%; border-collapse: collapse; margin: 8px 0 16px; font-size: 8.5pt; }
  th { background: #f0f4f8; color: #333; font-weight: 600; text-align: left; padding: 5px 8px; border: 1px solid #ccc; white-space: nowrap; }
  td { padding: 4px 8px; border: 1px solid #ddd; }
  tr:nth-child(even) { background: #fafafa; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .table-note { font-size: 8pt; color: #888; margin-top: -10px; margin-bottom: 12px; }

  /* Summary boxes */
  .summary-box { background: #f0f7ff; border: 1px solid #c0d8f0; border-radius: 6px; padding: 12px 16px; margin: 10px 0; }
  .summary-box .label { font-size: 8pt; color: #666; text-transform: uppercase; letter-spacing: 0.05em; }
  .summary-box .value { font-size: 14pt; font-weight: 700; color: #1a4a7a; }

  /* Governing highlight */
  .governing { background: #fff8e0; font-weight: 600; }

  /* Report metadata block */
  .report-meta { border: 1px solid #c0cdd8; border-radius: 6px; margin: 0 0 16px; overflow: hidden; }
  .report-meta table { margin: 0; border: none; font-size: 9pt; }
  .report-meta th { background: #f0f4f8; border: none; border-bottom: 1px solid #ddd; width: 140px; font-size: 8pt; text-transform: uppercase; letter-spacing: 0.04em; color: #666; vertical-align: top; padding: 6px 12px; }
  .report-meta td { border: none; border-bottom: 1px solid #eee; padding: 6px 12px; color: #222; }
  .report-meta tr:last-child th, .report-meta tr:last-child td { border-bottom: none; }
  .report-meta .meta-note { font-size: 7.5pt; color: #888; margin-top: 2px; }
  .report-meta .meta-warn { font-size: 7.5pt; color: #a05020; font-weight: 600; margin-top: 2px; }

  /* TOC */
  .toc a { color: #1a4a7a; text-decoration: none; }
  .toc a:hover { text-decoration: underline; }
  .toc-entry { padding: 3px 0; font-size: 10pt; }

  /* Equilibrium */
`;

// ─── Report Metadata Block ────────────────────────────────────────

function buildReportMetadata(data: CalcReportData): string {
  // Result basis
  let basisLabel: string;
  let basisNote: string;
  const prov = data.provenance;
  if (prov.kind === 'envelope') {
    basisLabel = 'Envelope of all load combinations';
    basisNote = 'Peak absolute values across all combinations. They do not necessarily occur simultaneously. Do not use envelope values directly for member design without checking the governing combination.';
  } else if (prov.kind === 'combo') {
    basisLabel = esc(prov.comboName);
    basisNote = 'Results correspond to a single load combination. Other combinations may govern for different members or checks.';
  } else {
    basisLabel = prov.caseName ? esc(prov.caseName) : 'Single analysis';
    basisNote = 'Results without load combination factors. These are not design values.';
  }

  // Report type — always "Analysis Only" until design-check tables are
  // actually rendered in the report body.  hasDesignChecks is kept in the
  // data interface so this gate can flip once that section exists.
  const reportType = 'Analysis Only';
  const typeNote = 'This report does not include design code checks. The absence of design checks does not imply that members are adequate.';
  const typeNoteClass = 'meta-warn';

  const h: string[] = ['<div class="report-meta"><table>'];
  h.push(`<tr><th>Report type</th><td>${reportType}<div class="${typeNoteClass}">${typeNote}</div></td></tr>`);
  h.push(`<tr><th>Result basis</th><td>${basisLabel}<div class="meta-note">${basisNote}</div></td></tr>`);
  h.push('</table></div>');
  return h.join('\n');
}

// ─── Table of Contents ───────────────────────────────────────────

function buildTOC(sections: Array<{ num: string; title: string; anchor: string }>): string {
  const h: string[] = ['<div class="page"><h1>Table of Contents</h1>'];
  for (const s of sections) {
    h.push(`<div class="toc-entry"><a href="#${s.anchor}">${esc(s.num)}. ${esc(s.title)}</a></div>`);
  }
  h.push('</div><div class="page-break"></div>');
  return h.join('\n');
}

// ─── Section: Cover ──────────────────────────────────────────────

function buildCover(cfg: CalcReportConfig, modeLabel: AnalysisModeLabel, nodeCount: number, elemCount: number): string {
  const h: string[] = ['<div class="page cover">'];
  if (cfg.companyName) h.push(`<div style="font-size:11pt;color:#555;letter-spacing:2px;text-transform:uppercase;margin-bottom:24px">${esc(cfg.companyName)}</div>`);
  h.push(`<h1 style="border:none;font-size:24pt">${esc(cfg.projectName || 'Structural Analysis')}</h1>`);
  h.push(`<div class="subtitle">Structural Calculation Report</div>`);
  h.push(`<div class="subtitle">${modeLabel} Analysis &mdash; ${nodeCount} nodes, ${elemCount} elements</div>`);
  h.push('<div class="meta">');
  if (cfg.engineerName) h.push(`<div>Engineer: ${esc(cfg.engineerName)}</div>`);
  h.push(`<div>Date: ${esc(cfg.date)}</div>`);
  h.push('</div>');
  h.push('<div class="footer">Generated by Calcsta &mdash; calcsta.pages.dev</div>');
  h.push('</div><div class="page-break"></div>');
  return h.join('\n');
}

// ─── Section: Model Data ─────────────────────────────────────────

function buildModelSection(data: CalcReportData): string {
  const h: string[] = ['<div class="page">'];
  h.push('<h1 id="sec-model">1. Model Data</h1>');

  // 1.1 Materials
  h.push(`<h2>1.1 Materials (${data.materials.length})</h2>`);
  h.push(`<table><tr><th>ID</th><th>Name</th><th>E (${unit('stress', data)})</th><th>&nu;</th><th>&rho; (${unit('density', data)})</th><th>fy (${unit('stress', data)})</th></tr>`);
  for (const m of data.materials) {
    h.push(`<tr><td>${m.id}</td><td>${esc(m.name)}</td><td class="num">${fmt(value(m.e, 'stress', data), 3)}</td><td class="num">${fmt(m.nu ?? 0.3, 2)}</td><td class="num">${fmt(value(m.rho ?? 0, 'density', data), 6)}</td><td class="num">${fmt(value(m.fy ?? 0, 'stress', data), 3)}</td></tr>`);
  }
  h.push('</table>');

  // 1.2 Sections
  h.push(`<h2>1.2 Sections (${data.sections.length})</h2>`);
  h.push(`<table><tr><th>ID</th><th>Name</th><th>A (${unit('area', data)})</th><th>Iy (${unit('inertia', data)})</th><th>Iz (${unit('inertia', data)})</th><th>J (${unit('inertia', data)})</th></tr>`);
  for (const s of data.sections) {
    h.push(`<tr><td>${s.id}</td><td>${esc(s.name)}</td><td class="num">${fmt(value(s.a, 'area', data), 5)}</td><td class="num">${fmt(value(s.iy ?? 0, 'inertia', data), 5)}</td><td class="num">${fmt(value(s.iz ?? s.iy ?? 0, 'inertia', data), 5)}</td><td class="num">${fmt(value(s.j ?? 0, 'inertia', data), 5)}</td></tr>`);
  }
  h.push('</table>');

  // 1.3 Nodes
  const nodeCount = data.nodes.length;
  const condensed = nodeCount > 50;
  h.push(`<h2>1.3 Nodes (${nodeCount})</h2>`);
  h.push(`<table><tr><th>ID</th><th>X (${unit('length', data)})</th><th>Y (${unit('length', data)})</th></tr>`);
  const showNodes = condensed ? [...data.nodes.slice(0, 20), null, ...data.nodes.slice(-5)] : data.nodes;
  for (const n of showNodes) {
    if (!n) { h.push(`<tr><td colspan="3" style="text-align:center;color:#888">... ${nodeCount - 25} more nodes ...</td></tr>`); continue; }
    h.push(`<tr><td>${n.id}</td><td class="num">${fmt(value(n.x, 'length', data), 3)}</td><td class="num">${fmt(value(n.y, 'length', data), 3)}</td></tr>`);
  }
  h.push('</table>');
  if (condensed) h.push(`<p class="table-note">Showing 25 of ${nodeCount} nodes. Full data available in Excel export.</p>`);

  // 1.4 Elements
  const elemCount = data.elements.length;
  const elemCondensed = elemCount > 50;
  h.push(`<h2>1.4 Elements (${elemCount})</h2>`);
  h.push('<table><tr><th>ID</th><th>Type</th><th>Node I</th><th>Node J</th><th>Material</th><th>Section</th><th>Hinges</th></tr>');
  const showElems = elemCondensed ? [...data.elements.slice(0, 20), null, ...data.elements.slice(-5)] : data.elements;
  for (const e of showElems) {
    if (!e) { h.push(`<tr><td colspan="7" style="text-align:center;color:#888">... ${elemCount - 25} more elements ...</td></tr>`); continue; }
    const iLabel = releaseLabel(e.releaseI);
    const jLabel = releaseLabel(e.releaseJ);
    const hinges = iLabel || jLabel ? `I: ${iLabel || '—'} · J: ${jLabel || '—'}` : '—';
    h.push(`<tr><td>${e.id}</td><td>${e.type}</td><td>${e.nodeI}</td><td>${e.nodeJ}</td><td>${e.materialId}</td><td>${e.sectionId}</td><td>${hinges}</td></tr>`);
  }
  h.push('</table>');
  if (elemCondensed) h.push(`<p class="table-note">Showing 25 of ${elemCount} elements.</p>`);

  // 1.5 Supports
  h.push(`<h2>1.5 Supports (${data.supports.length})</h2>`);
  h.push('<table><tr><th>ID</th><th>Node</th><th>Type</th></tr>');
  for (const s of data.supports) {
    h.push(`<tr><td>${s.id}</td><td>${s.nodeId}</td><td>${esc(s.type)}</td></tr>`);
  }
  h.push('</table>');

  h.push('</div><div class="page-break"></div>');
  return h.join('\n');
}

// ─── Section: Loads ──────────────────────────────────────────────

function buildLoadsSection(data: CalcReportData): string {
  const h: string[] = ['<div class="page">'];
  h.push('<h1 id="sec-loads">2. Loads</h1>');

  // 2.1 Load Cases
  if (data.loadCases.length > 0) {
    h.push(`<h2>2.1 Load Cases (${data.loadCases.length})</h2>`);
    h.push('<table><tr><th>ID</th><th>Type</th><th>Name</th></tr>');
    for (const lc of data.loadCases) {
      h.push(`<tr><td>${lc.id}</td><td>${esc(lc.type)}</td><td>${esc(lc.name)}</td></tr>`);
    }
    h.push('</table>');
  }

  // 2.2 Combinations
  if (data.combinations.length > 0) {
    h.push(`<h2>2.2 Load Combinations (${data.combinations.length})</h2>`);
    h.push('<table><tr><th>ID</th><th>Name</th><th>Factors</th></tr>');
    for (const c of data.combinations) {
      const factors = c.factors.map(f => `${fmt(f.factor, 2)}×${esc(f.caseName)}`).join(' + ');
      h.push(`<tr><td>${c.id}</td><td>${esc(c.name)}</td><td>${factors}</td></tr>`);
    }
    h.push('</table>');
  }

  // 2.3 Applied loads
  h.push(`<h2>2.3 Applied Loads (${data.loads.length})</h2>`);
  if (data.loads.length > 0) {
    h.push('<table><tr><th>#</th><th>Type</th><th>Description</th><th>Case</th></tr>');
    // Condensed view keeps each row numbered by its true position in the
    // full load list (the tail rows are loads N-4…N, not 32…36).
    const numbered = data.loads.map((l, i) => ({ l, n: i + 1 }));
    const showLoads = data.loads.length > 40
      ? [...numbered.slice(0, 30), null, ...numbered.slice(-5)]
      : numbered;
    for (const row of showLoads) {
      if (!row) { h.push(`<tr><td colspan="4" style="text-align:center;color:#888">... ${data.loads.length - 35} more loads ...</td></tr>`); continue; }
      const { l, n } = row;
      h.push(`<tr><td>${n}</td><td>${esc(l.type)}</td><td>${esc(l.description)}</td><td>${esc(l.caseLabel ?? '—')}</td></tr>`);
    }
    h.push('</table>');
  } else {
    h.push('<p>No applied loads.</p>');
  }

  h.push('</div><div class="page-break"></div>');
  return h.join('\n');
}

// ─── Section: Reactions ──────────────────────────────────────────

function buildReactionsSection(data: CalcReportData): string {
  const h: string[] = ['<div class="page">'];
  h.push('<h1 id="sec-reactions">3. Support Reactions</h1>');

  if (data.results2D) {
    const reactions = data.results2D.reactions;
    h.push(`<table><tr><th>Node</th><th>Rx (${unit('force', data)})</th><th>Rz (${unit('force', data)})</th><th>My (${unit('moment', data)})</th></tr>`);
    let sumRx = 0, sumRz = 0;
    for (const r of reactions) {
      h.push(`<tr><td>${r.nodeId}</td><td class="num">${fmt(value(r.rx, 'force', data))}</td><td class="num">${fmt(value(r.rz, 'force', data))}</td><td class="num">${fmt(value(r.my, 'moment', data))}</td></tr>`);
      sumRx += r.rx; sumRz += r.rz;
    }
    h.push(`<tr style="font-weight:700;border-top:2px solid #333"><td>ΣR</td><td class="num">${fmt(value(sumRx, 'force', data))}</td><td class="num">${fmt(value(sumRz, 'force', data))}</td><td></td></tr>`);
    h.push('</table>');
    h.push(buildReactionSumNote(data));
  }

  h.push('</div><div class="page-break"></div>');
  return h.join('\n');
}

/** Note accompanying the reaction-sum row. The solver reports reactions that
 *  balance the applied loads (Σreactions = −Σapplied), so the sum is only ≈ 0
 *  for unloaded or self-equilibrated models — it must NOT be tested against
 *  zero as an "equilibrium check". For envelope results the per-node values
 *  come from different combinations, so the sum has no physical meaning. */
function buildReactionSumNote(data: CalcReportData): string {
  if (data.provenance.kind === 'envelope') {
    return '<p>Note: envelope values are per-node extremes across combinations; the Σ row is not a physical load balance.</p>';
  }
  return '<p>Support reactions balance the applied loads for the reported '
    + 'case/combination (equal and opposite resultants, including self-weight '
    + 'when enabled): Σreactions + Σapplied = 0.</p>';
}

// ─── Section: Displacements ──────────────────────────────────────

function buildDisplacementsSection(data: CalcReportData): string {
  const h: string[] = ['<div class="page">'];
  h.push('<h1 id="sec-displacements">4. Displacements</h1>');

  if (data.results2D) {
    const disps = data.results2D.displacements;
    let maxMag = 0, maxNodeId = 0;
    for (const d of disps) {
      const mag = Math.sqrt(d.ux ** 2 + (d.uz ?? 0) ** 2);
      if (mag > maxMag) { maxMag = mag; maxNodeId = d.nodeId; }
    }
    h.push(`<div class="summary-box"><div class="label">Maximum displacement</div><div class="value">${fmt(value(maxMag, 'displacement', data), 3)} ${unit('displacement', data)}</div><div class="label">at node ${maxNodeId}</div></div>`);

    h.push(`<table><tr><th>Node</th><th>ux (${unit('displacement', data)})</th><th>uz (${unit('displacement', data)})</th><th>θy (rad)</th><th>|u| (${unit('displacement', data)})</th></tr>`);
    for (const d of disps) {
      const uz = d.uz ?? 0;
      const mag = Math.sqrt(d.ux ** 2 + uz ** 2);
      const isMax = d.nodeId === maxNodeId;
      h.push(`<tr${isMax ? ' class="governing"' : ''}><td>${d.nodeId}</td><td class="num">${fmt(value(d.ux, 'displacement', data), 3)}</td><td class="num">${fmt(value(uz, 'displacement', data), 3)}</td><td class="num">${fmt(d.ry ?? 0, 6)}</td><td class="num">${fmt(value(mag, 'displacement', data), 3)}</td></tr>`);
    }
    h.push('</table>');
  }

  h.push('</div><div class="page-break"></div>');
  return h.join('\n');
}

// ─── Section: Internal Forces ────────────────────────────────────

function buildForcesSection(data: CalcReportData): string {
  const h: string[] = ['<div class="page">'];
  h.push('<h1 id="sec-forces">5. Internal Forces</h1>');

  if (data.results2D) {
    const forces = data.results2D.elementForces;
    let maxN = 0, maxV = 0, maxM = 0;
    for (const ef of forces) {
      maxN = Math.max(maxN, Math.abs(ef.nStart), Math.abs(ef.nEnd));
      maxV = Math.max(maxV, Math.abs(ef.vStart), Math.abs(ef.vEnd));
      maxM = Math.max(maxM, Math.abs(ef.mStart), Math.abs(ef.mEnd));
    }

    h.push('<h2>5.1 Force Summary</h2>');
    h.push('<table><tr><th>Quantity</th><th>Max |Value|</th><th>Unit</th></tr>');
    h.push(`<tr><td>Axial (N)</td><td class="num">${fmt(value(maxN, 'force', data))}</td><td>${unit('force', data)}</td></tr>`);
    h.push(`<tr><td>Shear (V)</td><td class="num">${fmt(value(maxV, 'force', data))}</td><td>${unit('force', data)}</td></tr>`);
    h.push(`<tr><td>Moment (M)</td><td class="num">${fmt(value(maxM, 'moment', data))}</td><td>${unit('moment', data)}</td></tr>`);
    h.push('</table>');

    h.push('<h2>5.2 Element End Forces</h2>');
    h.push(`<table><tr><th>Elem</th><th>End</th><th>N (${unit('force', data)})</th><th>V (${unit('force', data)})</th><th>M (${unit('moment', data)})</th></tr>`);
    for (const ef of forces) {
      h.push(`<tr><td rowspan="2">${ef.elementId}</td><td>I</td><td class="num">${fmt(value(ef.nStart, 'force', data))}</td><td class="num">${fmt(value(ef.vStart, 'force', data))}</td><td class="num">${fmt(value(ef.mStart, 'moment', data))}</td></tr>`);
      h.push(`<tr><td>J</td><td class="num">${fmt(value(ef.nEnd, 'force', data))}</td><td class="num">${fmt(value(ef.vEnd, 'force', data))}</td><td class="num">${fmt(value(ef.mEnd, 'moment', data))}</td></tr>`);
    }
    h.push('</table>');
  }

  h.push('</div>');
  return h.join('\n');
}

// ─── Main generator ──────────────────────────────────────────────

export function generateCalcReportHtml(data: CalcReportData): string {
  const sections = [
    { num: '1', title: 'Model Data', anchor: 'sec-model' },
    { num: '2', title: 'Loads', anchor: 'sec-loads' },
    { num: '3', title: 'Support Reactions', anchor: 'sec-reactions' },
    { num: '4', title: 'Displacements', anchor: 'sec-displacements' },
    { num: '5', title: 'Internal Forces', anchor: 'sec-forces' },
  ];

  const html: string[] = [];
  html.push(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${esc(data.config.projectName || 'Structural Calculation Report')} — Calcsta</title>
<style>${CALC_REPORT_CSS}</style>
</head>
<body>
<button class="print-btn no-print" onclick="window.print()">Print / PDF</button>
`);

  html.push(buildCover(data.config, data.analysisMode, data.nodes.length, data.elements.length));
  html.push(buildTOC(sections));
  html.push('<div class="page">');
  html.push(buildReportMetadata(data));
  html.push('</div>');
  html.push(buildModelSection(data));
  html.push(buildLoadsSection(data));
  html.push(buildReactionsSection(data));
  html.push(buildDisplacementsSection(data));
  html.push(buildForcesSection(data));

  html.push('</body></html>');
  return html.join('\n');
}

/** Open the calc-book report in a new browser tab for printing. */
export function openCalcReport(data: CalcReportData): void {
  const htmlContent = generateCalcReportHtml(data);
  const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (win) setTimeout(() => URL.revokeObjectURL(url), 120_000);
  else URL.revokeObjectURL(url);
}
