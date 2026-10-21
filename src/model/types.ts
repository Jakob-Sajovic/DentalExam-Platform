import { Scans3DData } from "./scans3d";
import type { DemographicsData } from "./demographics";

// All FDI tooth numbers (permanent dentition)
export type FdiToothNumber =
  | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18
  | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28
  | 31 | 32 | 33 | 34 | 35 | 36 | 37 | 38
  | 41 | 42 | 43 | 44 | 45 | 46 | 47 | 48;

// Surface identifiers for plaque/bleeding (4 surfaces)
export type PBSurface = "mesial" | "distal" | "buccal" | "lingual";

// Surface identifiers for ICDAS (5 surfaces)
export type ICDASSurface = "mesial" | "distal" | "buccal" | "lingual" | "occlusal";

// Restoration codes 0–8
export type RestorationCode = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

// Caries codes 0–6
export type CariesCode = 0 | 1 | 2 | 3 | 4 | 5 | 6;

// Special case codes (whole-tooth)
export type SpecialCaseCode = "60" | "90" | "91" | "92" | "93" | "96" | "97" | "98" | "99" | "06";

// Plaque/Bleeding: per-tooth data (4 surfaces, boolean toggle each)
export interface PBToothData {
  present: boolean;
  mesial: boolean;
  distal: boolean;
  buccal: boolean;
  lingual: boolean;
}

// Full plaque/bleeding records
export type PlaqueData = Record<FdiToothNumber, PBToothData>;
export type BleedingData = Record<FdiToothNumber, PBToothData>;

// ICDAS: per-surface data (two codes per surface)
export interface ICDASSurfaceData {
  restoration: RestorationCode | null;
  caries: CariesCode | null;
}

// ICDAS: per-tooth data
export interface ICDASToothData {
  status: "normal" | "special";
  surfaces: Record<ICDASSurface, ICDASSurfaceData>;
  specialCode: SpecialCaseCode | null;
}

export type ICDASData = Record<FdiToothNumber, ICDASToothData>;

// Patient identification
export interface PatientData {
  date: string; // ISO date string YYYY-MM-DD
  firstName: string;
  lastName: string;
  code: string;
  checkup: number; // Visit/checkup number 1–10
}

// OHIP-49: 49 item scores, 0–4 Likert or null (unanswered)
export type OhipScore = 0 | 1 | 2 | 3 | 4;
export type OhipData = (OhipScore | null)[];

// OHIP companion items: two one-word self-ratings asked before item 1,
// and the closing free-text message
export interface OhipExtraData {
  healthRating: string;
  appearanceRating: string;
  comment: string;
}

// Probing depth measurement sites (6 per tooth)
export type ProbingSite = "distoBuccal" | "buccal" | "mesioBuccal"
  | "distoLingual" | "lingual" | "mesioLingual";

// Probing depth data per tooth
export interface ProbingToothData {
  present: boolean;
  distoBuccal: number | null;   // mm, 0–25
  buccal: number | null;
  mesioBuccal: number | null;
  distoLingual: number | null;
  lingual: number | null;
  mesioLingual: number | null;
  furcation: number | null;     // 0–3 furcation grade
}

export type ProbingData = Record<FdiToothNumber, ProbingToothData>;

// Root caries (0 = healthy, 1 = initial, 2 = cavitated) — legacy, kept for backwards compat
export type RootCariesScore = 0 | 1 | 2;
export type RootCariesData = Partial<Record<FdiToothNumber, (RootCariesScore | null)[]>>;

// Furcation involvement (Prizadetost razcepišč) — replaces root caries in probing tab
export type FurcationScore = 0 | 1 | 2 | 3;
export type FurcationInvolvementData = Partial<Record<FdiToothNumber, (FurcationScore | null)[]>>;

// Bleeding on Probing (BOP) — checkbox per probing site
export interface BOPToothData {
  distoBuccal: boolean;
  buccal: boolean;
  mesioBuccal: boolean;
  distoLingual: boolean;
  lingual: boolean;
  mesioLingual: boolean;
}
export type BOPData = Record<FdiToothNumber, BOPToothData>;

// ICDAS Root Caries (Koreninski karies) — 6 sites per tooth, values 0/1/2
export type ICDASRootCariesScore = 0 | 1 | 2;
export interface ICDASRootCariesToothData {
  distoBuccal: ICDASRootCariesScore | null;
  buccal: ICDASRootCariesScore | null;
  mesioBuccal: ICDASRootCariesScore | null;
  distoLingual: ICDASRootCariesScore | null;
  lingual: ICDASRootCariesScore | null;
  mesioLingual: ICDASRootCariesScore | null;
}
export type ICDASRootCariesData = Record<FdiToothNumber, ICDASRootCariesToothData>;

// ── Radiographs ──────────────────────────────────────────────────
// Two ways of recording a patient's X-rays:
//  - "composite": one image covering the whole mouth (e.g. a panoramic scan)
//  - "partial":   any number of films in two rows, upper row = upper jaw,
//                 lower row = lower jaw, viewer's left = patient's right.
export type RadiographMode = "composite" | "partial";
export type RadiographJaw = "upper" | "lower";

export interface RadiographImage {
  dataUrl: string;   // compressed JPEG data URL, rotation already baked in
  fileName: string;
  width: number;
  height: number;
}

// One position in a partial-mode row. A skipped position holds no film; it
// only shifts the films after it so they line up with the opposite jaw.
export interface RadiographFigure {
  skip: boolean;
  image: RadiographImage | null;
  toothFrom: FdiToothNumber | null;  // location: first tooth on the film
  toothTo: FdiToothNumber | null;    // location: last tooth (null = single tooth)
  annotation: string;
}

// Film ids of the fixed 10-slot mount used before the two modes existed.
// Kept only to migrate sessions saved with it.
export type LegacyRadiographSlotId =
  | "T1" | "T2" | "T3" | "T4" | "T5"
  | "B1" | "B2" | "B3" | "B4" | "B5";

export interface LegacyRadiographImage extends RadiographImage {
  caption: string;
}

export interface RadiographData {
  mode: RadiographMode | null;       // null until the operator picks one
  composite: RadiographImage | null;
  upper: RadiographFigure[];
  lower: RadiographFigure[];
  opinion: string;                   // overall radiographic diagnosis / opinion
  // Required fields (figure location, or the opinion in composite mode) are
  // flagged until filled in, unless the operator unlocks them for this patient.
  unlocked: boolean;
  // Legacy 10-slot mount; folded into `upper`/`lower` by normalizeRadiographs().
  images?: Partial<Record<LegacyRadiographSlotId, LegacyRadiographImage>>;
}

// Free-text notes
export interface NotesData {
  diagnosticNotes: string;
  qualitativeNotes: string;
}

// Examiner identification
export interface ExaminerData {
  firstName: string;
  lastName: string;
}

// FDI Periodontal Disease Profile questionnaire
export interface FdiQuestionnaireData {
  gender: "male" | "female" | "rather_not_say" | null;
  age: "lt35" | "35to44" | "45to64" | "gt64" | null;
  smoking: "no" | "lt10" | "10to15" | "gt15" | null;
  diabetes: "no" | "well_controlled" | "poorly_controlled" | null;
  toothLoss: "no" | "yes" | null;
  plaque: "lt10" | "10to50" | "gt50" | null;
  bleeding: "lt10" | "10to50" | "gt50" | null;
  probingDepth: "lt4" | "4to5" | "localized_gt5" | "generalized_gt5" | null;
  country: string;
}

// Complete examination session
export interface ExaminationSession {
  sessionId: string;
  schemaVersion: number;
  createdAt: string;
  modifiedAt: string;
  patient: PatientData;
  examiner: ExaminerData;
  plaque: PlaqueData;
  bleeding: BleedingData;
  icdas: ICDASData;
  probing: ProbingData;
  rootCaries: RootCariesData; // legacy — kept for backwards compat
  bop: BOPData;
  furcationInvolvement: FurcationInvolvementData;
  icdasRootCaries: ICDASRootCariesData;
  notes: NotesData;
  radiographs: RadiographData;
  ohip: OhipData;
  ohipExtra: OhipExtraData;
  fdiQuestionnaire: FdiQuestionnaireData;
  scans3d: Scans3DData;
  demographics: DemographicsData;
}
