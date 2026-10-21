/**
 * Basic demographics of the person examined: sex, age, place of residence
 * and the Slovenian statistical region. Sex and age also fill in the first
 * two FDI questionnaire items, and sex chooses the periodontal-wound table.
 *
 * Pure module: no DOM.
 */

import type { FdiQuestionnaireData } from "./types";
import { Dentition, normalizeDentition } from "./dentition";

export type Sex = "male" | "female" | "rather_not_say";
export const SEX_LABELS: Record<Sex, string> = { male: "Moški", female: "Ženski", rather_not_say: "Ne želi odgovoriti" };

export type Settlement = "urban" | "suburban" | "rural";
export const SETTLEMENT_LABELS: Record<Settlement, string> = { urban: "Mesto", suburban: "Predmestje", rural: "Podeželje" };

/** Statistical regions of Slovenia (SURS, SKTE-3), plus abroad. */
export const STAT_REGIONS = [
  "Pomurska",
  "Podravska",
  "Koroška",
  "Savinjska",
  "Zasavska",
  "Posavska",
  "Jugovzhodna Slovenija",
  "Osrednjeslovenska",
  "Gorenjska",
  "Primorsko-notranjska",
  "Goriška",
  "Obalno-kraška",
  "Tujina",
] as const;
export type StatRegion = (typeof STAT_REGIONS)[number];

export interface DemographicsData {
  sex: Sex | null;
  /** ISO date; optional — when given, the age is filled in from it. */
  birthDate: string;
  /**
   * Age in years. Filled in from the birth date (on the day it is entered)
   * or typed by hand; an age alone never fills in a birth date.
   */
  ageYears: number | null;
  /** Town or settlement (kraj bivanja). */
  residence: string;
  settlement: Settlement | null;
  region: StatRegion | null;
  /** Which teeth every chart shows. */
  dentition: Dentition;
}

export function makeDefaultDemographics(): DemographicsData {
  return { sex: null, birthDate: "", ageYears: null, residence: "", settlement: null, region: null, dentition: "permanent" };
}

export function normalizeDemographics(d: Partial<DemographicsData> | null | undefined): DemographicsData {
  const out = makeDefaultDemographics();
  if (!d) return out;
  if (d.sex && d.sex in SEX_LABELS) out.sex = d.sex;
  if (typeof d.birthDate === "string") out.birthDate = d.birthDate;
  if (typeof d.ageYears === "number" && Number.isFinite(d.ageYears)) out.ageYears = d.ageYears;
  if (typeof d.residence === "string") out.residence = d.residence;
  if (d.settlement && d.settlement in SETTLEMENT_LABELS) out.settlement = d.settlement;
  if (d.region && (STAT_REGIONS as readonly string[]).includes(d.region)) out.region = d.region;
  out.dentition = normalizeDentition(d.dentition);
  return out;
}

/** Age in years (two decimals) on `onDate`, from the birth date; null if either is missing or invalid. */
export function ageFromBirthDate(birthDate: string, onDate: string): number | null {
  const b = Date.parse(birthDate);
  const o = Date.parse(onDate);
  if (!birthDate || !onDate || Number.isNaN(b) || Number.isNaN(o) || o < b) return null;
  return Math.round(((o - b) / (365.2425 * 24 * 3600 * 1000)) * 100) / 100;
}

/** Today as an ISO date (local time). */
export function todayIso(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The age used everywhere: as stored, else from the birth date on today's date. */
export function effectiveAge(d: DemographicsData): number | null {
  return d.ageYears ?? ageFromBirthDate(d.birthDate, todayIso());
}

/** "4 leta 7 mesecev" for small children, "37,4 let" otherwise. */
export function formatAge(age: number | null): string {
  if (age === null) return "—";
  if (age < 3) {
    const months = Math.floor(age * 12 + 1e-6);
    const y = Math.floor(months / 12);
    const m = months % 12;
    return y ? `${y} ${y === 1 ? "leto" : y === 2 ? "leti" : "leta"} ${m} mes.` : `${m} mes.`;
  }
  return `${age.toFixed(1).replace(".", ",")} let`;
}

/** The FDI questionnaire's age band, or null below the questionnaire's range. */
export function fdiAgeBand(age: number | null): FdiQuestionnaireData["age"] {
  if (age === null) return null;
  if (age < 35) return "lt35";
  if (age < 45) return "35to44";
  if (age < 65) return "45to64";
  return "gt64";
}
