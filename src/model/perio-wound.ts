/**
 * Periodontal wound (okužena parodontalna rana) by the Slovenian method:
 *
 *   Skalerič E, Petelin M, Gašpirc B, Skalerič U. Periodontal inflammatory
 *   burden correlates with C-reactive protein serum level. Acta Odontol Scand
 *   2012;70(6):520–528. doi:10.3109/00016357.2011.640284
 *
 * Each probing site stands for one sixth of the tooth's circumference at the
 * cemento-enamel junction, so its share of the pocket lining is
 * (circumference / 6) × probing depth. Sites are sorted as in the paper:
 *   a  PD ≤ 2 mm, no bleeding  — healthy sulcus
 *   b  PD ≤ 2 mm, bleeding
 *   c  PD > 2 mm, no bleeding
 *   d  PD > 2 mm, bleeding
 * total = a+b+c+d, inflammatory burden = b+c+d, bleeding wound = b+d.
 *
 * Pure module: no DOM.
 */

import { ExaminationSession, FdiToothNumber } from "./types";
import { ALL_TEETH, PROBING_ALL_SITES } from "./constants";

/** Mean CEJ circumference in mm by tooth type (Skalerič 2012, Table II). */
const CIRCUMFERENCE_MM: Record<number, { male: number; female: number }> = {
  1: { male: 22.94, female: 22.56 }, // 11, 21
  2: { male: 20.58, female: 19.69 },
  3: { male: 23.91, female: 23.14 },
  4: { male: 24.74, female: 23.95 },
  5: { male: 23.98, female: 22.44 },
  6: { male: 32.67, female: 30.2 },
  7: { male: 31.86, female: 30.95 },
  8: { male: 30.02, female: 27.68 }, // 18, 28
  // Lower jaw: 31, 41 … 38, 48
  11: { male: 17.53, female: 16.07 },
  12: { male: 18.03, female: 16.34 },
  13: { male: 21.12, female: 20.3 },
  14: { male: 21.46, female: 21.28 },
  15: { male: 21.85, female: 21.15 },
  16: { male: 32.19, female: 30.21 },
  17: { male: 31.8, female: 30.48 },
  18: { male: 29.7, female: 28.56 },
};

/** Which circumference table was used: the patient's sex, or both averaged when it is not recorded. */
export type WoundSexBasis = "male" | "female" | "mean";

export function cejCircumference(tooth: FdiToothNumber, basis: WoundSexBasis): number {
  const lower = Math.floor(tooth / 10) >= 3;
  const row = CIRCUMFERENCE_MM[(tooth % 10) + (lower ? 10 : 0)];
  return basis === "mean" ? (row.male + row.female) / 2 : row[basis];
}

export interface PerioWound {
  /** a+b+c+d, mm² */
  total: number;
  /** b+c+d, mm² */
  burden: number;
  /** b+d, mm² — the active (bleeding) wound */
  bleeding: number;
  basis: WoundSexBasis;
  /** Probing sites that had a depth, out of `sitesPossible` on the teeth probed. */
  sitesMeasured: number;
  sitesPossible: number;
}

/** Null when nothing has been probed yet. */
export function computePerioWound(s: ExaminationSession): PerioWound | null {
  const gender = s.fdiQuestionnaire?.gender;
  const basis: WoundSexBasis = gender === "male" || gender === "female" ? gender : "mean";
  let total = 0;
  let burden = 0;
  let bleeding = 0;
  let sitesMeasured = 0;
  let sitesPossible = 0;

  for (const t of ALL_TEETH) {
    const pd = s.probing[t];
    // Missing teeth and implants have probing switched off
    if (!pd || !pd.present) continue;
    const share = cejCircumference(t, basis) / 6;
    const bop = s.bop?.[t];
    sitesPossible += PROBING_ALL_SITES.length;
    for (const site of PROBING_ALL_SITES) {
      const depth = pd[site];
      if (depth === null || depth === undefined) continue;
      sitesMeasured++;
      const area = share * depth;
      const bleeds = !!bop?.[site];
      total += area;
      if (bleeds || depth > 2) burden += area;
      if (bleeds) bleeding += area;
    }
  }
  if (sitesMeasured === 0) return null;
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return { total: r1(total), burden: r1(burden), bleeding: r1(bleeding), basis, sitesMeasured, sitesPossible };
}
