/**
 * 3D surface scans (Artec head scans, TRIOS intraoral scans) and the preset
 * landmark measurements taken on them.
 *
 * The mesh files themselves are never part of the session: they are far too
 * large for the workbook. A session only records which files belong to a scan
 * (name, size, SHA-256), so the app can find them in local storage or ask for
 * them again and be sure it got the same file. Landmark coordinates are in the
 * scan file's own coordinate system and are only meaningful for that file.
 *
 * Pure module: no DOM, no three.js, so the codec and report can use it.
 */

export type ScanKind = "head" | "intraoral";
export const SCAN_KINDS: ScanKind[] = ["head", "intraoral"];

export const SCAN_KIND_LABELS: Record<ScanKind, string> = {
  head: "Glava (Artec)",
  intraoral: "Intraoralno (TRIOS)",
};

export type Vec3 = [number, number, number];

/**
 * A viewer panel. An intraoral set is measured in three separate panels: each
 * jaw on its own (arch measures) and the two together in occlusion (bite
 * measures). All TRIOS meshes of one set share a coordinate frame, so a point
 * is valid in every panel; the panel only decides what is shown and measured.
 */
export type ScanView = "head" | "upper" | "lower" | "occlusion";

export const SCAN_VIEWS: Record<ScanKind, ScanView[]> = {
  head: ["head"],
  intraoral: ["upper", "lower", "occlusion"],
};

export const SCAN_VIEW_LABELS: Record<ScanView, string> = {
  head: "Glava",
  upper: "Zgornja čeljust",
  lower: "Spodnja čeljust",
  occlusion: "Okluzija",
};

/** What a mesh is, which decides the panels it appears in. */
export type PartRole = "head" | "upper" | "lower" | "bite" | "other";

export const PART_ROLE_LABELS: Record<PartRole, string> = {
  head: "Glava",
  upper: "Zgornja čeljust",
  lower: "Spodnja čeljust",
  bite: "Griz",
  other: "Drugo",
};

/**
 * Parts shown in a panel. Bite scans are only the patches TRIOS used to put
 * the jaws together; they are offered in the occlusion panel but start hidden.
 */
export function partInView(role: PartRole, view: ScanView): { shown: boolean; visibleByDefault: boolean } {
  switch (view) {
    case "head":
      return { shown: true, visibleByDefault: true };
    case "upper":
      return { shown: role === "upper" || role === "other", visibleByDefault: true };
    case "lower":
      return { shown: role === "lower" || role === "other", visibleByDefault: true };
    case "occlusion":
      return { shown: true, visibleByDefault: role !== "bite" };
  }
}

/** Length unit of the coordinates stored in the scan file. */
export type ScanUnit = "mm" | "cm" | "m";
export const SCAN_UNIT_TO_MM: Record<ScanUnit, number> = { mm: 1, cm: 10, m: 1000 };

export interface ScanFileRef {
  name: string;
  size: number;
  sha256: string;
}

/** One mesh of a scan, e.g. the whole head, or the upper jaw of an intraoral set. */
export interface ScanPart {
  id: string;
  label: string;
  /** Missing in sessions saved before panels existed; see partRole(). */
  role?: PartRole;
  mesh: ScanFileRef;
  /** OBJ companions: the .mtl file and its texture images. */
  extras: ScanFileRef[];
}

export interface ScanRecord {
  parts: ScanPart[];
  unit: ScanUnit;
  /** Set once the operator has checked the unit for these files. */
  unitConfirmed: boolean;
  /** `<set id>@<version>` of the landmark list the coordinates were taken with. */
  landmarkSet: string;
  landmarks: Record<string, Vec3>;
  note: string;
}

export type Scans3DData = Record<ScanKind, ScanRecord>;

// ── Landmark and measurement catalogues ──────────────────────────
// PLACEHOLDER lists, pending agreement with the clinical team. Change them
// here only, and bump `version` whenever an id is added, removed or redefined:
// saved coordinates are interpreted by id.

export interface LandmarkDef {
  id: string;
  abbr: string;
  label: string;
  /** Panel the point is placed in. */
  view: ScanView;
}

interface MeasurementBase {
  id: string;
  label: string;
  /** Panel the measurement is listed under. */
  view: ScanView;
}

export type MeasurementDef =
  | (MeasurementBase & { kind: "distance"; points: [string, string] })
  | (MeasurementBase & { kind: "angle"; points: [string, string, string] }); // [a, vertex, b]

export interface LandmarkSet {
  id: string;
  version: number;
  draft: boolean;
  landmarks: LandmarkDef[];
  measurements: MeasurementDef[];
}

// Soft-tissue facial landmarks (Farkas anthropometry). Right/left = patient's.
const HEAD_SET: LandmarkSet = {
  id: "head",
  version: 1,
  draft: true,
  landmarks: [
    { id: "g", abbr: "g", label: "Glabela", view: "head" },
    { id: "n", abbr: "n", label: "Nazion (mehkotkivni)", view: "head" },
    { id: "en_r", abbr: "en d", label: "Endokantion desno", view: "head" },
    { id: "en_l", abbr: "en l", label: "Endokantion levo", view: "head" },
    { id: "ex_r", abbr: "ex d", label: "Eksokantion desno", view: "head" },
    { id: "ex_l", abbr: "ex l", label: "Eksokantion levo", view: "head" },
    { id: "prn", abbr: "prn", label: "Pronazale", view: "head" },
    { id: "sn", abbr: "sn", label: "Subnazale", view: "head" },
    { id: "al_r", abbr: "al d", label: "Alare desno", view: "head" },
    { id: "al_l", abbr: "al l", label: "Alare levo", view: "head" },
    { id: "ls", abbr: "ls", label: "Labrale superius", view: "head" },
    { id: "sto", abbr: "sto", label: "Stomion", view: "head" },
    { id: "li", abbr: "li", label: "Labrale inferius", view: "head" },
    { id: "ch_r", abbr: "ch d", label: "Heilion desno", view: "head" },
    { id: "ch_l", abbr: "ch l", label: "Heilion levo", view: "head" },
    { id: "pg", abbr: "pg", label: "Pogonion (mehkotkivni)", view: "head" },
    { id: "gn", abbr: "gn", label: "Gnation (mehkotkivni)", view: "head" },
    { id: "t_r", abbr: "t d", label: "Tragion desno", view: "head" },
    { id: "t_l", abbr: "t l", label: "Tragion levo", view: "head" },
    { id: "go_r", abbr: "go d", label: "Gonion desno (mehkotkivni)", view: "head" },
    { id: "go_l", abbr: "go l", label: "Gonion levo (mehkotkivni)", view: "head" },
  ],
  measurements: [
    { id: "en_en", label: "Medkantalna širina (en–en)", kind: "distance", points: ["en_r", "en_l"], view: "head" },
    { id: "ex_ex", label: "Biokularna širina (ex–ex)", kind: "distance", points: ["ex_r", "ex_l"], view: "head" },
    { id: "al_al", label: "Širina nosu (al–al)", kind: "distance", points: ["al_r", "al_l"], view: "head" },
    { id: "ch_ch", label: "Širina ust (ch–ch)", kind: "distance", points: ["ch_r", "ch_l"], view: "head" },
    { id: "t_t", label: "Bitragalna širina (t–t)", kind: "distance", points: ["t_r", "t_l"], view: "head" },
    { id: "go_go", label: "Bigonialna širina (go–go)", kind: "distance", points: ["go_r", "go_l"], view: "head" },
    { id: "n_gn", label: "Morfološka višina obraza (n–gn)", kind: "distance", points: ["n", "gn"], view: "head" },
    { id: "n_sn", label: "Višina nosu (n–sn)", kind: "distance", points: ["n", "sn"], view: "head" },
    { id: "sn_gn", label: "Višina spodnje tretjine obraza (sn–gn)", kind: "distance", points: ["sn", "gn"], view: "head" },
    { id: "sn_sto", label: "Višina zgornje ustnice (sn–sto)", kind: "distance", points: ["sn", "sto"], view: "head" },
    { id: "sto_gn", label: "Višina spodnje ustnice in brade (sto–gn)", kind: "distance", points: ["sto", "gn"], view: "head" },
    { id: "sn_prn", label: "Izbočenost nosne konice (sn–prn)", kind: "distance", points: ["sn", "prn"], view: "head" },
    { id: "ang_nasolabial", label: "Nazolabialni kot (prn–sn–ls)", kind: "angle", points: ["prn", "sn", "ls"], view: "head" },
    { id: "ang_convexity", label: "Kot konveksnosti obraza (g–sn–pg)", kind: "angle", points: ["g", "sn", "pg"], view: "head" },
    { id: "ang_total_convexity", label: "Kot celotne konveksnosti (n–prn–pg)", kind: "angle", points: ["n", "prn", "pg"], view: "head" },
  ],
};

// Dental landmarks on the TRIOS scans, in three panels. Arch points are placed
// on each jaw alone; bite points with the jaws closed, where cusp-to-fossa
// relations can be seen. Right/left = patient's.
const INTRAORAL_SET: LandmarkSet = {
  id: "intraoral",
  version: 2,
  draft: true,
  landmarks: [
    // Upper jaw
    { id: "u13", abbr: "13", label: "Konica podočnjaka 13", view: "upper" },
    { id: "u23", abbr: "23", label: "Konica podočnjaka 23", view: "upper" },
    { id: "u16", abbr: "16 mb", label: "Meziobukalna grbica 16", view: "upper" },
    { id: "u26", abbr: "26 mb", label: "Meziobukalna grbica 26", view: "upper" },
    { id: "u_inc", abbr: "UI", label: "Incizalna točka zgoraj (med 11 in 21)", view: "upper" },
    // Lower jaw
    { id: "l33", abbr: "33", label: "Konica podočnjaka 33", view: "lower" },
    { id: "l43", abbr: "43", label: "Konica podočnjaka 43", view: "lower" },
    { id: "l36", abbr: "36 mb", label: "Meziobukalna grbica 36", view: "lower" },
    { id: "l46", abbr: "46 mb", label: "Meziobukalna grbica 46", view: "lower" },
    { id: "l_inc", abbr: "LI", label: "Incizalna točka spodaj (med 31 in 41)", view: "lower" },
    // Occlusion
    { id: "o_u11", abbr: "11 i", label: "Incizalni rob 11 (v okluziji)", view: "occlusion" },
    { id: "o_l41", abbr: "41 i", label: "Incizalni rob 41 (v okluziji)", view: "occlusion" },
    { id: "o_u16", abbr: "16 mb", label: "Meziobukalna grbica 16 (v okluziji)", view: "occlusion" },
    { id: "o_l46", abbr: "46 bf", label: "Bukalna fisura 46 (v okluziji)", view: "occlusion" },
    { id: "o_u26", abbr: "26 mb", label: "Meziobukalna grbica 26 (v okluziji)", view: "occlusion" },
    { id: "o_l36", abbr: "36 bf", label: "Bukalna fisura 36 (v okluziji)", view: "occlusion" },
  ],
  measurements: [
    { id: "u_canine_width", label: "Širina med podočnjaki zgoraj (13–23)", kind: "distance", points: ["u13", "u23"], view: "upper" },
    { id: "u_molar_width", label: "Širina med prvima molarjema zgoraj (16–26)", kind: "distance", points: ["u16", "u26"], view: "upper" },
    { id: "l_canine_width", label: "Širina med podočnjaki spodaj (33–43)", kind: "distance", points: ["l33", "l43"], view: "lower" },
    { id: "l_molar_width", label: "Širina med prvima molarjema spodaj (36–46)", kind: "distance", points: ["l36", "l46"], view: "lower" },
    { id: "o_incisor_dist", label: "Razdalja med incizalnima robovoma 11–41", kind: "distance", points: ["o_u11", "o_l41"], view: "occlusion" },
    { id: "o_molar_r", label: "Molarni odnos desno (16 mb – 46 bf)", kind: "distance", points: ["o_u16", "o_l46"], view: "occlusion" },
    { id: "o_molar_l", label: "Molarni odnos levo (26 mb – 36 bf)", kind: "distance", points: ["o_u26", "o_l36"], view: "occlusion" },
  ],
};

export const LANDMARK_SETS: Record<ScanKind, LandmarkSet> = {
  head: HEAD_SET,
  intraoral: INTRAORAL_SET,
};

export function landmarkSetTag(set: LandmarkSet): string {
  return `${set.id}@${set.version}`;
}

// ── Defaults and normalisation ───────────────────────────────────

export function makeEmptyScanRecord(kind: ScanKind): ScanRecord {
  return {
    parts: [],
    unit: "mm",
    unitConfirmed: false,
    landmarkSet: landmarkSetTag(LANDMARK_SETS[kind]),
    landmarks: {},
    note: "",
  };
}

export function makeDefaultScans3D(): Scans3DData {
  return { head: makeEmptyScanRecord("head"), intraoral: makeEmptyScanRecord("intraoral") };
}

/** Fill in anything missing from a session saved by an older version. */
export function normalizeScans3D(data: Partial<Scans3DData> | null | undefined): Scans3DData {
  const out = makeDefaultScans3D();
  if (!data) return out;
  for (const kind of SCAN_KINDS) {
    const r = data[kind];
    if (!r) continue;
    out[kind] = {
      parts: Array.isArray(r.parts) ? r.parts : [],
      unit: r.unit && r.unit in SCAN_UNIT_TO_MM ? r.unit : "mm",
      unitConfirmed: !!r.unitConfirmed,
      landmarkSet: r.landmarkSet || out[kind].landmarkSet,
      landmarks: r.landmarks && typeof r.landmarks === "object" ? r.landmarks : {},
      note: r.note || "",
    };
  }
  return out;
}

export function hasScanContent(r: ScanRecord): boolean {
  return r.parts.length > 0 || Object.keys(r.landmarks).length > 0 || r.note.trim() !== "";
}

// ── Geometry ─────────────────────────────────────────────────────

/** Coordinates are stored to 0.01 of the file unit — finer than any scan resolves. */
export function roundCoord(v: Vec3): Vec3 {
  return [round2(v[0]), round2(v[1]), round2(v[2])];
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function norm(a: Vec3): number {
  return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
}

export function distance(a: Vec3, b: Vec3): number {
  return norm(sub(a, b));
}

/** Angle at `vertex` between the rays to `a` and `b`, in degrees; null if degenerate. */
export function angleDeg(a: Vec3, vertex: Vec3, b: Vec3): number | null {
  const u = sub(a, vertex);
  const v = sub(b, vertex);
  const nu = norm(u);
  const nv = norm(v);
  if (nu === 0 || nv === 0) return null;
  const cos = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (nu * nv);
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

export interface MeasurementValue {
  def: MeasurementDef;
  /** mm for distances, degrees for angles; null while a landmark is missing. */
  value: number | null;
  unit: "mm" | "°";
}

/** Every measurement of the record's landmark set, computed from its landmarks. */
export function computeMeasurements(kind: ScanKind, record: ScanRecord): MeasurementValue[] {
  const set = LANDMARK_SETS[kind];
  const scale = SCAN_UNIT_TO_MM[record.unit] || 1;
  const lm = record.landmarks;
  return set.measurements.map((def) => {
    const pts = def.points.map((id) => lm[id]);
    if (pts.some((p) => !p)) {
      return { def, value: null, unit: def.kind === "distance" ? "mm" : "°" };
    }
    if (def.kind === "distance") {
      return { def, value: round2(distance(pts[0], pts[1]) * scale), unit: "mm" };
    }
    const ang = angleDeg(pts[0], pts[1], pts[2]);
    return { def, value: ang === null ? null : round2(ang), unit: "°" };
  });
}

// ── Part labelling ───────────────────────────────────────────────

export const MESH_EXTENSIONS = ["stl", "obj", "ply"];

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** What a mesh is, guessed from TRIOS export names ("…UpperJawScan.stl"). */
export function guessPartRole(kind: ScanKind, fileName: string): PartRole {
  if (kind === "head") return "head";
  const n = fileName.toLowerCase();
  if (n.includes("upper") || n.includes("maxilla") || n.includes("zgor")) return "upper";
  if (n.includes("lower") || n.includes("mandib") || n.includes("spod")) return "lower";
  if (n.includes("bite") || n.includes("griz")) return "bite";
  return "other";
}

/** A part's role, also for sessions saved before roles were stored. */
export function partRole(kind: ScanKind, part: ScanPart): PartRole {
  return part.role || guessPartRole(kind, part.mesh.name);
}

export function landmarksInView(kind: ScanKind, view: ScanView): LandmarkDef[] {
  return LANDMARK_SETS[kind].landmarks.filter((l) => l.view === view);
}
