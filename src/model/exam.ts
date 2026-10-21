/**
 * The kind of examination and its optional sequence number (Patient tab).
 *
 * The number is entered by hand for now; once examinations are sent to the
 * platform database it should be assigned or checked there.
 *
 * Pure module: no DOM.
 */

import type { PatientData } from "./types";

export type ExamType = "kontrolni" | "ortodontski" | "kirurski" | "zacetni" | "celostni";

export const EXAM_TYPES: ExamType[] = ["kontrolni", "ortodontski", "kirurski", "zacetni", "celostni"];

export const EXAM_TYPE_LABELS: Record<ExamType, string> = {
  kontrolni: "Kontrolni",
  ortodontski: "Ortodontski specialistični",
  kirurski: "Kirurški specialistični",
  zacetni: "Začetni",
  celostni: "Celostni",
};

export function normalizeExamType(v: unknown): ExamType | null {
  return EXAM_TYPES.includes(v as ExamType) ? (v as ExamType) : null;
}

/** "2. kontrolni pregled", "kontrolni pregled", "2. pregled" or "pregled". */
export function examText(p: Pick<PatientData, "examType" | "checkup">): string {
  const type = normalizeExamType(p.examType);
  const words = type ? `${EXAM_TYPE_LABELS[type].toLowerCase()} pregled` : "pregled";
  return p.checkup ? `${p.checkup}. ${words}` : words;
}

/** For file names: "kontrolni2", "pregled2", "kontrolni" or "pregled". */
export function examFileTag(p: Pick<PatientData, "examType" | "checkup">): string {
  return `${normalizeExamType(p.examType) || "pregled"}${p.checkup || ""}`;
}
