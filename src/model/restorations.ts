/**
 * Fillings and other restorations, summarised from the ICDAS restoration code
 * of each surface (0–8). Shared by the Zalivke tab and the report.
 *
 * Pure module: no DOM.
 */

import { ExaminationSession, FdiToothNumber, ICDASSurface, RestorationCode } from "./types";
import { ALL_TEETH } from "./constants";
import { isImplantTooth, isToothMissing } from "./tooth-status";

/** Paintable restoration codes, in the order offered: a short label and a chart fill. */
export const RESTORATION_BRUSHES: { code: RestorationCode; label: string; color: string }[] = [
  { code: 3, label: "Kompozit", color: "#b9d9f2" },
  { code: 4, label: "Amalgam", color: "#8a8886" },
  { code: 2, label: "Zalitje fisur", color: "#c7e8cf" },
  { code: 1, label: "Delno zalitje", color: "#e6f4ea" },
  { code: 8, label: "Začasna", color: "#fbe9a6" },
  { code: 7, label: "Izpadla / poškodovana", color: "#f4b6b6" },
  { code: 5, label: "Kovinska prevleka", color: "#c9b37e" },
  { code: 6, label: "Prevleka / luska", color: "#e8dcc0" },
];

export const SURFACE_ABBR: Record<ICDASSurface, string> = {
  mesial: "M",
  distal: "D",
  buccal: "B",
  lingual: "L",
  occlusal: "O",
};

/** A missing tooth carries no restorations; an implant's crown does. */
export function restorationsBlocked(s: ExaminationSession, t: FdiToothNumber): boolean {
  return isToothMissing(s, t) && !isImplantTooth(s.icdas[t]);
}

export interface RestorationSummary {
  /** Surfaces per restoration code (codes 1–8 only). */
  perCode: Map<number, number>;
  /** Composite, amalgam and temporary fillings (codes 3, 4, 8). */
  fillingSurfaces: number;
  /** Teeth with a full or partial fissure sealant on any surface. */
  sealedTeeth: number;
  /** Per tooth: code → surfaces, for teeth with any restoration. */
  byTooth: { tooth: FdiToothNumber; items: { code: number; surfaces: ICDASSurface[] }[] }[];
}

export function summarizeRestorations(s: ExaminationSession): RestorationSummary {
  const perCode = new Map<number, number>();
  const byTooth: RestorationSummary["byTooth"] = [];
  let sealedTeeth = 0;
  for (const t of ALL_TEETH) {
    if (restorationsBlocked(s, t)) continue;
    const surfaces = s.icdas[t].surfaces;
    const items = new Map<number, ICDASSurface[]>();
    for (const surf of Object.keys(surfaces) as ICDASSurface[]) {
      const code = surfaces[surf].restoration;
      if (code === null || code === 0) continue;
      perCode.set(code, (perCode.get(code) || 0) + 1);
      items.set(code, [...(items.get(code) || []), surf]);
    }
    if (items.has(1) || items.has(2)) sealedTeeth++;
    if (items.size) byTooth.push({ tooth: t, items: Array.from(items, ([code, surfs]) => ({ code, surfaces: surfs })) });
  }
  const fillingSurfaces = (perCode.get(3) || 0) + (perCode.get(4) || 0) + (perCode.get(8) || 0);
  return { perCode, fillingSurfaces, sealedTeeth, byTooth };
}
