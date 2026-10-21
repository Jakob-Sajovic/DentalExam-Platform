/**
 * Report sections added by the platform: demographics in the header,
 * fillings, the periodontal wound and the 3D scans (measurements, tooth
 * labels, snapshots). Each returns "" when there is nothing to show, so a
 * session without these data prints as before.
 */

import { ExaminationSession } from "../model/types";
import { RESTORATION_LABELS } from "../model/constants";
import {
  SEX_LABELS,
  SETTLEMENT_LABELS,
  effectiveAge,
  formatAge,
  normalizeDemographics,
} from "../model/demographics";
import { RESTORATION_BRUSHES, SURFACE_ABBR, summarizeRestorations } from "../model/restorations";
import { computePerioWound } from "../model/perio-wound";
import {
  SCAN_KINDS,
  SCAN_KIND_LABELS,
  SCAN_VIEW_LABELS,
  SCAN_VIEWS,
  SNAPSHOT_PLAN,
  DENTITION_STAGE_LABELS,
  CLEFT_LABELS,
  ScanKind,
  activeSet,
  computeMeasurements,
  landmarkSetTag,
  normalizeScans3D,
  hasScanContent,
} from "../model/scans3d";

function esc(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const num = (v: number, digits = 1) => v.toFixed(digits).replace(".", ",");

// ── Header ────────────────────────────────────────────────────────

/** Demographics as header spans, only those filled in. */
export function buildDemographicsMeta(s: ExaminationSession): string {
  const d = normalizeDemographics(s.demographics);
  const age = effectiveAge(d);
  const items: [string, string][] = [];
  if (d.sex) items.push(["Spol:", SEX_LABELS[d.sex]]);
  if (age !== null) items.push(["Starost:", formatAge(age)]);
  if (d.residence) items.push(["Kraj bivanja:", d.residence]);
  if (d.settlement) items.push(["Okolje:", SETTLEMENT_LABELS[d.settlement]]);
  if (d.region) items.push(["Statistična regija:", d.region]);
  return items.map(([k, v]) => `<span><strong>${k}</strong> ${esc(v)}</span>`).join("");
}

// ── Fillings ──────────────────────────────────────────────────────

export function buildFillingsSection(s: ExaminationSession): string {
  const sum = summarizeRestorations(s);
  if (!sum.byTooth.length) return "";
  const label = (code: number) => RESTORATION_BRUSHES.find((b) => b.code === code)?.label || RESTORATION_LABELS[code];
  const codes = RESTORATION_BRUSHES.filter((b) => sum.perCode.get(b.code));
  const perCode = codes
    .map((b) => `<tr><td>${b.code}</td><td class="surface-label-cell">${esc(RESTORATION_LABELS[b.code])}</td><td>${sum.perCode.get(b.code)}</td></tr>`)
    .join("");
  const perTooth = sum.byTooth
    .map(
      ({ tooth, items }) =>
        `<tr><td>${tooth}</td><td class="surface-label-cell">${items
          .map((it) => `${esc(label(it.code))}: ${it.surfaces.map((x) => SURFACE_ABBR[x]).join(", ")}`)
          .join("; ")}</td></tr>`
    )
    .join("");
  return `
  <section class="section">
    <h2>Zalivke in druge restavracije</h2>
    <p class="score"><strong>${sum.fillingSurfaces}</strong> ploskev z zalivko · <strong>${sum.sealedTeeth}</strong> zob z zalitimi fisurami</p>
    <table><thead><tr><th>Koda</th><th>Restavracija</th><th>Ploskve</th></tr></thead><tbody>${perCode}</tbody></table>
    <h3>Po zobeh</h3>
    <table><thead><tr><th>Zob</th><th>Restavracije (M, D, B, L, O)</th></tr></thead><tbody>${perTooth}</tbody></table>
  </section>`;
}

// ── Periodontal wound ─────────────────────────────────────────────

export function buildWoundSection(s: ExaminationSession): string {
  const w = computePerioWound(s);
  if (!w) return "";
  const row = (label: string, mm2: number) =>
    `<tr><td class="surface-label-cell">${label}</td><td>${num(mm2)}</td><td>${num(mm2 / 100, 2)}</td></tr>`;
  const basis =
    w.basis === "mean"
      ? "Spol ni izpolnjen — uporabljeno povprečje obsegov zobnega vratu obeh spolov."
      : `Obsegi zobnega vratu za ${w.basis === "male" ? "moške" : "ženske"}.`;
  return `
  <section class="section">
    <h2>Parodontalna rana</h2>
    <table><thead><tr><th></th><th>mm²</th><th>cm²</th></tr></thead><tbody>
      ${row("Parodontalna rana (vsa mesta)", w.total)}
      ${row("Vnetna obremenitev (krvavitev ali > 2 mm)", w.burden)}
      ${row("Krvaveča (aktivna) rana", w.bleeding)}
    </tbody></table>
    <p class="report-note">${basis} Izmerjenih ${w.sitesMeasured} od ${w.sitesPossible} mest. Metoda: Skalerič E, Petelin M,
      Gašpirc B, Skalerič U. Acta Odontol Scand 2012;70:520–528.</p>
  </section>`;
}

// ── 3D scans ──────────────────────────────────────────────────────

function buildScanKind(kind: ScanKind, s: ExaminationSession): string {
  const rec = normalizeScans3D(s.scans3d)[kind];
  if (!hasScanContent(rec) && !Object.keys(rec.snapshots).length) return "";
  const set = activeSet(kind, rec);

  const meta: string[] = [];
  if (kind === "intraoral") meta.push(`${DENTITION_STAGE_LABELS[rec.stage]}, ${CLEFT_LABELS[rec.cleft].toLowerCase()}`);
  meta.push(`seznam točk ${landmarkSetTag(set)}${set.draft ? " (osnutek)" : ""}`);
  if (rec.parts.length) meta.push(`datoteke: ${rec.parts.map((p) => p.mesh.name).join(", ")}`);
  meta.push(`enota ${rec.unit}${rec.unitConfirmed ? "" : " (ni preverjena)"}`);

  const values = computeMeasurements(kind, rec);
  const rows = SCAN_VIEWS[kind]
    .map((view) => {
      const inView = values.filter((m) => m.def.view === view);
      if (!inView.length) return "";
      const head = SCAN_VIEWS[kind].length > 1 ? `<tr class="jaw-label-row"><td colspan="2">${esc(SCAN_VIEW_LABELS[view])}</td></tr>` : "";
      return (
        head +
        inView
          .map(
            (m) =>
              `<tr><td class="surface-label-cell">${esc(m.def.label)}</td><td>${m.value === null ? "—" : `${num(m.value)} ${m.unit}`}</td></tr>`
          )
          .join("")
      );
    })
    .join("");
  const measured = values.filter((m) => m.value !== null).length;

  const teeth = Object.keys(rec.teeth).sort();
  const snaps = SNAPSHOT_PLAN[kind].filter((p) => rec.snapshots[p.id]?.dataUrl);
  // Head: four views side by side; intraoral: the two jaws, then the three bite views
  const grid = (ids: string[], cols: number) => {
    const cells = snaps.filter((p) => ids.includes(p.id));
    if (!cells.length) return "";
    return `<div class="s3-r-grid" data-cols="${cols}" style="grid-template-columns: repeat(${cols}, 1fr)">${cells
      .map(
        (p) =>
          `<div class="s3-r-cell"><div class="s3-r-frame"><img src="${rec.snapshots[p.id].dataUrl}" alt="${esc(p.label)}" /></div><div class="s3-r-label">${esc(p.label)}</div></div>`
      )
      .join("")}</div>`;
  };
  const pictures =
    kind === "head"
      ? grid(["right", "front", "left", "back"], 2)
      : grid(["upper", "lower"], 2) + grid(["bite_right", "bite_front", "bite_left"], 3);

  return `
    <h3>${esc(SCAN_KIND_LABELS[kind])}</h3>
    <p class="report-note">${esc(meta.join(" · "))}</p>
    ${measured ? `<table><thead><tr><th>Meritev</th><th>Vrednost</th></tr></thead><tbody>${rows}</tbody></table>` : ""}
    ${teeth.length ? `<p class="report-note">Na skenu označeni zobje (${teeth.length}): ${teeth.join(", ")}</p>` : ""}
    ${rec.note.trim() ? `<div class="notes-content">${esc(rec.note.trim())}</div>` : ""}
    ${pictures}`;
}

export function buildScans3DSection(s: ExaminationSession): string {
  const body = SCAN_KINDS.map((k) => buildScanKind(k, s)).join("");
  if (!body.trim()) return "";
  return `
  <section class="section page-break">
    <h2>3D skeni</h2>
    ${body}
  </section>`;
}

export const REPORT_PLATFORM_CSS = `
.report-note { font-size: 9.5px; color: #555; margin: 2px 0 6px; }
.s3-r-grid { display: grid; gap: 6px; margin: 6px 0 10px; }
.s3-r-cell { display: flex; flex-direction: column; align-items: center; }
.s3-r-frame { width: 100%; aspect-ratio: 4 / 3; background: #f3f4f6; border: 1px solid #ccc;
  display: flex; align-items: center; justify-content: center; overflow: hidden; }
.s3-r-frame img { max-width: 100%; max-height: 100%; object-fit: contain; display: block; }
.s3-r-label { font-size: 8pt; color: #333; text-align: center; margin-top: 2px; }
`;
