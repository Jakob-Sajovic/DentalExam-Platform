/**
 * Which teeth the charts show: the patient's dentition (infant without teeth,
 * primary, mixed, permanent), set once on the Patient tab.
 *
 * Every chart keeps 16 columns per jaw. Primary teeth sit under their
 * permanent successors (55–51 under 15–11, 61–65 under 21–25), so a mixed
 * dentition lines up column by column and the layout never changes width.
 *
 * Pure module: no DOM.
 */

import type { ExaminationSession, FdiToothNumber } from "./types";
import { ALL_TEETH, UPPER_RIGHT, UPPER_LEFT, LOWER_JAW_MIRRORED } from "./constants";

export type Dentition = "infant" | "primary" | "mixed" | "permanent";
export const DENTITIONS: Dentition[] = ["infant", "primary", "mixed", "permanent"];
export const DENTITION_LABELS: Record<Dentition, string> = {
  infant: "Dojenček (brez zob)",
  primary: "Mlečno zobovje",
  mixed: "Mešano zobovje",
  permanent: "Stalno zobovje",
};

/** A chart column: a tooth, or an empty place (a primary row has no molars 6–8). */
export type ToothSlot = FdiToothNumber | null;

const PRIMARY_UPPER_SLOTS: ToothSlot[] = [null, null, null, 55, 54, 53, 52, 51, 61, 62, 63, 64, 65, null, null, null];
const PRIMARY_LOWER_SLOTS: ToothSlot[] = [null, null, null, 85, 84, 83, 82, 81, 71, 72, 73, 74, 75, null, null, null];

/** The 20 primary teeth, in storage (workbook column) order. */
export const PRIMARY_TEETH: FdiToothNumber[] = [
  55, 54, 53, 52, 51, 61, 62, 63, 64, 65,
  75, 74, 73, 72, 71, 81, 82, 83, 84, 85,
];

/** Every tooth the session keeps data for: permanent first, as before, then primary. */
export const STORED_TEETH: FdiToothNumber[] = [...ALL_TEETH, ...PRIMARY_TEETH];

export function isPrimaryTooth(t: number): boolean {
  return t >= 51;
}

/** Quadrant 1–4, primary quadrants 5–8 folded onto them. */
export function quadrantOf(t: number): 1 | 2 | 3 | 4 {
  const q = Math.floor(t / 10);
  return (q > 4 ? q - 4 : q) as 1 | 2 | 3 | 4;
}

export function isUpperTooth(t: number): boolean {
  return quadrantOf(t) <= 2;
}

/** Tooth type 1–8 for drawing: primary molars (D, E) look like molars. */
export function toothShapeType(t: number): number {
  const type = t % 10;
  return isPrimaryTooth(t) && type >= 4 ? 6 : type;
}

export interface ChartJaw {
  jaw: "upper" | "lower";
  primary: boolean;
  label: string;
  /** 16 columns, viewer-left = patient's right; the lower row is mirrored like the upper. */
  slots: ToothSlot[];
}

/** The jaw rows a chart shows, top to bottom. */
export function chartJaws(d: Dentition): ChartJaw[] {
  const permUpper: ChartJaw = { jaw: "upper", primary: false, label: "Zgornja čeljust", slots: [...UPPER_RIGHT, ...UPPER_LEFT] };
  const permLower: ChartJaw = { jaw: "lower", primary: false, label: "Spodnja čeljust", slots: [...LOWER_JAW_MIRRORED] };
  const primUpper: ChartJaw = { jaw: "upper", primary: true, label: "Zgornja čeljust — mlečni zobje", slots: PRIMARY_UPPER_SLOTS };
  const primLower: ChartJaw = { jaw: "lower", primary: true, label: "Spodnja čeljust — mlečni zobje", slots: PRIMARY_LOWER_SLOTS };
  switch (d) {
    case "infant":
      return [];
    case "primary":
      return [{ ...primUpper, label: "Zgornja čeljust" }, { ...primLower, label: "Spodnja čeljust" }];
    case "mixed":
      return [{ ...permUpper, label: "Zgornja čeljust — stalni zobje" }, primUpper, primLower, { ...permLower, label: "Spodnja čeljust — stalni zobje" }];
    default:
      return [permUpper, permLower];
  }
}

/** Teeth that are charted and counted in the indices for this dentition. */
export function chartedTeeth(d: Dentition): FdiToothNumber[] {
  const set = new Set(chartJaws(d).flatMap((j) => j.slots.filter((t): t is FdiToothNumber => t !== null)));
  return STORED_TEETH.filter((t) => set.has(t));
}

export function normalizeDentition(v: unknown): Dentition {
  return DENTITIONS.includes(v as Dentition) ? (v as Dentition) : "permanent";
}

/**
 * The session's dentition (Patient tab). Sessions from before it existed take
 * it from the 3D list they were measured with, else permanent.
 */
export function sessionDentition(s: ExaminationSession): Dentition {
  if (s.demographics?.dentition) return normalizeDentition(s.demographics.dentition);
  const stage = s.scans3d?.intraoral?.stage;
  return stage === "infant" ? "infant" : stage === "deciduous" ? "primary" : "permanent";
}

/** Teeth charted and counted for this session's dentition. */
export function sessionTeeth(s: ExaminationSession): FdiToothNumber[] {
  return chartedTeeth(sessionDentition(s));
}
