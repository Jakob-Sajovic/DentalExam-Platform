import {
  ExaminationSession,
  FdiToothNumber,
  PBSurface,
  PBToothData,
  ICDASSurface,
  ProbingSite,
  ProbingData,
  FdiQuestionnaireData,
} from "../model/types";
import {
  UPPER_RIGHT,
  UPPER_LEFT,
  LOWER_JAW_MIRRORED,
  ALL_TEETH,
  RESTORATION_LABELS,
  CARIES_LABELS,
  SPECIAL_CASE_LABELS,
  OHIP_DOMAINS,
  OHIP_LIKERT_LABELS,
  OHIP_HEALTH_RATING_QUESTION,
  OHIP_APPEARANCE_RATING_QUESTION,
  OHIP_COMMENT_QUESTION,
  ICDAS_SURFACE_FULL_NAMES,
  PB_SURFACE_TOOLTIPS,
  PROBING_BUCCAL_SITES,
  PROBING_LINGUAL_SITES,
  PROBING_SITE_LABELS,
  PROBING_DEPTH_COLORS,
  PROBING_ALL_SITES,
  ROOT_CARIES_UPPER_TEETH,
  ROOT_CARIES_LOWER_TEETH,
  rootCariesLabels,
  RADIOGRAPH_JAW_LABELS,
} from "../model/constants";
import { RadiographFigure, RadiographJaw } from "../model/types";
import { RADIOGRAPH_JAWS, normalizeRadiographs, figureLabels, locationText } from "../model/radiographs";
import {
  getSurfaceForPosition,
  getICDASSurfaceForPosition,
  VisualPosition,
  ICDASVisualPosition,
} from "../dental/chart-renderer";
import { buildToothOutlinesSvg, TOOTH_CENTER_PCT, SITE_SPREAD } from "../dental/tooth-outlines";
import { isImplantTooth, isToothMissing } from "../model/tooth-status";
import {
  buildDemographicsMeta,
  buildFillingsSection,
  buildWoundSection,
  buildScans3DSection,
  REPORT_PLATFORM_CSS,
} from "./report-platform";

/**
 * Generate a print-friendly HTML report and open it in a new window.
 * The user can then use Ctrl+P / browser print → "Save as PDF".
 */
export function generateReport(session: ExaminationSession): void {
  const html = buildReportHtml(session);
  const win = window.open("", "_blank");
  if (!win) {
    throw new Error("Brskalnik je blokiral odpiranje novega okna. Dovolite pojavna okna za ta dodatek.");
  }
  win.document.write(html);
  win.document.close();
}

function esc(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function patientDisplayName(s: ExaminationSession): string {
  const patient = s.patient;
  return (patient.firstName && patient.lastName)
    ? `${patient.firstName} ${patient.lastName}`
    : (patient.code || "—");
}

/** File name offered for the PDF: code (or name), checkup number and date. */
export function reportFileTitle(s: ExaminationSession): string {
  const who = (s.patient.code || [s.patient.firstName, s.patient.lastName].filter(Boolean).join("_") || "pregled")
    .replace(/[^\w\-.čšžČŠŽ]+/g, "_");
  return `Porocilo_${who}_pregled${s.patient.checkup || 1}_${s.patient.date || "brez-datuma"}`;
}

function buildReportHtml(s: ExaminationSession): string {
  return `<!DOCTYPE html>
<html lang="sl">
<head>
<meta charset="UTF-8">
<title>Poročilo pregleda — ${esc(patientDisplayName(s))}</title>
<style>
${REPORT_CSS}
</style>
</head>
<body>
${buildReportBody(s)}
<script>window.onload = function() { window.print(); }<\/script>
</body>
</html>`;
}

/**
 * The report itself, without the document around it — shared by the add-in's
 * print window and the PWA's in-app report layer.
 */
export function buildReportBody(s: ExaminationSession): string {
  const patient = s.patient;
  const patientName = patientDisplayName(s);

  const examiner = s.examiner || { firstName: "", lastName: "" };
  const examinerName = (examiner.firstName && examiner.lastName)
    ? `${examiner.firstName} ${examiner.lastName}`
    : "—";

  return `
<div class="report">
  <header class="report-header">
    <h1>Zobozdravstveni pregled</h1>
    <div class="report-meta">
      <span><strong>Datum:</strong> ${esc(patient.date || "—")}</span>
      <span><strong>Pregled:</strong> ${patient.checkup || 1}. pregled</span>
      <span><strong>Preiskovanec:</strong> ${esc(patientName)}</span>
      ${patient.code ? `<span><strong>Koda:</strong> ${esc(patient.code)}</span>` : ""}
      ${buildDemographicsMeta(s)}
      <span><strong>Izvajalec:</strong> ${esc(examinerName)}</span>
      <span><strong>ID seje:</strong> ${esc(s.sessionId)}</span>
    </div>
  </header>

  ${buildPBSection("Indeks zobnih oblog — VPI", s.plaque, "#ffd335")}
  ${buildPBSection("Indeks krvavitve dlesni — GBI", s.bleeding, "#ff6b6b")}
  ${buildICDASSection(s)}
  ${buildFillingsSection(s)}
  ${buildICDASRootCariesSection(s)}
  ${buildProbingSection(s)}
  ${buildBOPSection(s)}
  ${buildWoundSection(s)}
  ${buildFurcationSection(s)}
  ${buildNotesSection(s)}
  ${buildRadiographSection(s)}
  ${buildScans3DSection(s)}
  ${buildOhipSection(s)}
  ${buildFdiSection(s)}

  ${buildSignatureSection(examinerName)}
  ${buildAdditionalNotesPage()}

  <footer class="report-footer">
    Ustvarjeno: ${new Date().toLocaleString("sl-SI")}
  </footer>
</div>`;
}


// ── Radiographs ───────────────────────────────────────────────────

// Films per band of the partial-mode mount; wider mounts continue in a new band.
const RTG_REPORT_COLS = 8;

function buildRadiographSection(s: ExaminationSession): string {
  if (!s.radiographs) return "";
  const radio = normalizeRadiographs(s.radiographs);
  const opinion = (radio.opinion || "").trim();
  const opinionBlock = `
    <div class="rtg-r-opinion">
      <h3>Rentgenska diagnoza / mnenje</h3>
      <div class="notes-content">${esc(opinion || "—")}</div>
    </div>`;
  const sides = `<div class="rtg-r-sides"><span>preiskovančeva DESNA</span><span>preiskovančeva LEVA</span></div>`;

  if (radio.mode === "composite") {
    const img = radio.composite;
    if (!img && !opinion) return "";
    return `
  <section class="section page-break rtg-landscape">
    <h2>Rentgenske slike</h2>
    <div class="rtg-r-meta">Ena sestavljena slika</div>
    <div class="rtg-r-mount rtg-r-composite">
      <div class="rtg-r-jaw">${RADIOGRAPH_JAW_LABELS.upper}</div>
      <div class="rtg-r-composite-frame">
        ${img ? `<img src="${img.dataUrl}" alt="Sestavljena rentgenska slika" />` : `<div class="rtg-r-missing">ni posnetka</div>`}
      </div>
      <div class="rtg-r-jaw">${RADIOGRAPH_JAW_LABELS.lower}</div>
      ${sides}
    </div>
    ${opinionBlock}
  </section>`;
  }

  const films = [...radio.upper, ...radio.lower].filter((f) => !f.skip);
  // Nothing to show at all — skip the page entirely rather than print a blank.
  if (films.length === 0 && !opinion) return "";

  const labels: Record<RadiographJaw, string[]> = {
    upper: figureLabels("upper", radio.upper),
    lower: figureLabels("lower", radio.lower),
  };
  const total = Math.max(radio.upper.length, radio.lower.length);
  const cols = Math.max(1, Math.min(RTG_REPORT_COLS, total));

  const cell = (jaw: RadiographJaw, f: RadiographFigure | undefined, i: number) => {
    if (!f || f.skip) return `<div class="rtg-r-cell rtg-r-skip"></div>`;
    const label = labels[jaw][i];
    const body = f.image
      ? `<img src="${f.image.dataUrl}" alt="${esc(label)}" />`
      : `<div class="rtg-r-missing">ni posnetka</div>`;
    const loc = locationText(f);
    return `
        <div class="rtg-r-cell">
          <div class="rtg-r-frame">${body}</div>
          <div class="rtg-r-label"><strong>${esc(label)}</strong>${loc ? ` · ${esc(loc)}` : ""}</div>
        </div>`;
  };

  const bands: string[] = [];
  for (let start = 0; start < Math.max(total, 1); start += cols) {
    const row = (jaw: RadiographJaw) => {
      const cells: string[] = [];
      for (let i = start; i < start + cols; i++) cells.push(cell(jaw, radio[jaw][i], i));
      return `<div class="rtg-r-row" data-cols="${cols}" style="grid-template-columns: repeat(${cols}, 1fr)">${cells.join("")}</div>`;
    };
    bands.push(`
    <div class="rtg-r-mount">
      <div class="rtg-r-jaw">${RADIOGRAPH_JAW_LABELS.upper}</div>
      ${row("upper")}
      ${row("lower")}
      <div class="rtg-r-jaw">${RADIOGRAPH_JAW_LABELS.lower}</div>
      ${sides}
    </div>`);
  }

  const notes = RADIOGRAPH_JAWS.flatMap((jaw) =>
    radio[jaw]
      .map((f, i) => ({ f, label: labels[jaw][i] }))
      .filter(({ f }) => !f.skip && (f.annotation || "").trim())
      .map(({ f, label }) => {
        const loc = locationText(f);
        return `<li><strong>${esc(label)}${loc ? ` (${esc(loc)})` : ""}:</strong> ${esc(f.annotation.trim())}</li>`;
      })
  ).join("");

  const count = (jaw: RadiographJaw) => radio[jaw].filter((f) => !f.skip).length;

  return `
  <section class="section page-break rtg-landscape">
    <h2>Rentgenske slike</h2>
    <div class="rtg-r-meta">Delni posnetki — zgornja čeljust: ${count("upper")}, spodnja čeljust: ${count("lower")}</div>
    ${bands.join("")}
    ${notes ? `<div class="rtg-r-captions"><h3>Opisi posnetkov</h3><ul>${notes}</ul></div>` : ""}
    ${opinionBlock}
  </section>`;
}

// ── VPI / GBI section ─────────────────────────────────────────────

function buildPBSection(title: string, data: Record<FdiToothNumber, PBToothData>, activeColor: string): string {
  const surfaces: PBSurface[] = ["mesial", "distal", "buccal", "lingual"];
  let totalSurf = 0;
  let activeSurf = 0;

  for (const tooth of ALL_TEETH) {
    const td = data[tooth];
    if (!td.present) continue;
    for (const sf of surfaces) {
      totalSurf++;
      if (td[sf]) activeSurf++;
    }
  }

  const pct = totalSurf > 0 ? ((activeSurf / totalSurf) * 100).toFixed(1) : "0.0";

  const upperTeeth = [...UPPER_RIGHT, ...UPPER_LEFT];
  const lowerTeeth = [...LOWER_JAW_MIRRORED];

  return `
  <section class="section">
    <h2>${title}</h2>
    <p class="score"><strong>${pct}%</strong> (${activeSurf} od ${totalSurf} površin)</p>
    <div class="chart-figure">${buildPBChartSvg(data, activeColor)}</div>
    ${buildPBTransposedTable("Zgornja čeljust", upperTeeth, data, surfaces, activeColor)}
    ${buildPBTransposedTable("Spodnja čeljust", lowerTeeth, data, surfaces, activeColor)}
  </section>`;
}

function buildPBTransposedTable(
  jawLabel: string,
  teeth: FdiToothNumber[],
  data: Record<FdiToothNumber, PBToothData>,
  surfaces: PBSurface[],
  activeColor: string
): string {
  const colCount = teeth.length + 1;
  let html = `<table class="pb-table">`;
  html += `<thead>`;
  html += `<tr class="jaw-label-row"><td colspan="${colCount}">${jawLabel}</td></tr>`;
  html += `<tr><th class="surface-label-cell"></th>`;
  for (const tooth of teeth) {
    html += `<th>${tooth}</th>`;
  }
  html += `</tr></thead><tbody>`;

  for (const sf of surfaces) {
    html += `<tr><td class="surface-label-cell">${PB_SURFACE_TOOLTIPS[sf]}</td>`;
    for (const tooth of teeth) {
      const td = data[tooth];
      if (!td.present) {
        html += `<td class="missing-cell">—</td>`;
      } else {
        const active = td[sf];
        html += `<td class="${active ? "active-cell" : ""}" ${active ? `style="background:${activeColor}"` : ""}>${active ? "●" : "○"}</td>`;
      }
    }
    html += `</tr>`;
  }

  html += `</tbody></table>`;
  return html;
}

// ── ICDAS section ─────────────────────────────────────────────────

function buildICDASSection(s: ExaminationSession): string {
  const icdas = s.icdas;

  const upperTeeth = [...UPPER_RIGHT, ...UPPER_LEFT];
  const lowerTeeth = [...LOWER_JAW_MIRRORED];

  return `
  <section class="section page-break">
    <h2>ICDAS ocena</h2>
    <div class="chart-figure">${buildICDASChartSvg(icdas)}</div>
    <div class="chart-legend">
      <span class="legend-item"><span class="legend-swatch" style="background:#d4edda"></span>0</span>
      <span class="legend-item"><span class="legend-swatch" style="background:#fff3cd"></span>1</span>
      <span class="legend-item"><span class="legend-swatch" style="background:#ffeeba"></span>2</span>
      <span class="legend-item"><span class="legend-swatch" style="background:#ffcc80"></span>3</span>
      <span class="legend-item"><span class="legend-swatch" style="background:#ffab91"></span>4</span>
      <span class="legend-item"><span class="legend-swatch" style="background:#ef9a9a"></span>5</span>
      <span class="legend-item"><span class="legend-swatch" style="background:#e57373"></span>6</span>
      <span class="legend-item"><span class="legend-swatch" style="background:#fff;border:1.5px solid #2196F3"></span>Restavracije</span>
      <span class="legend-item"><span class="legend-swatch" style="background:#e0e0e0"></span>Poseben</span>
    </div>
    ${buildICDASTransposedTable("Zgornja čeljust", upperTeeth, icdas)}
    ${buildICDASTransposedTable("Spodnja čeljust", lowerTeeth, icdas)}
  </section>`;
}

function buildICDASTransposedTable(
  jawLabel: string,
  teeth: FdiToothNumber[],
  icdas: ExaminationSession["icdas"]
): string {
  const icdasSurfaces: ICDASSurface[] = ["mesial", "distal", "buccal", "lingual", "occlusal"];
  const colCount = teeth.length + 1;

  let html = `<table class="icdas-table">`;
  html += `<thead>`;
  html += `<tr class="jaw-label-row"><td colspan="${colCount}">${jawLabel}</td></tr>`;
  html += `<tr><th class="surface-label-cell"></th>`;
  for (const tooth of teeth) {
    html += `<th>${tooth}</th>`;
  }
  html += `</tr></thead><tbody>`;

  // "Stanje" row
  html += `<tr><td class="surface-label-cell">Stanje</td>`;
  for (const tooth of teeth) {
    const td = icdas[tooth];
    if (td.status === "special") {
      const code = td.specialCode || "—";
      const label = td.specialCode ? SPECIAL_CASE_LABELS[td.specialCode] || "" : "";
      html += `<td class="special-row" title="${esc(label)}">${code}</td>`;
    } else {
      html += `<td>N</td>`;
    }
  }
  html += `</tr>`;

  // Surface rows
  for (const sf of icdasSurfaces) {
    html += `<tr><td class="surface-label-cell">${ICDAS_SURFACE_FULL_NAMES[sf]}</td>`;
    for (const tooth of teeth) {
      const td = icdas[tooth];
      // Implants (90/91) keep their surface codes in the table
      if (td.status === "special" && !isImplantTooth(td)) {
        html += `<td class="missing-cell">—</td>`;
      } else {
        const sd = td.surfaces[sf];
        const rest = sd.restoration !== null ? String(sd.restoration) : "—";
        const car = sd.caries !== null ? String(sd.caries) : "—";
        const restLabel = sd.restoration !== null ? RESTORATION_LABELS[sd.restoration] : "";
        const carLabel = sd.caries !== null ? CARIES_LABELS[sd.caries] : "";
        html += `<td title="${esc(restLabel)} / ${esc(carLabel)}">${rest}/${car}</td>`;
      }
    }
    html += `</tr>`;
  }

  html += `</tbody></table>`;
  return html;
}

// ── Probing section ──────────────────────────────────────────────

function getProbingDepthColor(avg: number): string {
  for (const tier of PROBING_DEPTH_COLORS) {
    if (avg <= tier.max) return tier.color;
  }
  return PROBING_DEPTH_COLORS[PROBING_DEPTH_COLORS.length - 1].color;
}

function buildProbingSection(s: ExaminationSession): string {
  if (!s.probing) return "";

  const upperTeeth = [...UPPER_RIGHT, ...UPPER_LEFT];
  const lowerTeeth = [...LOWER_JAW_MIRRORED];

  return `
  <section class="section page-break">
    <h2>Globine sondiranja</h2>
    <div class="chart-legend">
      <span class="legend-item"><span class="legend-swatch" style="background:#4caf50"></span>&le;3 mm</span>
      <span class="legend-item"><span class="legend-swatch" style="background:#ffc107"></span>4 mm</span>
      <span class="legend-item"><span class="legend-swatch" style="background:#ff9800"></span>5 mm</span>
      <span class="legend-item"><span class="legend-swatch" style="background:#f44336"></span>&ge;6 mm</span>
    </div>
    ${buildProbingJawReport("Zgornja čeljust", upperTeeth, s.probing, "upper")}
    ${buildProbingJawReport("Spodnja čeljust", lowerTeeth, s.probing, "lower")}
  </section>`;
}

function buildProbingAreaChartSvg(
  teeth: FdiToothNumber[],
  sites: ProbingSite[],
  data: ProbingData,
  width: number,
  jaw: "upper" | "lower"
): string {
  const chartH = 40;
  const maxDepth = 12;
  const sitesPerTooth = sites.length; // 3
  const spreadW = width * (SITE_SPREAD / 100);

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${chartH}" style="width:100%;max-width:${width}px;height:${chartH}px;" preserveAspectRatio="none">`);

  // Tooth outline background
  parts.push(buildToothOutlinesSvg(teeth, jaw, width, chartH));

  const y3 = chartH * (3 / maxDepth);
  const y6 = chartH * (6 / maxDepth);
  parts.push(`<line x1="0" y1="${y3}" x2="${width}" y2="${y3}" stroke="#ccc" stroke-width="0.3" stroke-dasharray="2,2"/>`);
  parts.push(`<line x1="0" y1="${y6}" x2="${width}" y2="${y6}" stroke="#ccc" stroke-width="0.3" stroke-dasharray="2,2"/>`);

  const polylinePoints: string[] = [];

  for (let ti = 0; ti < teeth.length; ti++) {
    const tooth = teeth[ti];
    const td = data[tooth];
    const centerX = width * (TOOTH_CENTER_PCT[ti] / 100);

    if (!td.present) continue;

    const vals: (number | null)[] = sites.map(s => td[s]);
    const hasData = vals.some(v => v !== null && v > 0);

    const siteXs = [
      centerX - spreadW,
      centerX,
      centerX + spreadW,
    ];

    if (!hasData) {
      for (let si = 0; si < sitesPerTooth; si++) {
        polylinePoints.push(`${siteXs[si].toFixed(1)},0`);
      }
      continue;
    }

    const numericVals = vals.filter(v => v !== null) as number[];
    const avg = numericVals.length > 0 ? numericVals.reduce((a, b) => a + b, 0) / numericVals.length : 0;
    const color = getProbingDepthColor(avg);

    const toothPolyPts: string[] = [];

    for (let si = 0; si < sitesPerTooth; si++) {
      const v = vals[si] ?? 0;
      const py = Math.min(chartH, chartH * (v / maxDepth));
      toothPolyPts.push(`${siteXs[si].toFixed(1)},${py.toFixed(1)}`);
      polylinePoints.push(`${siteXs[si].toFixed(1)},${py.toFixed(1)}`);
    }

    toothPolyPts.push(`${siteXs[2].toFixed(1)},0`);
    toothPolyPts.push(`${siteXs[0].toFixed(1)},0`);

    parts.push(`<polygon points="${toothPolyPts.join(" ")}" fill="${color}" opacity="0.5"/>`);
  }

  if (polylinePoints.length > 0) {
    parts.push(`<polyline points="${polylinePoints.join(" ")}" fill="none" stroke="#333" stroke-width="0.6"/>`);
  }

  parts.push(`</svg>`);
  return parts.join("");
}

function buildProbingJawReport(
  jawLabel: string,
  teeth: FdiToothNumber[],
  data: ProbingData,
  jaw: "upper" | "lower"
): string {
  const reportW = 600;

  // Upper: buccal top + palatal bottom; Lower: lingual top + buccal bottom
  const topSide = jaw === "upper" ? "buccal" : "lingual";
  const bottomSide = jaw === "upper" ? "lingual" : "buccal";
  const topLabel = jaw === "upper" ? "Bukalno" : "Lingvalno";
  const bottomLabel = jaw === "upper" ? "Palatinalno" : "Bukalno";
  const topSites = jaw === "upper" ? PROBING_BUCCAL_SITES : PROBING_LINGUAL_SITES;
  const bottomSites = jaw === "upper" ? PROBING_LINGUAL_SITES : PROBING_BUCCAL_SITES;

  let html = `<h3 style="margin:12px 0 4px;">${jawLabel}</h3>`;

  // Top chart
  html += `<div style="font-size:9px;color:#888;margin-bottom:2px;">${topLabel}</div>`;
  html += `<div class="probing-report-chart">${buildProbingAreaChartSvg(teeth, topSites, data, reportW, jaw)}</div>`;

  // Tooth number row between charts
  html += `<div class="probing-report-chart"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${reportW} 12" style="width:100%;max-width:${reportW}px;height:12px;" preserveAspectRatio="none">`;
  for (let i = 0; i < teeth.length; i++) {
    const cx = reportW * (TOOTH_CENTER_PCT[i] / 100);
    html += `<text x="${cx.toFixed(1)}" y="9" text-anchor="middle" font-size="7" font-family="Segoe UI, sans-serif" fill="#555">${teeth[i]}</text>`;
  }
  html += `</svg></div>`;

  // Bottom chart
  html += `<div style="font-size:9px;color:#888;margin-bottom:2px;">${bottomLabel}</div>`;
  html += `<div class="probing-report-chart">${buildProbingAreaChartSvg(teeth, bottomSites, data, reportW, jaw)}</div>`;

  // Transposed data table — use visual site ordering per tooth
  // Since teeth may come from different quadrants, we list all 6 site keys and label them
  const allSites: ProbingSite[] = [...PROBING_BUCCAL_SITES, ...PROBING_LINGUAL_SITES];
  const colCount = teeth.length + 1;

  html += `<table class="pb-table" style="margin-top:4px;">`;
  html += `<thead><tr><th class="surface-label-cell"></th>`;
  for (const tooth of teeth) {
    html += `<th>${tooth}</th>`;
  }
  html += `</tr></thead><tbody>`;

  for (const site of allSites) {
    html += `<tr><td class="surface-label-cell">${PROBING_SITE_LABELS[site]}</td>`;
    for (const tooth of teeth) {
      const td = data[tooth];
      if (!td.present) {
        html += `<td class="missing-cell">—</td>`;
      } else {
        const v = td[site];
        if (v === null) {
          html += `<td>—</td>`;
        } else {
          const color = getProbingDepthColor(v);
          html += `<td style="background:${color}20;color:${color};font-weight:600;">${v}</td>`;
        }
      }
    }
    html += `</tr>`;
  }

  html += `</tbody></table>`;
  return html;
}

// ── BOP section ──────────────────────────────────────────────────

function buildBOPSection(s: ExaminationSession): string {
  if (!s.bop || !s.probing) return "";

  let totalSites = 0;
  let bleedingSites = 0;
  for (const t of ALL_TEETH) {
    if (!s.probing[t].present) continue;
    for (const site of PROBING_ALL_SITES) {
      totalSites++;
      if ((s.bop[t] as Record<string, boolean>)[site]) bleedingSites++;
    }
  }

  if (bleedingSites === 0) return "";

  const pct = totalSites > 0 ? ((bleedingSites / totalSites) * 100).toFixed(1) : "0.0";

  const upperTeeth = [...UPPER_RIGHT, ...UPPER_LEFT];
  const lowerTeeth = [...LOWER_JAW_MIRRORED];

  const buildTable = (teeth: FdiToothNumber[], jawLabel: string): string => {
    const allSites: ProbingSite[] = [...PROBING_BUCCAL_SITES, ...PROBING_LINGUAL_SITES];

    let html = `<h3 style="margin:8px 0 4px;">${jawLabel}</h3>`;
    html += `<table class="pb-table"><thead><tr><th class="surface-label-cell"></th>`;
    for (const tooth of teeth) html += `<th>${tooth}</th>`;
    html += `</tr></thead><tbody>`;

    for (const site of allSites) {
      html += `<tr><td class="surface-label-cell">${PROBING_SITE_LABELS[site]}</td>`;
      for (const tooth of teeth) {
        if (!s.probing[tooth].present) {
          html += `<td class="missing-cell">—</td>`;
        } else {
          const bleeding = (s.bop[tooth] as Record<string, boolean>)[site];
          html += `<td ${bleeding ? 'style="background:#ffcdd2;color:#c62828;font-weight:600;"' : ""}>${bleeding ? "●" : "○"}</td>`;
        }
      }
      html += `</tr>`;
    }
    html += `</tbody></table>`;
    return html;
  };

  return `
  <section class="section">
    <h2>Krvavitev ob sondiranju — BOP</h2>
    <p class="score"><strong>${pct}%</strong> (${bleedingSites} od ${totalSites} mest)</p>
    ${buildTable(upperTeeth, "Zgornja čeljust")}
    ${buildTable(lowerTeeth, "Spodnja čeljust")}
  </section>`;
}

// ── Furcation involvement section ─────────────────────────────────

function buildFurcationSection(s: ExaminationSession): string {
  const fi = s.furcationInvolvement;
  if (!fi) return "";

  // Check if any non-zero data exists
  let hasData = false;
  for (const teeth of [ROOT_CARIES_UPPER_TEETH, ROOT_CARIES_LOWER_TEETH]) {
    for (const t of teeth) {
      const entries = fi[t];
      if (entries && entries.some(v => v > 0)) { hasData = true; break; }
    }
    if (hasData) break;
  }
  if (!hasData) return "";

  const buildTable = (teeth: FdiToothNumber[], jawLabel: string): string => {
    const labels = rootCariesLabels(teeth[0]);
    let html = `<h3 style="margin:8px 0 4px;">${jawLabel}</h3>`;
    html += `<table class="pb-table"><thead><tr><th class="surface-label-cell">Zob</th>`;
    for (const lbl of labels) html += `<th>${lbl}</th>`;
    html += `</tr></thead><tbody>`;

    for (const t of teeth) {
      const entries = fi[t] || [];
      const isPresent = s.probing?.[t]?.present !== false;
      html += `<tr><td class="surface-label-cell">${t}</td>`;
      for (let i = 0; i < labels.length; i++) {
        const v = entries[i];
        if (!isPresent) {
          html += `<td class="missing-cell">—</td>`;
        } else {
          html += `<td>${v !== null && v !== undefined ? v : "0"}</td>`;
        }
      }
      html += `</tr>`;
    }
    html += `</tbody></table>`;
    return html;
  };

  return `
  <section class="section">
    <h2>Prizadetost razcepišč</h2>
    <p style="font-size:10px;color:#555;margin-bottom:8px;">0 = brez prizadetosti, 1 = začetna izguba, 2 = delna prizadetost, 3 = popolna prizadetost</p>
    ${buildTable(ROOT_CARIES_UPPER_TEETH, "Zgornja čeljust")}
    ${buildTable(ROOT_CARIES_LOWER_TEETH, "Spodnja čeljust")}
  </section>`;
}

// ── ICDAS Root Caries section ─────────────────────────────────────

function buildICDASRootCariesSection(s: ExaminationSession): string {
  const icRC = s.icdasRootCaries;
  if (!icRC) return "";

  // Check if any data exists
  let hasData = false;
  for (const t of ALL_TEETH) {
    const td = icRC[t];
    if (td) {
      for (const site of PROBING_ALL_SITES) {
        if ((td as Record<string, number | null>)[site] !== null) { hasData = true; break; }
      }
    }
    if (hasData) break;
  }
  if (!hasData) return "";

  const upperTeeth = [...UPPER_RIGHT, ...UPPER_LEFT];
  const lowerTeeth = [...LOWER_JAW_MIRRORED];
  const allSites: ProbingSite[] = [...PROBING_BUCCAL_SITES, ...PROBING_LINGUAL_SITES];

  const buildTable = (teeth: FdiToothNumber[], jawLabel: string): string => {
    let html = `<h3 style="margin:8px 0 4px;">${jawLabel}</h3>`;
    html += `<table class="pb-table"><thead><tr><th class="surface-label-cell"></th>`;
    for (const tooth of teeth) html += `<th>${tooth}</th>`;
    html += `</tr></thead><tbody>`;

    for (const site of allSites) {
      html += `<tr><td class="surface-label-cell">${PROBING_SITE_LABELS[site]}</td>`;
      for (const tooth of teeth) {
        const td = icRC[tooth];
        const isNormal = s.icdas[tooth].status !== "special";
        if (!isNormal) {
          html += `<td class="missing-cell">—</td>`;
        } else {
          const v = td ? (td as Record<string, number | null>)[site] : null;
          html += `<td>${v !== null && v !== undefined ? v : "—"}</td>`;
        }
      }
      html += `</tr>`;
    }
    html += `</tbody></table>`;
    return html;
  };

  return `
  <section class="section">
    <h2>Koreninski karies</h2>
    <p style="font-size:10px;color:#555;margin-bottom:8px;">0 = brez kariesa, 1 = začetna lezija, 2 = kavitirana lezija</p>
    ${buildTable(upperTeeth, "Zgornja čeljust")}
    ${buildTable(lowerTeeth, "Spodnja čeljust")}
  </section>`;
}

// ── Notes section ─────────────────────────────────────────────────

function buildNotesSection(s: ExaminationSession): string {
  return `
  <section class="section">
    <h2>Opombe</h2>
    <h3>Diagnostične opombe</h3>
    <div class="notes-content">${esc(s.notes.diagnosticNotes || "—")}</div>
    <h3>Kvalitativne opombe</h3>
    <div class="notes-content">${esc(s.notes.qualitativeNotes || "—")}</div>
  </section>`;
}

// ── OHIP section ──────────────────────────────────────────────────

function buildOhipSection(s: ExaminationSession): string {
  const ohip = s.ohip;
  const extra = s.ohipExtra || { healthRating: "", appearanceRating: "", comment: "" };
  let total = 0;
  let answered = 0;

  for (const v of ohip) {
    if (v !== null) { total += v; answered++; }
  }

  let domainRows = "";
  for (const domain of OHIP_DOMAINS) {
    let domainTotal = 0;
    let domainMax = 0;
    const items: string[] = [];

    for (let i = domain.startItem; i <= domain.endItem; i++) {
      const val = ohip[i - 1];
      domainMax += 4;
      if (val !== null) domainTotal += val;
      const label = val !== null ? `${val} (${OHIP_LIKERT_LABELS[val]})` : "—";
      items.push(`<span class="ohip-item">${i}: ${label}</span>`);
    }

    domainRows += `
      <tr>
        <td class="domain-name">${domain.name}</td>
        <td class="domain-score">${domainTotal} / ${domainMax}</td>
        <td class="domain-items">${items.join(", ")}</td>
      </tr>`;
  }

  return `
  <section class="section page-break">
    <h2>OHIP-49</h2>
    <p class="score"><strong>Skupaj: ${total} / 196</strong> (${answered}/49 odgovorov)</p>
    <table class="pb-table ohip-ratings">
      <tbody>
        <tr><td class="surface-label-cell">a) ${esc(OHIP_HEALTH_RATING_QUESTION)}</td><td>${esc(extra.healthRating.trim() || "—")}</td></tr>
        <tr><td class="surface-label-cell">b) ${esc(OHIP_APPEARANCE_RATING_QUESTION)}</td><td>${esc(extra.appearanceRating.trim() || "—")}</td></tr>
      </tbody>
    </table>
    <table class="ohip-table">
      <thead>
        <tr><th>Podkategorija</th><th>Rezultat</th><th>Odgovori</th></tr>
      </thead>
      <tbody>
        ${domainRows}
      </tbody>
    </table>
    <h3>${esc(OHIP_COMMENT_QUESTION)}</h3>
    <div class="notes-content">${esc(extra.comment.trim() || "—")}</div>
  </section>`;
}

// ── FDI section ──────────────────────────────────────────────────

function autoCalcFdi(s: ExaminationSession): FdiQuestionnaireData {
  const fdi: FdiQuestionnaireData = s.fdiQuestionnaire
    ? { ...s.fdiQuestionnaire }
    : { gender: null, age: null, smoking: null, diabetes: null, toothLoss: null, plaque: null, bleeding: null, probingDepth: null, country: "" };

  const pbSurfaces: PBSurface[] = ["mesial", "distal", "buccal", "lingual"];

  // Q5 - Tooth loss
  if (fdi.toothLoss === null) {
    fdi.toothLoss = "no";
    for (const t of ALL_TEETH) {
      if (isToothMissing(s, t)) { fdi.toothLoss = "yes"; break; }
    }
  }

  // Q6 - Plaque
  if (fdi.plaque === null) {
    let total = 0, active = 0;
    for (const t of ALL_TEETH) {
      if (!s.plaque[t].present) continue;
      for (const sf of pbSurfaces) { total++; if (s.plaque[t][sf]) active++; }
    }
    const pct = total > 0 ? (active / total) * 100 : 0;
    fdi.plaque = pct < 10 ? "lt10" : pct <= 50 ? "10to50" : "gt50";
  }

  // Q7 - Bleeding
  if (fdi.bleeding === null) {
    let total = 0, active = 0;
    for (const t of ALL_TEETH) {
      if (!s.bleeding[t].present) continue;
      for (const sf of pbSurfaces) { total++; if (s.bleeding[t][sf]) active++; }
    }
    const pct = total > 0 ? (active / total) * 100 : 0;
    fdi.bleeding = pct < 10 ? "lt10" : pct <= 50 ? "10to50" : "gt50";
  }

  // Q8 - Probing depth
  if (fdi.probingDepth === null && s.probing) {
    let maxDepth = 0, teethGt5 = 0, presentTeeth = 0;
    for (const t of ALL_TEETH) {
      const td = s.probing[t];
      if (!td.present) continue;
      presentTeeth++;
      let hasGt5 = false;
      for (const site of PROBING_ALL_SITES) {
        const v = td[site as ProbingSite];
        if (v !== null && v > maxDepth) maxDepth = v;
        if (v !== null && v > 5) hasGt5 = true;
      }
      if (hasGt5) teethGt5++;
    }
    if (maxDepth < 4) fdi.probingDepth = "lt4";
    else if (maxDepth <= 5) fdi.probingDepth = "4to5";
    else {
      const pctGt5 = presentTeeth > 0 ? (teethGt5 / presentTeeth) * 100 : 0;
      fdi.probingDepth = pctGt5 < 30 ? "localized_gt5" : "generalized_gt5";
    }
  }

  return fdi;
}

function buildFdiSection(s: ExaminationSession): string {
  const fdi = autoCalcFdi(s);

  const labels: Record<string, Record<string, string>> = {
    gender: { male: "Moški", female: "Ženski", rather_not_say: "Ne želim odgovoriti" },
    age: { lt35: "< 35 let", "35to44": "35–44 let", "45to64": "45–64 let", gt64: "> 64 let" },
    smoking: { no: "Ne", lt10: "< 10 cigaret/dan", "10to15": "10–15 cigaret/dan", gt15: "> 15 cigaret/dan" },
    diabetes: { no: "Ne", well_controlled: "Urejen (HbA1c < 7%)", poorly_controlled: "Neurejen (HbA1c ≥ 7%)" },
    toothLoss: { no: "Brez izgube zob", yes: "Izguba zob zaradi parodontitisa" },
    plaque: { lt10: "< 10% površin", "10to50": "10–50% površin", gt50: "> 50% površin" },
    bleeding: { lt10: "< 10% površin", "10to50": "10–50% površin", gt50: "> 50% površin" },
    probingDepth: { lt4: "< 4 mm", "4to5": "4–5 mm", localized_gt5: "Lokalizirana mesta > 5 mm", generalized_gt5: "Generalizirana mesta > 5 mm" },
  };

  const questions: { key: string; label: string }[] = [
    { key: "gender", label: "Spol" },
    { key: "age", label: "Starost" },
    { key: "smoking", label: "Kajenje" },
    { key: "diabetes", label: "Diabetes" },
    { key: "toothLoss", label: "Izguba zob" },
    { key: "plaque", label: "Obsežne obloge" },
    { key: "bleeding", label: "Krvavitev ob sondiranju" },
    { key: "probingDepth", label: "Globina sondiranja" },
  ];

  let rows = "";
  for (const q of questions) {
    const val = fdi[q.key as keyof FdiQuestionnaireData] as string | null;
    const display = val ? (labels[q.key][val] || val) : "—";
    rows += `<tr><td class="surface-label-cell">${q.label}</td><td>${esc(display)}</td></tr>`;
  }

  return `
  <section class="section">
    <h2>FDI vprašalnik — profil parodontalne bolezni</h2>
    ${fdi.country ? `<p style="font-size:10px;color:#555;margin-bottom:8px;">Država: ${esc(fdi.country)}</p>` : ""}
    <table class="pb-table">
      <thead><tr><th class="surface-label-cell">Vprašanje</th><th>Odgovor</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </section>`;
}

// ── Signature section ────────────────────────────────────────────

function buildSignatureSection(examinerName: string): string {
  return `
  <section class="section signature-section">
    <div class="signature-block">
      <div class="signature-line"></div>
      <div class="signature-label">Ime in priimek: ${esc(examinerName)}</div>
    </div>
    <div class="signature-block">
      <div class="signature-line"></div>
      <div class="signature-label">Podpis izvajalca pregleda</div>
    </div>
    <div class="signature-block">
      <div class="signature-line"></div>
      <div class="signature-label">Datum</div>
    </div>
  </section>`;
}

// ── Additional notes page ────────────────────────────────────────

function buildAdditionalNotesPage(): string {
  return `
  <section class="section page-break">
    <h2>Dodatne opombe</h2>
    <div class="additional-notes-box"></div>
  </section>`;
}

// ── Chart SVG generation (inline SVG for PDF report) ─────────────

const CHART = { cell: 24, gap: 2, midGap: 6, numH: 12, rowGap: 3, midH: 6 };
const CHART_HALF_W = 8 * CHART.cell + 7 * CHART.gap;
const CHART_TOTAL_W = CHART_HALF_W * 2 + CHART.midGap;
const CHART_TOTAL_H = CHART.cell * 2 + CHART.numH * 2 + CHART.rowGap * 2 + CHART.midH;

function chartX(index: number): number {
  if (index < 8) return index * (CHART.cell + CHART.gap);
  return CHART_HALF_W + CHART.midGap + (index - 8) * (CHART.cell + CHART.gap);
}

function buildPBChartSvg(data: Record<FdiToothNumber, PBToothData>, activeColor: string): string {
  const upperTeeth = [...UPPER_RIGHT, ...UPPER_LEFT];
  const lowerTeeth = [...LOWER_JAW_MIRRORED];
  const c = CHART.cell;
  const h = c / 2;

  const upperToothY = 0;
  const upperNumY = c + CHART.rowGap;
  const lowerNumY = upperNumY + CHART.numH + CHART.midH;
  const lowerToothY = lowerNumY + CHART.numH + CHART.rowGap;

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CHART_TOTAL_W} ${CHART_TOTAL_H}" style="width:100%;max-width:${CHART_TOTAL_W}px;">`);

  // Upper jaw
  for (let i = 0; i < upperTeeth.length; i++) {
    const tooth = upperTeeth[i];
    const x = chartX(i);
    parts.push(pbToothSvgStr(x, upperToothY, c, h, tooth, data[tooth], activeColor));
    parts.push(`<text x="${x + h}" y="${upperNumY + CHART.numH - 2}" text-anchor="middle" font-size="7" font-family="sans-serif" fill="#333">${tooth}</text>`);
  }

  // Midline
  const midY = upperNumY + CHART.numH + CHART.midH / 2;
  parts.push(`<line x1="0" y1="${midY}" x2="${CHART_TOTAL_W}" y2="${midY}" stroke="#ccc" stroke-width="0.5" stroke-dasharray="2,2"/>`);

  // Lower jaw
  for (let i = 0; i < lowerTeeth.length; i++) {
    const tooth = lowerTeeth[i];
    const x = chartX(i);
    parts.push(`<text x="${x + h}" y="${lowerNumY + CHART.numH - 2}" text-anchor="middle" font-size="7" font-family="sans-serif" fill="#333">${tooth}</text>`);
    parts.push(pbToothSvgStr(x, lowerToothY, c, h, tooth, data[tooth], activeColor));
  }

  parts.push(`</svg>`);
  return parts.join("");
}

function pbToothSvgStr(
  x: number, y: number, c: number, h: number,
  tooth: FdiToothNumber, td: PBToothData, activeColor: string
): string {
  if (!td.present) {
    return `<rect x="${x}" y="${y}" width="${c}" height="${c}" fill="#e8e8e8" stroke="#bbb" stroke-width="0.5"/>`
      + `<line x1="${x}" y1="${y}" x2="${x + c}" y2="${y + c}" stroke="#ccc" stroke-width="0.5"/>`
      + `<line x1="${x + c}" y1="${y}" x2="${x}" y2="${y + c}" stroke="#ccc" stroke-width="0.5"/>`;
  }

  const polys: { pos: VisualPosition; points: string }[] = [
    { pos: "top", points: `${x},${y} ${x + c},${y} ${x + h},${y + h}` },
    { pos: "right", points: `${x + c},${y} ${x + c},${y + c} ${x + h},${y + h}` },
    { pos: "bottom", points: `${x},${y + c} ${x + c},${y + c} ${x + h},${y + h}` },
    { pos: "left", points: `${x},${y} ${x},${y + c} ${x + h},${y + h}` },
  ];

  let svg = "";
  for (const p of polys) {
    const surface = getSurfaceForPosition(tooth, p.pos);
    const fill = td[surface] ? activeColor : "#fff";
    svg += `<polygon points="${p.points}" fill="${fill}" stroke="#999" stroke-width="0.5"/>`;
  }
  svg += `<rect x="${x}" y="${y}" width="${c}" height="${c}" fill="none" stroke="#666" stroke-width="0.5"/>`;
  return svg;
}

const ICDAS_CARIES_COLORS: Record<number, string> = {
  0: "#d4edda", 1: "#fff3cd", 2: "#ffeeba", 3: "#ffcc80",
  4: "#ffab91", 5: "#ef9a9a", 6: "#e57373",
};

function buildICDASChartSvg(icdas: ExaminationSession["icdas"]): string {
  const upperTeeth = [...UPPER_RIGHT, ...UPPER_LEFT];
  const lowerTeeth = [...LOWER_JAW_MIRRORED];
  const c = CHART.cell;
  const h = c / 2;
  const m = Math.round(c * 0.25);

  const upperToothY = 0;
  const upperNumY = c + CHART.rowGap;
  const lowerNumY = upperNumY + CHART.numH + CHART.midH;
  const lowerToothY = lowerNumY + CHART.numH + CHART.rowGap;

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CHART_TOTAL_W} ${CHART_TOTAL_H}" style="width:100%;max-width:${CHART_TOTAL_W}px;">`);

  for (let i = 0; i < upperTeeth.length; i++) {
    const tooth = upperTeeth[i];
    const x = chartX(i);
    parts.push(icdasToothSvgStr(x, upperToothY, c, m, tooth, icdas[tooth]));
    parts.push(`<text x="${x + h}" y="${upperNumY + CHART.numH - 2}" text-anchor="middle" font-size="7" font-family="sans-serif" fill="#333">${tooth}</text>`);
  }

  const midY = upperNumY + CHART.numH + CHART.midH / 2;
  parts.push(`<line x1="0" y1="${midY}" x2="${CHART_TOTAL_W}" y2="${midY}" stroke="#ccc" stroke-width="0.5" stroke-dasharray="2,2"/>`);

  for (let i = 0; i < lowerTeeth.length; i++) {
    const tooth = lowerTeeth[i];
    const x = chartX(i);
    parts.push(`<text x="${x + h}" y="${lowerNumY + CHART.numH - 2}" text-anchor="middle" font-size="7" font-family="sans-serif" fill="#333">${tooth}</text>`);
    parts.push(icdasToothSvgStr(x, lowerToothY, c, m, tooth, icdas[tooth]));
  }

  parts.push(`</svg>`);
  return parts.join("");
}

function icdasToothSvgStr(
  x: number, y: number, c: number, m: number,
  tooth: FdiToothNumber, td: ExaminationSession["icdas"][FdiToothNumber]
): string {
  if (td.status === "special") {
    const g = "#e0e0e0";
    return `<polygon points="${x},${y} ${x + c},${y} ${x + c - m},${y + m} ${x + m},${y + m}" fill="${g}" stroke="#bbb" stroke-width="0.5"/>`
      + `<polygon points="${x + c - m},${y + m} ${x + c},${y} ${x + c},${y + c} ${x + c - m},${y + c - m}" fill="${g}" stroke="#bbb" stroke-width="0.5"/>`
      + `<polygon points="${x + m},${y + c - m} ${x + c - m},${y + c - m} ${x + c},${y + c} ${x},${y + c}" fill="${g}" stroke="#bbb" stroke-width="0.5"/>`
      + `<polygon points="${x},${y} ${x + m},${y + m} ${x + m},${y + c - m} ${x},${y + c}" fill="${g}" stroke="#bbb" stroke-width="0.5"/>`
      + `<rect x="${x + m}" y="${y + m}" width="${c - 2 * m}" height="${c - 2 * m}" fill="${g}" stroke="#bbb" stroke-width="0.5"/>`
      + `<rect x="${x}" y="${y}" width="${c}" height="${c}" fill="none" stroke="#666" stroke-width="0.5"/>`;
  }

  const positions: { pos: ICDASVisualPosition; points: string }[] = [
    { pos: "top", points: `${x},${y} ${x + c},${y} ${x + c - m},${y + m} ${x + m},${y + m}` },
    { pos: "right", points: `${x + c - m},${y + m} ${x + c},${y} ${x + c},${y + c} ${x + c - m},${y + c - m}` },
    { pos: "bottom", points: `${x + m},${y + c - m} ${x + c - m},${y + c - m} ${x + c},${y + c} ${x},${y + c}` },
    { pos: "left", points: `${x},${y} ${x + m},${y + m} ${x + m},${y + c - m} ${x},${y + c}` },
  ];

  let svg = "";
  for (const p of positions) {
    const surface = getICDASSurfaceForPosition(tooth, p.pos);
    const sd = td.surfaces[surface];
    const fill = sd.caries !== null ? (ICDAS_CARIES_COLORS[sd.caries] || "#fff") : "#fff";
    const isRestored = sd.restoration !== null && sd.restoration > 0;
    svg += `<polygon points="${p.points}" fill="${fill}" stroke="${isRestored ? "#2196F3" : "#999"}" stroke-width="${isRestored ? "1.2" : "0.5"}"/>`;
  }

  // Center (occlusal)
  const oc = td.surfaces.occlusal;
  const ocFill = oc.caries !== null ? (ICDAS_CARIES_COLORS[oc.caries] || "#fff") : "#fff";
  const ocRestored = oc.restoration !== null && oc.restoration > 0;
  svg += `<rect x="${x + m}" y="${y + m}" width="${c - 2 * m}" height="${c - 2 * m}" fill="${ocFill}" stroke="${ocRestored ? "#2196F3" : "#999"}" stroke-width="${ocRestored ? "1.2" : "0.5"}"/>`;
  svg += `<rect x="${x}" y="${y}" width="${c}" height="${c}" fill="none" stroke="#666" stroke-width="0.5"/>`;
  return svg;
}

// ── Report CSS ────────────────────────────────────────────────────

export const REPORT_CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
body {
  font-family: "Segoe UI", -apple-system, sans-serif;
  font-size: 11px;
  color: #1a1a1a;
  background: #fff;
  padding: 16px;
}
.report { max-width: 900px; margin: 0 auto; }
/* In the PWA layer the report sits in a shadow root, where "body" matches nothing. */
:host .report { font-family: "Segoe UI", -apple-system, sans-serif; font-size: 11px; color: #1a1a1a; background: #fff; padding: 16px; line-height: normal; }
.report-header {
  border-bottom: 2px solid #0078d4;
  padding-bottom: 12px;
  margin-bottom: 16px;
}
.report-header h1 { font-size: 20px; color: #0078d4; margin-bottom: 8px; }
.report-meta { display: flex; flex-wrap: wrap; gap: 16px; font-size: 12px; }
.section { margin-bottom: 20px; }
.section h2 {
  font-size: 15px;
  color: #0078d4;
  border-bottom: 1px solid #0078d4;
  padding-bottom: 4px;
  margin-bottom: 8px;
}
.section h3 { font-size: 12px; color: #323130; margin: 8px 0 4px; }
.score { font-size: 13px; margin-bottom: 8px; }
table { width: 100%; border-collapse: collapse; font-size: 10px; margin-bottom: 8px; }
th, td { border: 1px solid #d0d0d0; padding: 3px 5px; text-align: center; }
th { background: #f0f0f0; font-weight: 600; }
.jaw-label-row td { background: #e8f4fd; font-weight: 600; text-align: left; font-size: 11px; }
.missing-row td { color: #a0a0a0; font-style: italic; }
.special-row td, .special-row { background: #f5f5f5; }
.surface-label-cell { text-align: left; font-weight: 600; background: #f8f8f8; white-space: nowrap; }
.missing-cell { color: #a0a0a0; font-style: italic; }
.active-cell { background: #ffd335; font-weight: bold; }
.notes-content {
  white-space: pre-wrap;
  background: #fafafa;
  border: 1px solid #e0e0e0;
  padding: 8px;
  border-radius: 4px;
  min-height: 24px;
  font-size: 11px;
}
.ohip-table .domain-name { text-align: left; font-weight: 600; }
.ohip-table .domain-score { font-weight: 600; width: 80px; }
.ohip-table .domain-items { text-align: left; font-size: 9px; color: #555; }
.ohip-item { white-space: nowrap; }
.ohip-ratings { margin-bottom: 8px; }
.ohip-ratings .surface-label-cell { width: 70%; white-space: normal; }
.report-footer {
  margin-top: 20px;
  padding-top: 8px;
  border-top: 1px solid #d0d0d0;
  font-size: 10px;
  color: #888;
  text-align: right;
}
.chart-figure { margin: 8px 0; text-align: center; }
.chart-figure svg { display: inline-block; }
.chart-legend {
  display: flex; flex-wrap: wrap; gap: 8px; justify-content: center;
  margin-bottom: 8px; font-size: 9px;
}
.legend-item { display: inline-flex; align-items: center; gap: 2px; }
.legend-swatch {
  display: inline-block; width: 10px; height: 10px;
  border: 1px solid #999; border-radius: 1px;
}
.signature-section {
  display: flex; flex-wrap: wrap; gap: 24px; margin-top: 32px;
  page-break-inside: avoid;
}
.signature-block { flex: 1; min-width: 180px; }
.signature-line {
  border-bottom: 1px solid #333; height: 40px; margin-bottom: 4px;
}
.signature-label { font-size: 10px; color: #555; text-align: center; }
.additional-notes-box {
  border: 1px solid #999; border-radius: 4px;
  min-height: 600px; padding: 12px;
}
.probing-report-chart { text-align: center; margin: 4px 0; }
.probing-report-chart svg { display: inline-block; }
.page-break { page-break-before: auto; }

/* ── Radiograph mount ── */
.rtg-r-meta { font-size: 10pt; color: #555; margin-bottom: 8px; }
.rtg-r-mount { border: 1px solid #ccc; border-radius: 4px; padding: 10px; background: #fafafa; }
.rtg-r-mount + .rtg-r-mount { margin-top: 10px; }
.rtg-r-jaw { font-size: 9pt; font-weight: 700; color: #666; text-transform: uppercase;
  letter-spacing: 0.5px; text-align: center; margin: 2px 0 6px; }
.rtg-r-row + .rtg-r-jaw { margin-top: 10px; }
.rtg-r-row { display: grid; gap: 6px; margin-bottom: 6px; }
.rtg-r-cell { display: flex; flex-direction: column; align-items: center; }
.rtg-r-frame { width: 100%; height: 130px; background: #000; border: 1px solid #999;
  display: flex; align-items: center; justify-content: center; overflow: hidden; }
.rtg-r-frame img { max-width: 100%; max-height: 100%; object-fit: contain; display: block; }
.rtg-r-missing { color: #888; font-size: 8pt; font-style: italic; }
.rtg-r-label { font-size: 8pt; color: #333; text-align: center; margin-top: 3px; line-height: 1.2; }
.rtg-r-composite-frame { background: #000; border: 1px solid #999; display: flex;
  align-items: center; justify-content: center; min-height: 80px; }
.rtg-r-composite-frame img { max-width: 100%; max-height: 125mm; object-fit: contain; display: block; }
.rtg-r-sides { display: flex; justify-content: space-between; font-size: 8pt;
  color: #777; margin-top: 4px; padding: 0 2px; }
.rtg-r-captions { margin-top: 14px; }
.rtg-r-captions h3, .rtg-r-opinion h3 { font-size: 11pt; margin: 0 0 6px; color: #222; }
.rtg-r-captions ul { margin: 0 0 0 18px; font-size: 10pt; line-height: 1.5; }
.rtg-r-opinion { margin-top: 14px; }

/* The radiograph pages print in landscape: films sit side by side */
@page rtg-landscape { size: A4 landscape; }

${REPORT_PLATFORM_CSS}
@media print {
  body { padding: 0; }
  .rtg-landscape { page: rtg-landscape; }
  .page-break { page-break-before: always; }
  .report-footer { position: fixed; bottom: 0; right: 0; }
  .additional-notes-box { min-height: calc(100vh - 120px); }
}
`;
