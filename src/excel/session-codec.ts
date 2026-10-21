/**
 * Pure serialization between an ExaminationSession and the flat
 * DentalExam_Data / DentalExam_Slike sheet layout.
 *
 * Deliberately free of any Excel or DOM dependency: the Office add-in drives it
 * through the Excel JavaScript API, and the standalone PWA drives it through
 * SheetJS, so both produce and consume byte-compatible .xlsx files.
 */

import {
  ExaminationSession,
  FdiToothNumber,
  PBSurface,
  ICDASSurface,
  PBToothData,
  ProbingSite,
  FurcationScore,
  ICDASRootCariesScore,
  RadiographData,
  RadiographImage,
  LegacyRadiographSlotId,
  LegacyRadiographImage,
} from "../model/types";
import { ALL_TEETH, SCHEMA_VERSION, PROBING_ALL_SITES, ROOT_CARIES_ALL_TEETH, rootCariesEntryCount, LEGACY_RADIOGRAPH_SLOTS } from "../model/constants";
import { isToothMissing } from "../model/tooth-status";
import {
  RADIOGRAPH_JAWS,
  normalizeRadiographs,
  figuresToFlatText,
  flatTextToFigures,
  makeFigure,
} from "../model/radiographs";
import {
  makeDefaultProbingData,
  makeDefaultRootCariesData,
  makeDefaultFdiQuestionnaire,
  makeDefaultBOPData,
  makeDefaultFurcationInvolvementData,
  makeDefaultICDASRootCariesData,
  makeDefaultRadiographs,
  makeDefaultOhipExtra,
} from "../model/session";
import {
  SCAN_KINDS,
  allLandmarks,
  allMeasurements,
  activeSet,
  DENTITION_STAGES,
  DentitionStage,
  CLEFT_TYPES,
  CleftType,
  ScanUnit,
  SCAN_UNIT_TO_MM,
  Vec3,
  computeMeasurements,
  makeDefaultScans3D,
  normalizeScans3D,
  encodeTeeth,
  decodeTeeth,
} from "../model/scans3d";

export const SHEET_NAME = "DentalExam_Data";
export const IMAGE_SHEET_NAME = "DentalExam_Slike";

// Excel caps a single cell at 32 767 characters. Base64 image payloads are
// split across rows of the image sheet at a comfortable margin below that.
export const MAX_CELL_CHARS = 32767;
export const IMAGE_CHUNK_CHARS = 30000;

export const IMAGE_HEADERS = [
  "session_id", "slot", "part", "parts",
  "file_name", "width", "height", "caption", "data",
];
const PB_SURFACES: PBSurface[] = ["mesial", "distal", "buccal", "lingual"];
const ICDAS_SURFACES: ICDASSurface[] = ["mesial", "distal", "buccal", "lingual", "occlusal"];
// ── Column definition ─────────────────────────────────────────────

export function getColumnHeaders(): string[] {
  const h: string[] = [];

  // Meta
  h.push("session_id", "schema_version", "created_at", "modified_at");

  // Patient
  h.push("patient_date", "patient_firstName", "patient_lastName", "patient_code", "patient_checkup");

  // Examiner
  h.push("examiner_firstName", "examiner_lastName");

  // Computed scores
  h.push("vpi_score_pct", "gbi_score_pct", "bop_score_pct", "ohip_total", "present_teeth_count");

  // Plaque per tooth
  for (const t of ALL_TEETH) {
    h.push(`plaque_${t}_present`);
    for (const s of PB_SURFACES) h.push(`plaque_${t}_${s}`);
  }

  // Bleeding per tooth
  for (const t of ALL_TEETH) {
    h.push(`bleeding_${t}_present`);
    for (const s of PB_SURFACES) h.push(`bleeding_${t}_${s}`);
  }

  // ICDAS per tooth
  for (const t of ALL_TEETH) {
    h.push(`icdas_${t}_status`, `icdas_${t}_specialCode`);
    for (const s of ICDAS_SURFACES) {
      h.push(`icdas_${t}_${s}_rest`, `icdas_${t}_${s}_caries`);
    }
  }

  // Probing per tooth
  for (const t of ALL_TEETH) {
    h.push(`probing_${t}_present`);
    for (const s of PROBING_ALL_SITES) h.push(`probing_${t}_${s}`);
    h.push(`probing_${t}_furcation`);
  }

  // Root caries per measured tooth (legacy)
  for (const t of ROOT_CARIES_ALL_TEETH) {
    const count = rootCariesEntryCount(t);
    for (let i = 0; i < count; i++) h.push(`rootcaries_${t}_${i}`);
  }

  // BOP per tooth (6 sites each)
  for (const t of ALL_TEETH) {
    for (const s of PROBING_ALL_SITES) h.push(`bop_${t}_${s}`);
  }

  // Furcation involvement per measured tooth
  for (const t of ROOT_CARIES_ALL_TEETH) {
    const count = rootCariesEntryCount(t);
    for (let i = 0; i < count; i++) h.push(`furcation_${t}_${i}`);
  }

  // ICDAS root caries per tooth (6 sites each)
  for (const t of ALL_TEETH) {
    for (const s of PROBING_ALL_SITES) h.push(`ircaries_${t}_${s}`);
  }

  // Notes
  h.push("notes_diagnostic", "notes_qualitative");

  // OHIP 1–49
  for (let i = 1; i <= 49; i++) h.push(`ohip_${i}`);
  h.push("ohip_a_health", "ohip_b_appearance", "ohip_comment");

  // FDI questionnaire
  h.push("fdi_gender", "fdi_age", "fdi_smoking", "fdi_diabetes",
    "fdi_toothLoss", "fdi_plaque", "fdi_bleeding", "fdi_probingDepth", "fdi_country");

  // Radiographs — text only; the image payloads live on DentalExam_Slike.
  // Each jaw's films share one cell: "18–16: annotation | — | 15–13: …"
  h.push("radio_mode", "radio_opinion", "radio_unlocked", "radio_composite_file", "radio_upper", "radio_lower");

  // 3D scans — file references, landmark coordinates (file units) and the
  // computed measurements (mm / degrees). The meshes themselves are not stored.
  // Every list's points and measurements get columns (each id once), so a
  // column means the same thing whichever list a patient was measured with.
  for (const kind of SCAN_KINDS) {
    h.push(`s3_${kind}_parts`, `s3_${kind}_unit`, `s3_${kind}_unit_confirmed`, `s3_${kind}_set`, `s3_${kind}_note`);
    if (kind === "intraoral") h.push(`s3_${kind}_stage`, `s3_${kind}_cleft`);
    for (const lm of allLandmarks(kind)) h.push(`s3_${kind}_lm_${lm.id}_x`, `s3_${kind}_lm_${lm.id}_y`, `s3_${kind}_lm_${lm.id}_z`);
    for (const m of allMeasurements(kind)) h.push(`s3_${kind}_m_${m.id}`);
    if (kind === "intraoral") h.push(`s3_${kind}_teeth`);
  }

  // Full JSON backup for reliable reload
  h.push("_json");

  return h;
}

// ── Serialize session → row values ────────────────────────────────

export function sessionToRow(s: ExaminationSession): (string | number | boolean | null)[] {
  const row: (string | number | boolean | null)[] = [];

  // Meta
  row.push(s.sessionId, s.schemaVersion, s.createdAt, s.modifiedAt);

  // Patient
  row.push(s.patient.date, s.patient.firstName, s.patient.lastName, s.patient.code, s.patient.checkup || 1);

  // Examiner
  const examiner = s.examiner || { firstName: "", lastName: "" };
  row.push(examiner.firstName, examiner.lastName);

  // Computed scores
  row.push(calcPBPct(s.plaque), calcPBPct(s.bleeding), calcBOPPct(s), calcOhipTotal(s.ohip), calcPresentTeeth(s));

  // Plaque
  for (const t of ALL_TEETH) {
    const td = s.plaque[t];
    row.push(td.present);
    for (const sf of PB_SURFACES) row.push(td[sf]);
  }

  // Bleeding
  for (const t of ALL_TEETH) {
    const td = s.bleeding[t];
    row.push(td.present);
    for (const sf of PB_SURFACES) row.push(td[sf]);
  }

  // ICDAS
  for (const t of ALL_TEETH) {
    const td = s.icdas[t];
    row.push(td.status, td.specialCode);
    for (const sf of ICDAS_SURFACES) {
      const sd = td.surfaces[sf];
      row.push(sd.restoration, sd.caries);
    }
  }

  // Probing
  for (const t of ALL_TEETH) {
    const pt = s.probing[t];
    row.push(pt.present);
    for (const site of PROBING_ALL_SITES) row.push(pt[site]);
    row.push(pt.furcation);
  }

  // Root caries (legacy)
  const rc = s.rootCaries || {};
  for (const t of ROOT_CARIES_ALL_TEETH) {
    const count = rootCariesEntryCount(t);
    const entries = rc[t] || new Array(count).fill(null);
    for (let i = 0; i < count; i++) row.push(entries[i]);
  }

  // BOP
  const bop = s.bop || {};
  for (const t of ALL_TEETH) {
    for (const site of PROBING_ALL_SITES) {
      const td = bop[t];
      row.push(td ? (td as Record<string, boolean>)[site] : false);
    }
  }

  // Furcation involvement
  const fi = s.furcationInvolvement || {};
  for (const t of ROOT_CARIES_ALL_TEETH) {
    const count = rootCariesEntryCount(t);
    const entries = fi[t] || new Array(count).fill(0);
    for (let i = 0; i < count; i++) row.push(entries[i]);
  }

  // ICDAS root caries
  const icRC = s.icdasRootCaries || {};
  for (const t of ALL_TEETH) {
    for (const site of PROBING_ALL_SITES) {
      const td = icRC[t];
      row.push(td ? (td as Record<string, number | null>)[site] : null);
    }
  }

  // Notes
  row.push(s.notes.diagnosticNotes, s.notes.qualitativeNotes);

  // OHIP
  for (let i = 0; i < 49; i++) row.push(s.ohip[i]);
  const ohipExtra = s.ohipExtra || makeDefaultOhipExtra();
  row.push(ohipExtra.healthRating, ohipExtra.appearanceRating, ohipExtra.comment);

  // FDI questionnaire
  const fdi = s.fdiQuestionnaire || { gender: null, age: null, smoking: null, diabetes: null, toothLoss: null, plaque: null, bleeding: null, probingDepth: null, country: "" };
  row.push(fdi.gender, fdi.age, fdi.smoking, fdi.diabetes,
    fdi.toothLoss, fdi.plaque, fdi.bleeding, fdi.probingDepth, fdi.country);

  // Radiographs — mode, opinion and film locations; images go to their own sheet
  const radio = normalizeRadiographs(s.radiographs);
  row.push(
    radio.mode || "",
    radio.opinion || "",
    radio.unlocked,
    radio.composite ? radio.composite.fileName : "",
    figuresToFlatText(radio.upper),
    figuresToFlatText(radio.lower)
  );

  // 3D scans
  const scans = normalizeScans3D(s.scans3d);
  for (const kind of SCAN_KINDS) {
    const rec = scans[kind];
    row.push(
      rec.parts.length ? JSON.stringify(rec.parts) : "",
      rec.parts.length ? rec.unit : "",
      rec.unitConfirmed,
      rec.landmarkSet,
      rec.note
    );
    if (kind === "intraoral") row.push(rec.stage, rec.cleft);
    for (const lm of allLandmarks(kind)) {
      const p = rec.landmarks[lm.id];
      row.push(p ? p[0] : null, p ? p[1] : null, p ? p[2] : null);
    }
    // Only the active list's measurements are filled; the others stay empty
    const active = new Set(activeSet(kind, rec).measurements.map((m) => m.id));
    for (const m of computeMeasurements(kind, rec, allMeasurements(kind))) row.push(active.has(m.def.id) ? m.value : null);
    if (kind === "intraoral") row.push(encodeTeeth(rec.teeth));
  }

  // JSON backup. Image data URLs are excluded — they would blow past Excel's
  // 32 767-character cell limit on their own.
  row.push(buildJsonBackup(s));

  return row;
}

/**
 * Serialize the session for the `_json` backup cell with image payloads
 * stripped. If the result would still exceed Excel's per-cell limit the cell is
 * left empty rather than written truncated — the flat columns alongside it
 * carry the same data and the readers already fall back to them.
 */
function buildJsonBackup(s: ExaminationSession): string {
  const radio = normalizeRadiographs(s.radiographs);
  const slim = (img: RadiographImage | null): RadiographImage | null =>
    img ? { dataUrl: "", fileName: img.fileName, width: img.width, height: img.height } : null;

  const slimRadio: RadiographData = {
    ...radio,
    composite: slim(radio.composite),
    upper: radio.upper.map((f) => ({ ...f, image: slim(f.image) })),
    lower: radio.lower.map((f) => ({ ...f, image: slim(f.image) })),
  };
  const copy = { ...s, radiographs: slimRadio };
  const json = JSON.stringify(copy);
  if (json.length > MAX_CELL_CHARS) {
    // eslint-disable-next-line no-console
    console.warn(`_json backup is ${json.length} chars, over Excel's ${MAX_CELL_CHARS} limit — omitted.`);
    return "";
  }
  return json;
}

function calcPBPct(data: Record<FdiToothNumber, PBToothData>): number {
  let total = 0;
  let active = 0;
  for (const t of ALL_TEETH) {
    const td = data[t];
    if (!td.present) continue;
    for (const sf of PB_SURFACES) {
      total++;
      if (td[sf]) active++;
    }
  }
  return total > 0 ? Math.round((active / total) * 1000) / 10 : 0;
}

function calcBOPPct(s: ExaminationSession): number {
  if (!s.bop || !s.probing) return 0;
  let total = 0;
  let active = 0;
  for (const t of ALL_TEETH) {
    if (!s.probing[t].present) continue;
    for (const site of PROBING_ALL_SITES) {
      total++;
      if ((s.bop[t] as Record<string, boolean>)[site]) active++;
    }
  }
  return total > 0 ? Math.round((active / total) * 1000) / 10 : 0;
}

function calcOhipTotal(ohip: (number | null)[]): number {
  let total = 0;
  for (const v of ohip) { if (v !== null) total += v; }
  return total;
}

function calcPresentTeeth(s: ExaminationSession): number {
  let present = 0;
  for (const t of ALL_TEETH) {
    if (!isToothMissing(s, t)) present++;
  }
  return present;
}
// ── Radiograph images: chunked base64 on a dedicated sheet ────────
// Each image is keyed in the "slot" column: "C" for the composite image,
// "U<n>" / "L<n>" for the n-th position (1-based, skipped positions counted)
// of the upper / lower row. Files from the old 10-slot mount use T1–T5, B1–B5.

const COMPOSITE_KEY = "C";
const JAW_KEY: Record<"upper" | "lower", string> = { upper: "U", lower: "L" };

interface ImageChunkRow {
  key: string;
  part: number;
  parts: number;
  fileName: string;
  width: number;
  height: number;
  caption: string;
  data: string;
}

export interface StoredRadiographImage {
  image: RadiographImage;
  caption: string;
}

/** Images read off the image sheet, by slot key. */
export type StoredRadiographImages = Record<string, StoredRadiographImage>;

/** Split each stored image into cell-sized base64 chunks, one chunk per row. */
export function radiographsToImageRows(s: ExaminationSession): (string | number)[][] {
  if (!s.radiographs) return [];
  const radio = normalizeRadiographs(s.radiographs);

  const entries: { key: string; img: RadiographImage; caption: string }[] = [];
  if (radio.composite) entries.push({ key: COMPOSITE_KEY, img: radio.composite, caption: "" });
  for (const jaw of RADIOGRAPH_JAWS) {
    radio[jaw].forEach((f, i) => {
      if (f.image) entries.push({ key: `${JAW_KEY[jaw]}${i + 1}`, img: f.image, caption: f.annotation || "" });
    });
  }

  const rows: (string | number)[][] = [];
  for (const { key, img, caption } of entries) {
    if (!img.dataUrl) continue;
    const parts = Math.max(1, Math.ceil(img.dataUrl.length / IMAGE_CHUNK_CHARS));
    for (let i = 0; i < parts; i++) {
      rows.push([
        s.sessionId,
        key,
        i + 1,
        parts,
        img.fileName || "",
        img.width || 0,
        img.height || 0,
        i === 0 ? caption : "",
        img.dataUrl.slice(i * IMAGE_CHUNK_CHARS, (i + 1) * IMAGE_CHUNK_CHARS),
      ]);
    }
  }
  return rows;
}

/** Reassemble chunk rows belonging to one session back into images, by slot key. */
export function imageRowsToRadiographs(
  headers: string[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rows: any[][],
  sessionId: string
): StoredRadiographImages {
  const idx = (name: string) => headers.indexOf(name);
  const cSession = idx("session_id");
  const cSlot = idx("slot");
  const cPart = idx("part");
  const cParts = idx("parts");
  const cFile = idx("file_name");
  const cWidth = idx("width");
  const cHeight = idx("height");
  const cCaption = idx("caption");
  const cData = idx("data");
  if (cSession < 0 || cSlot < 0 || cData < 0) return {};

  const byKey: Record<string, ImageChunkRow[]> = {};
  for (const r of rows) {
    if (String(r[cSession] ?? "") !== sessionId) continue;
    const key = String(r[cSlot] ?? "").trim();
    if (!key) continue;
    (byKey[key] = byKey[key] || []).push({
      key,
      part: Number(r[cPart] ?? 1) || 1,
      parts: Number(r[cParts] ?? 1) || 1,
      fileName: String(r[cFile] ?? ""),
      width: Number(r[cWidth] ?? 0) || 0,
      height: Number(r[cHeight] ?? 0) || 0,
      caption: String(r[cCaption] ?? ""),
      data: String(r[cData] ?? ""),
    });
  }

  const images: StoredRadiographImages = {};
  for (const key of Object.keys(byKey)) {
    const chunks = byKey[key].sort((a, b) => a.part - b.part);
    // A partially written image (interrupted save) is dropped rather than shown broken.
    if (chunks.length !== chunks[0].parts) continue;
    images[key] = {
      image: {
        dataUrl: chunks.map((c) => c.data).join(""),
        fileName: chunks[0].fileName,
        width: chunks[0].width,
        height: chunks[0].height,
      },
      caption: chunks[0].caption,
    };
  }
  return images;
}

/**
 * Put the images read off the image sheet back into a loaded session's
 * radiograph data (whose text came from _json or the flat columns), and
 * upgrade data saved with the old 10-slot mount. Image records the sheet did
 * not supply are dropped, since without pixels they cannot be shown.
 */
export function restoreRadiographs(s: ExaminationSession, stored: StoredRadiographImages): void {
  const radio = s.radiographs || ({} as RadiographData);

  // Old 10-slot mount: merge sheet images into the legacy map, then migrate
  const legacyIds = LEGACY_RADIOGRAPH_SLOTS.map((d) => d.id);
  for (const id of legacyIds) {
    const got = stored[id];
    if (!got) continue;
    const images = (radio.images = radio.images || {});
    const prev = images[id];
    images[id] = { ...got.image, caption: prev?.caption || got.caption };
  }
  if (radio.images) {
    for (const id of Object.keys(radio.images) as LegacyRadiographSlotId[]) {
      const img = radio.images[id] as LegacyRadiographImage;
      if (!stored[id]) img.dataUrl = "";
    }
  }
  s.radiographs = normalizeRadiographs(radio);
  const r = s.radiographs;

  // Records carried over without pixels (the _json backup holds none) are dropped
  const keep = (img: RadiographImage | null) => (img && img.dataUrl ? img : null);
  r.composite = stored[COMPOSITE_KEY] ? stored[COMPOSITE_KEY].image : keep(r.composite);
  for (const jaw of RADIOGRAPH_JAWS) {
    const figures = r[jaw];
    figures.forEach((f, i) => {
      const got = stored[`${JAW_KEY[jaw]}${i + 1}`];
      f.image = f.skip ? null : got ? got.image : keep(f.image);
    });
    // Images beyond the known positions (flat-column fallback lost them): append
    for (const key of Object.keys(stored)) {
      const m = new RegExp(`^${JAW_KEY[jaw]}(\\d+)$`).exec(key);
      if (!m) continue;
      const i = Number(m[1]) - 1;
      if (i < figures.length) continue;
      while (figures.length < i) figures.push(makeFigure());
      figures.push({ ...makeFigure(stored[key].image), annotation: stored[key].caption });
    }
  }
}

// ── Row → Session reconstruction (fallback) ───────────────────────

export function rowToSession(
  headers: string[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  values: any[]
): ExaminationSession | null {
  const col = (name: string) => {
    const idx = headers.indexOf(name);
    return idx >= 0 ? values[idx] : null;
  };

  const str = (name: string): string => String(col(name) ?? "");
  const num = (name: string): number | null => {
    const v = col(name);
    if (v === "" || v === null || v === undefined) return null;
    const n = Number(v);
    return isNaN(n) ? null : n;
  };
  const bool = (name: string): boolean => {
    const v = col(name);
    return v === true || v === 1 || v === "1" || v === "TRUE";
  };

  const session: ExaminationSession = {
    sessionId: str("session_id") || "imported",
    schemaVersion: num("schema_version") ?? SCHEMA_VERSION,
    createdAt: str("created_at") || new Date().toISOString(),
    modifiedAt: str("modified_at") || new Date().toISOString(),
    patient: {
      date: str("patient_date"),
      firstName: str("patient_firstName"),
      lastName: str("patient_lastName"),
      code: str("patient_code"),
      checkup: num("patient_checkup") ?? 1,
    },
    examiner: {
      firstName: str("examiner_firstName"),
      lastName: str("examiner_lastName"),
    },
    plaque: {} as ExaminationSession["plaque"],
    bleeding: {} as ExaminationSession["bleeding"],
    icdas: {} as ExaminationSession["icdas"],
    probing: makeDefaultProbingData(),
    rootCaries: makeDefaultRootCariesData(),
    bop: makeDefaultBOPData(),
    furcationInvolvement: makeDefaultFurcationInvolvementData(),
    icdasRootCaries: makeDefaultICDASRootCariesData(),
    notes: {
      diagnosticNotes: str("notes_diagnostic"),
      qualitativeNotes: str("notes_qualitative"),
    },
    radiographs: makeDefaultRadiographs(),
    ohip: [],
    ohipExtra: makeDefaultOhipExtra(),
    fdiQuestionnaire: makeDefaultFdiQuestionnaire(),
    scans3d: makeDefaultScans3D(),
  };

  // 3D scans — measurements are recomputed from the landmarks, never read back
  for (const kind of SCAN_KINDS) {
    const rec = session.scans3d[kind];
    try {
      const parts = JSON.parse(str(`s3_${kind}_parts`) || "[]");
      if (Array.isArray(parts)) rec.parts = parts;
    } catch {
      /* unreadable part list: the landmarks below still load */
    }
    const unit = str(`s3_${kind}_unit`);
    if (unit in SCAN_UNIT_TO_MM) rec.unit = unit as ScanUnit;
    rec.unitConfirmed = bool(`s3_${kind}_unit_confirmed`);
    rec.landmarkSet = str(`s3_${kind}_set`) || rec.landmarkSet;
    rec.note = str(`s3_${kind}_note`);
    if (kind === "intraoral") {
      const stage = str(`s3_${kind}_stage`);
      if (DENTITION_STAGES.includes(stage as DentitionStage)) rec.stage = stage as DentitionStage;
      const cleft = str(`s3_${kind}_cleft`);
      if (CLEFT_TYPES.includes(cleft as CleftType)) rec.cleft = cleft as CleftType;
    }
    for (const lm of allLandmarks(kind)) {
      const x = num(`s3_${kind}_lm_${lm.id}_x`);
      const y = num(`s3_${kind}_lm_${lm.id}_y`);
      const z = num(`s3_${kind}_lm_${lm.id}_z`);
      if (x !== null && y !== null && z !== null) rec.landmarks[lm.id] = [x, y, z] as Vec3;
    }
    if (kind === "intraoral") rec.teeth = decodeTeeth(str(`s3_${kind}_teeth`));
  }

  // Radiograph text columns — image payloads are restored from the image sheet
  const radio = session.radiographs;
  const mode = str("radio_mode");
  radio.mode = mode === "composite" || mode === "partial" ? mode : null;
  radio.opinion = str("radio_opinion");
  radio.unlocked = bool("radio_unlocked");
  for (const jaw of RADIOGRAPH_JAWS) {
    radio[jaw] = flatTextToFigures(jaw, str(jaw === "upper" ? "radio_upper" : "radio_lower"));
  }
  // Files saved with the old 10-slot mount
  for (const slot of LEGACY_RADIOGRAPH_SLOTS) {
    const fileName = str(`radio_${slot.id}_file`);
    const caption = str(`radio_${slot.id}_caption`);
    if (!fileName && !caption) continue;
    radio.images = radio.images || {};
    radio.images[slot.id] = { dataUrl: "", fileName, width: 0, height: 0, caption };
  }

  // Plaque & bleeding
  for (const t of ALL_TEETH) {
    session.plaque[t] = {
      present: bool(`plaque_${t}_present`),
      mesial: bool(`plaque_${t}_mesial`),
      distal: bool(`plaque_${t}_distal`),
      buccal: bool(`plaque_${t}_buccal`),
      lingual: bool(`plaque_${t}_lingual`),
    };
    session.bleeding[t] = {
      present: bool(`bleeding_${t}_present`),
      mesial: bool(`bleeding_${t}_mesial`),
      distal: bool(`bleeding_${t}_distal`),
      buccal: bool(`bleeding_${t}_buccal`),
      lingual: bool(`bleeding_${t}_lingual`),
    };
  }

  // ICDAS
  for (const t of ALL_TEETH) {
    const status = str(`icdas_${t}_status`);
    session.icdas[t] = {
      status: status === "special" ? "special" : "normal",
      specialCode: str(`icdas_${t}_specialCode`) || null,
      surfaces: {} as ExaminationSession["icdas"][FdiToothNumber]["surfaces"],
    } as ExaminationSession["icdas"][FdiToothNumber];

    for (const sf of ICDAS_SURFACES) {
      (session.icdas[t].surfaces as Record<string, { restoration: number | null; caries: number | null }>)[sf] = {
        restoration: num(`icdas_${t}_${sf}_rest`),
        caries: num(`icdas_${t}_${sf}_caries`),
      };
    }
  }

  // Probing
  for (const t of ALL_TEETH) {
    const hasProbingCol = headers.indexOf(`probing_${t}_present`) >= 0;
    if (hasProbingCol) {
      session.probing[t] = {
        present: bool(`probing_${t}_present`),
        distoBuccal: num(`probing_${t}_distoBuccal`),
        buccal: num(`probing_${t}_buccal`),
        mesioBuccal: num(`probing_${t}_mesioBuccal`),
        distoLingual: num(`probing_${t}_distoLingual`),
        lingual: num(`probing_${t}_lingual`),
        mesioLingual: num(`probing_${t}_mesioLingual`),
        furcation: num(`probing_${t}_furcation`),
      };
    }
  }

  // Root caries (legacy)
  for (const t of ROOT_CARIES_ALL_TEETH) {
    const count = rootCariesEntryCount(t);
    const hasCol = headers.indexOf(`rootcaries_${t}_0`) >= 0;
    if (hasCol) {
      const entries: (number | null)[] = [];
      for (let i = 0; i < count; i++) entries.push(num(`rootcaries_${t}_${i}`));
      session.rootCaries[t] = entries as ExaminationSession["rootCaries"][typeof t];
    }
  }

  // BOP
  for (const t of ALL_TEETH) {
    const hasCol = headers.indexOf(`bop_${t}_distoBuccal`) >= 0;
    if (hasCol) {
      for (const site of PROBING_ALL_SITES) {
        (session.bop[t] as Record<string, boolean>)[site] = bool(`bop_${t}_${site}`);
      }
    }
  }

  // Furcation involvement
  for (const t of ROOT_CARIES_ALL_TEETH) {
    const count = rootCariesEntryCount(t);
    const hasCol = headers.indexOf(`furcation_${t}_0`) >= 0;
    if (hasCol) {
      const entries: number[] = [];
      for (let i = 0; i < count; i++) entries.push((num(`furcation_${t}_${i}`) ?? 0) as FurcationScore);
      session.furcationInvolvement[t] = entries as FurcationScore[];
    }
  }

  // ICDAS root caries
  for (const t of ALL_TEETH) {
    const hasCol = headers.indexOf(`ircaries_${t}_distoBuccal`) >= 0;
    if (hasCol) {
      for (const site of PROBING_ALL_SITES) {
        (session.icdasRootCaries[t] as Record<string, number | null>)[site] = num(`ircaries_${t}_${site}`);
      }
    }
  }

  // OHIP
  for (let i = 1; i <= 49; i++) {
    session.ohip.push(num(`ohip_${i}`) as ExaminationSession["ohip"][number]);
  }
  session.ohipExtra = {
    healthRating: str("ohip_a_health"),
    appearanceRating: str("ohip_b_appearance"),
    comment: str("ohip_comment"),
  };

  // FDI questionnaire
  session.fdiQuestionnaire = {
    gender: (str("fdi_gender") || null) as ExaminationSession["fdiQuestionnaire"]["gender"],
    age: (str("fdi_age") || null) as ExaminationSession["fdiQuestionnaire"]["age"],
    smoking: (str("fdi_smoking") || null) as ExaminationSession["fdiQuestionnaire"]["smoking"],
    diabetes: (str("fdi_diabetes") || null) as ExaminationSession["fdiQuestionnaire"]["diabetes"],
    toothLoss: (str("fdi_toothLoss") || null) as ExaminationSession["fdiQuestionnaire"]["toothLoss"],
    plaque: (str("fdi_plaque") || null) as ExaminationSession["fdiQuestionnaire"]["plaque"],
    bleeding: (str("fdi_bleeding") || null) as ExaminationSession["fdiQuestionnaire"]["bleeding"],
    probingDepth: (str("fdi_probingDepth") || null) as ExaminationSession["fdiQuestionnaire"]["probingDepth"],
    country: str("fdi_country"),
  };

  return session;
}

