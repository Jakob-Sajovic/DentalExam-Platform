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
  /** Intraoral: dentition and cleft, which choose the landmark list (activeSet). */
  stage: DentitionStage;
  cleft: CleftType;
  landmarks: Record<string, Vec3>;
  /** Tooth number labels placed on an intraoral scan: FDI number → point. */
  teeth: Record<string, Vec3>;
  /** Pictures for the report, by SNAPSHOT_PLAN id. Kept out of the _json cell. */
  snapshots: Record<string, ScanSnapshot>;
  note: string;
}

export interface ScanSnapshot {
  label: string;
  /** JPEG data URL. */
  dataUrl: string;
  width: number;
  height: number;
}

/**
 * The report's views of each scan. Each is the panel's current view turned
 * about the screen's vertical axis: from the front view, +90° brings the
 * patient's right side to the camera. Jaw views are the panels' own
 * (occlusal) views.
 */
export const SNAPSHOT_PLAN: Record<ScanKind, { id: string; label: string; view: ScanView; turn: number }[]> = {
  head: [
    { id: "right", label: "Desna stran", view: "head", turn: 90 },
    { id: "front", label: "Spredaj", view: "head", turn: 0 },
    { id: "left", label: "Leva stran", view: "head", turn: -90 },
    { id: "back", label: "Zadaj", view: "head", turn: 180 },
  ],
  intraoral: [
    { id: "upper", label: "Zgornja čeljust", view: "upper", turn: 0 },
    { id: "lower", label: "Spodnja čeljust", view: "lower", turn: 0 },
    { id: "bite_right", label: "Griz — desno", view: "occlusion", turn: 90 },
    { id: "bite_front", label: "Griz — spredaj", view: "occlusion", turn: 0 },
    { id: "bite_left", label: "Griz — levo", view: "occlusion", turn: -90 },
  ],
};

export type Scans3DData = Record<ScanKind, ScanRecord>;

// ── Landmark and measurement catalogues ──────────────────────────
// Change them here only, and bump `version` whenever an id is added, removed
// or redefined: saved coordinates are interpreted by id. Ids are shared
// between the lists of one scan kind where the point means the same thing
// (T–T′ in the infant and the primary-dentition list, say), so switching a
// list keeps the points both have. Right/left = patient's.

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

/** Axis of the occlusal frame (see occlusalFrame). */
export type FrameAxis = "anterior" | "up" | "left";

export type MeasurementDef =
  | (MeasurementBase & { kind: "distance"; points: [string, string] })
  // [a, vertex, b]
  | (MeasurementBase & { kind: "angle"; points: [string, string, string] })
  // Perpendicular distance from points[0] to the line points[1]–points[2]
  | (MeasurementBase & { kind: "pointLine"; points: [string, string, string] })
  // Angle at points[0] between its perpendicular onto the line points[1]–points[2]
  // and the line to that segment's midpoint: 0° when the point lies on the
  // segment's perpendicular bisector
  | (MeasurementBase & { kind: "offsetAngle"; points: [string, string, string] })
  // Signed component of points[1] − points[0] along one axis of the occlusal
  // frame built from `frame` = [right molar, left molar, front midline]
  | (MeasurementBase & { kind: "component"; points: [string, string]; axis: FrameAxis; frame: [string, string, string] });

/** Every landmark a measurement needs, its frame included. */
export function measurementPoints(def: MeasurementDef): string[] {
  return def.kind === "component" ? [...def.points, ...def.frame] : [...def.points];
}

export function measurementUnit(def: MeasurementDef): "mm" | "°" {
  return def.kind === "angle" || def.kind === "offsetAngle" ? "°" : "mm";
}

export interface LandmarkSet {
  id: string;
  version: number;
  /** Still a working list, to be agreed with the clinical team. */
  draft: boolean;
  landmarks: LandmarkDef[];
  measurements: MeasurementDef[];
}

const lm = (id: string, abbr: string, label: string, view: ScanView): LandmarkDef => ({ id, abbr, label, view });
const dist = (id: string, label: string, view: ScanView, a: string, b: string): MeasurementDef => ({
  id, label, view, kind: "distance", points: [a, b],
});
const toLine = (id: string, label: string, view: ScanView, p: string, a: string, b: string): MeasurementDef => ({
  id, label, view, kind: "pointLine", points: [p, a, b],
});

// Soft-tissue facial landmarks (Farkas anthropometry). PLACEHOLDER list.
const HEAD_SET: LandmarkSet = {
  id: "head",
  version: 1,
  draft: true,
  landmarks: [
    lm("g", "g", "Glabela", "head"),
    lm("n", "n", "Nazion (mehkotkivni)", "head"),
    lm("en_r", "en d", "Endokantion desno", "head"),
    lm("en_l", "en l", "Endokantion levo", "head"),
    lm("ex_r", "ex d", "Eksokantion desno", "head"),
    lm("ex_l", "ex l", "Eksokantion levo", "head"),
    lm("prn", "prn", "Pronazale", "head"),
    lm("sn", "sn", "Subnazale", "head"),
    lm("al_r", "al d", "Alare desno", "head"),
    lm("al_l", "al l", "Alare levo", "head"),
    lm("ls", "ls", "Labrale superius", "head"),
    lm("sto", "sto", "Stomion", "head"),
    lm("li", "li", "Labrale inferius", "head"),
    lm("ch_r", "ch d", "Heilion desno", "head"),
    lm("ch_l", "ch l", "Heilion levo", "head"),
    lm("pg", "pg", "Pogonion (mehkotkivni)", "head"),
    lm("gn", "gn", "Gnation (mehkotkivni)", "head"),
    lm("t_r", "t d", "Tragion desno", "head"),
    lm("t_l", "t l", "Tragion levo", "head"),
    lm("go_r", "go d", "Gonion desno (mehkotkivni)", "head"),
    lm("go_l", "go l", "Gonion levo (mehkotkivni)", "head"),
  ],
  measurements: [
    dist("en_en", "Medkantalna širina (en–en)", "head", "en_r", "en_l"),
    dist("ex_ex", "Biokularna širina (ex–ex)", "head", "ex_r", "ex_l"),
    dist("al_al", "Širina nosu (al–al)", "head", "al_r", "al_l"),
    dist("ch_ch", "Širina ust (ch–ch)", "head", "ch_r", "ch_l"),
    dist("t_t", "Bitragalna širina (t–t)", "head", "t_r", "t_l"),
    dist("go_go", "Bigonialna širina (go–go)", "head", "go_r", "go_l"),
    dist("n_gn", "Morfološka višina obraza (n–gn)", "head", "n", "gn"),
    dist("n_sn", "Višina nosu (n–sn)", "head", "n", "sn"),
    dist("sn_gn", "Višina spodnje tretjine obraza (sn–gn)", "head", "sn", "gn"),
    dist("sn_sto", "Višina zgornje ustnice (sn–sto)", "head", "sn", "sto"),
    dist("sto_gn", "Višina spodnje ustnice in brade (sto–gn)", "head", "sto", "gn"),
    dist("sn_prn", "Izbočenost nosne konice (sn–prn)", "head", "sn", "prn"),
    { id: "ang_nasolabial", label: "Nazolabialni kot (prn–sn–ls)", kind: "angle", points: ["prn", "sn", "ls"], view: "head" },
    { id: "ang_convexity", label: "Kot konveksnosti obraza (g–sn–pg)", kind: "angle", points: ["g", "sn", "pg"], view: "head" },
    { id: "ang_total_convexity", label: "Kot celotne konveksnosti (n–prn–pg)", kind: "angle", points: ["n", "prn", "pg"], view: "head" },
  ],
};

// ── Intraoral: maxillary arch points shared by the infant and primary lists
// (Veršič et al., Birth to bite; Zgojznik et al., BCLP). Placed on the upper
// jaw, which for an infant is the only cast.

const ARCH_T = [
  lm("T_r", "T", "Tuberozitas maksile desno", "upper"),
  lm("T_l", "T′", "Tuberozitas maksile levo", "upper"),
];
const ARCH_S = [
  lm("S_r", "S", "Najširša točka loka desno", "upper"),
  lm("S_l", "S′", "Najširša točka loka levo", "upper"),
];
const ARCH_A = lm("A", "A", "Incizivna papila", "upper");

const M_TT = dist("tt", "Širina med tuberozitetama (T–T′)", "upper", "T_r", "T_l");
const M_SS = dist("ss", "Največja širina loka (S–S′)", "upper", "S_r", "S_l");
const M_CC = dist("cc", "Širina v predelu podočnjakov (C–C′)", "upper", "C_r", "C_l");
const M_AX = toLine("ax", "Dolžina loka (A–X, od A pravokotno na T–T′)", "upper", "A", "T_r", "T_l");

// Infant, no cleft: the alveolar ridges only
const INFANT_SET: LandmarkSet = {
  id: "intraoral-infant",
  version: 1,
  draft: false,
  landmarks: [
    ...ARCH_T,
    ...ARCH_S,
    lm("C_r", "C", "Točka podočnjaka desno (vrh grebena ob bukalni pliki)", "upper"),
    lm("C_l", "C′", "Točka podočnjaka levo (vrh grebena ob bukalni pliki)", "upper"),
    ARCH_A,
  ],
  measurements: [M_TT, M_SS, M_CC, M_AX],
};

// Infant, unilateral cleft: the same, plus the size of the cleft (Birth to bite)
const INFANT_UCLP_SET: LandmarkSet = {
  id: "intraoral-infant-uclp",
  version: 1,
  draft: false,
  landmarks: [
    ...INFANT_SET.landmarks,
    lm("L", "L", "Sprednji konec manjšega segmenta", "upper"),
    lm("G", "G", "Sprednji konec večjega segmenta", "upper"),
    lm("cl_c1", "c", "Rob razcepa na črti C–C′, manjši segment", "upper"),
    lm("cl_c2", "c′", "Rob razcepa na črti C–C′, večji segment", "upper"),
    lm("cl_t1", "t", "Rob razcepa na črti T–T′, manjši segment", "upper"),
    lm("cl_t2", "t′", "Rob razcepa na črti T–T′, večji segment", "upper"),
  ],
  measurements: [
    ...INFANT_SET.measurements,
    dist("lg", "Razdalja med segmentoma (L–G)", "upper", "L", "G"),
    dist("cl_cc", "Širina razcepa na črti C–C′ (c–c′)", "upper", "cl_c1", "cl_c2"),
    dist("cl_tt", "Širina razcepa na črti T–T′ (t–t′)", "upper", "cl_t1", "cl_t2"),
  ],
};

// Infant, bilateral cleft: premaxilla and lateral segments (Zgojznik et al.).
// The paper reports the wider and the narrower cleft side (W…/N…); the points
// are stored by side, and which side is wider is decided in the analysis.
const INFANT_BCLP_SET: LandmarkSet = {
  id: "intraoral-infant-bclp",
  version: 1,
  draft: false,
  landmarks: [
    lm("I", "I", "Incizalna točka premaksile", "upper"),
    lm("P_r", "P", "Rob premaksile desno", "upper"),
    lm("P_l", "P′", "Rob premaksile levo", "upper"),
    lm("Pm_r", "Pm", "Najbolj izbočena točka premaksile desno", "upper"),
    lm("Pm_l", "Pm′", "Najbolj izbočena točka premaksile levo", "upper"),
    lm("L_r", "L", "Najbolj sprednja točka lateralnega segmenta desno", "upper"),
    lm("L_l", "L′", "Najbolj sprednja točka lateralnega segmenta levo", "upper"),
    lm("Lp_r", "Lp", "Najbolj zadnja točka lateralnega segmenta desno", "upper"),
    lm("Lp_l", "Lp′", "Najbolj zadnja točka lateralnega segmenta levo", "upper"),
    lm("C_r", "C", "Točka podočnjaka desno (mesto izraščanja)", "upper"),
    lm("C_l", "C′", "Točka podočnjaka levo (mesto izraščanja)", "upper"),
    ...ARCH_S,
    ...ARCH_T,
  ],
  measurements: [
    dist("pp", "Širina premaksile (PP)", "upper", "P_r", "P_l"),
    dist("ll", "Sprednja širina loka (LL)", "upper", "L_r", "L_l"),
    M_CC,
    M_TT,
    M_SS,
    dist("pl_r", "Lateralni segment – premaksila desno (PL)", "upper", "L_r", "Pm_r"),
    dist("pl_l", "Lateralni segment – premaksila levo (PL)", "upper", "L_l", "Pm_l"),
    dist("lt_r", "Dolžina lateralnega segmenta desno (LT)", "upper", "L_r", "Lp_r"),
    dist("lt_l", "Dolžina lateralnega segmenta levo (LT)", "upper", "L_l", "Lp_l"),
    toLine("ill", "Protruzija premaksile (ILL, od I pravokotno na LL)", "upper", "I", "L_r", "L_l"),
    toLine("itt", "Od I pravokotno na TT (ITT)", "upper", "I", "T_r", "T_l"),
    { id: "diffrot", label: "Rotacija premaksile (diffrot, glede na TT)", kind: "offsetAngle", points: ["I", "T_r", "T_l"], view: "upper" },
    { id: "dev", label: "Deviacija premaksile (dev, glede na LL)", kind: "offsetAngle", points: ["I", "L_r", "L_l"], view: "upper" },
  ],
};

// ── Intraoral occlusion, both dentitions: overjet and overbite on each upper
// incisor against its lower antagonist, and the midline discrepancy, as signed
// components along the occlusal frame (see occlusalFrame).

function occlusionLists(
  frame: [string, string, string],
  incisors: [string, string][],
  lowerMid: LandmarkDef
): { landmarks: LandmarkDef[]; measurements: MeasurementDef[] } {
  const landmarks: LandmarkDef[] = [];
  const measurements: MeasurementDef[] = [];
  for (const [u, l] of incisors) {
    landmarks.push(
      lm(`o_u${u}`, `${u} i`, `Incizalni rob ${u}`, "occlusion"),
      lm(`o_l${l}_lab`, `${l} lab`, `Labialna ploskev ${l} (nasproti incizalnega roba ${u})`, "occlusion"),
      lm(`o_l${l}`, `${l} i`, `Incizalni rob ${l}`, "occlusion")
    );
  }
  landmarks.push(lowerMid);
  for (const [u, l] of incisors) {
    measurements.push({
      id: `oj_${u}`, label: `Sagitalna stopnica ${u}/${l} (overjet)`, view: "occlusion",
      kind: "component", points: [`o_l${l}_lab`, `o_u${u}`], axis: "anterior", frame,
    });
  }
  for (const [u, l] of incisors) {
    measurements.push({
      id: `ob_${u}`, label: `Incizalni previs ${u}/${l} (overbite)`, view: "occlusion",
      kind: "component", points: [`o_u${u}`, `o_l${l}`], axis: "up", frame,
    });
  }
  measurements.push({
    id: "midline", label: "Zamik središčnic (+ = zgornja v levo)", view: "occlusion",
    kind: "component", points: [lowerMid.id, frame[2]], axis: "left", frame,
  });
  return { landmarks, measurements };
}

const PERM_FRAME: [string, string, string] = ["o_u16", "o_u26", "o_umid"];
const PERM_OCCLUSION = occlusionLists(
  PERM_FRAME,
  [["12", "42"], ["11", "41"], ["21", "31"], ["22", "32"]],
  lm("o_lmid", "SS sp", "Spodnja središčnica (stik 31/41)", "occlusion")
);

// Permanent or mixed dentition. Arch points as before (ids kept from v2);
// the occlusion panel is rebuilt around the occlusal frame (v3).
const PERMANENT_SET: LandmarkSet = {
  id: "intraoral",
  version: 3,
  draft: true,
  landmarks: [
    lm("u13", "13", "Konica podočnjaka 13", "upper"),
    lm("u23", "23", "Konica podočnjaka 23", "upper"),
    lm("u16", "16 mb", "Meziobukalna grbica 16", "upper"),
    lm("u26", "26 mb", "Meziobukalna grbica 26", "upper"),
    lm("u_inc", "UI", "Incizalna točka zgoraj (med 11 in 21)", "upper"),
    lm("l33", "33", "Konica podočnjaka 33", "lower"),
    lm("l43", "43", "Konica podočnjaka 43", "lower"),
    lm("l36", "36 mb", "Meziobukalna grbica 36", "lower"),
    lm("l46", "46 mb", "Meziobukalna grbica 46", "lower"),
    lm("l_inc", "LI", "Incizalna točka spodaj (med 31 in 41)", "lower"),
    // Occlusal frame and molar relation
    lm("o_u16", "16 mb", "Meziobukalna grbica 16 (v okluziji)", "occlusion"),
    lm("o_u26", "26 mb", "Meziobukalna grbica 26 (v okluziji)", "occlusion"),
    lm("o_umid", "SS zg", "Zgornja središčnica (stik 11/21, incizalno)", "occlusion"),
    lm("o_l46", "46 bf", "Bukalna fisura 46 (v okluziji)", "occlusion"),
    lm("o_l36", "36 bf", "Bukalna fisura 36 (v okluziji)", "occlusion"),
    ...PERM_OCCLUSION.landmarks,
  ],
  measurements: [
    dist("u_canine_width", "Širina med podočnjaki zgoraj (13–23)", "upper", "u13", "u23"),
    dist("u_molar_width", "Širina med prvima molarjema zgoraj (16–26)", "upper", "u16", "u26"),
    toLine("u_arch_depth", "Globina loka zgoraj (UI pravokotno na 16–26)", "upper", "u_inc", "u16", "u26"),
    dist("l_canine_width", "Širina med podočnjaki spodaj (33–43)", "lower", "l33", "l43"),
    dist("l_molar_width", "Širina med prvima molarjema spodaj (36–46)", "lower", "l36", "l46"),
    toLine("l_arch_depth", "Globina loka spodaj (LI pravokotno na 36–46)", "lower", "l_inc", "l36", "l46"),
    ...PERM_OCCLUSION.measurements,
    {
      id: "molar_r", label: "Molarni odnos desno (16 mb glede na 46 bf; + = distalni)", view: "occlusion",
      kind: "component", points: ["o_l46", "o_u16"], axis: "anterior", frame: PERM_FRAME,
    },
    {
      id: "molar_l", label: "Molarni odnos levo (26 mb glede na 36 bf; + = distalni)", view: "occlusion",
      kind: "component", points: ["o_l36", "o_u26"], axis: "anterior", frame: PERM_FRAME,
    },
  ],
};

const DEC_FRAME: [string, string, string] = ["o_u55", "o_u65", "o_umid"];
const DEC_OCCLUSION = occlusionLists(
  DEC_FRAME,
  [["52", "82"], ["51", "81"], ["61", "71"], ["62", "72"]],
  lm("o_lmid", "SS sp", "Spodnja središčnica (stik 71/81)", "occlusion")
);

// Primary dentition (Birth to bite, age 5): maxillary arch on teeth, gingiva
// and alveolus. The lower-jaw widths are a working addition.
const DECIDUOUS_SET: LandmarkSet = {
  id: "intraoral-deciduous",
  version: 1,
  draft: true,
  landmarks: [
    ...ARCH_T,
    ...ARCH_S,
    lm("C_r", "C", "Stik 53/54", "upper"),
    lm("C_l", "C′", "Stik 63/64", "upper"),
    ARCH_A,
    lm("d53c", "53 k", "Konica 53", "upper"),
    lm("d63c", "63 k", "Konica 63", "upper"),
    lm("d53g", "53 g", "Najbolj gingivalna palatinalna točka 53", "upper"),
    lm("d63g", "63 g", "Najbolj gingivalna palatinalna točka 63", "upper"),
    lm("d54f", "54 cf", "Centralna fosa 54", "upper"),
    lm("d64f", "64 cf", "Centralna fosa 64", "upper"),
    lm("d54g", "54 g", "Najbolj gingivalna palatinalna točka 54", "upper"),
    lm("d64g", "64 g", "Najbolj gingivalna palatinalna točka 64", "upper"),
    lm("d55f", "55 cf", "Centralna fosa 55", "upper"),
    lm("d65f", "65 cf", "Centralna fosa 65", "upper"),
    lm("d55g", "55 g", "Najbolj gingivalna palatinalna točka 55", "upper"),
    lm("d65g", "65 g", "Najbolj gingivalna palatinalna točka 65", "upper"),
    lm("d55dp", "55 dp", "Distopalatinalna grbica 55", "upper"),
    lm("d65dp", "65 dp", "Distopalatinalna grbica 65", "upper"),
    lm("d_pap", "pap", "Interdentalna papila med 51 in 61", "upper"),
    lm("d83c", "83 k", "Konica 83", "lower"),
    lm("d73c", "73 k", "Konica 73", "lower"),
    lm("d85f", "85 cf", "Centralna fosa 85", "lower"),
    lm("d75f", "75 cf", "Centralna fosa 75", "lower"),
    lm("o_u55", "55 mb", "Meziobukalna grbica 55 (v okluziji)", "occlusion"),
    lm("o_u65", "65 mb", "Meziobukalna grbica 65 (v okluziji)", "occlusion"),
    lm("o_umid", "SS zg", "Zgornja središčnica (stik 51/61, incizalno)", "occlusion"),
    ...DEC_OCCLUSION.landmarks,
  ],
  measurements: [
    M_TT,
    M_SS,
    M_CC,
    M_AX,
    dist("d_iii_cusp", "III–III konici", "upper", "d53c", "d63c"),
    dist("d_iii_ging", "III–III gingivalno", "upper", "d53g", "d63g"),
    dist("d_iv_central", "IV–IV centralni fosi", "upper", "d54f", "d64f"),
    dist("d_iv_ging", "IV–IV gingivalno", "upper", "d54g", "d64g"),
    dist("d_v_central", "V–V centralni fosi", "upper", "d55f", "d65f"),
    dist("d_v_ging", "V–V gingivalno", "upper", "d55g", "d65g"),
    dist("d_v_dpc", "V–V distopalatinalni grbici", "upper", "d55dp", "d65dp"),
    toLine("aal", "Sprednja dolžina loka (AAL, pravokotno na III–III)", "upper", "d_pap", "d53c", "d63c"),
    toLine("tal", "Celotna dolžina loka (TAL, pravokotno na V–V dpc)", "upper", "d_pap", "d55dp", "d65dp"),
    dist("d_l_iii", "Širina med podočnjaki spodaj (83–73)", "lower", "d83c", "d73c"),
    dist("d_l_v", "Širina med drugima molarjema spodaj (85–75)", "lower", "d85f", "d75f"),
    ...DEC_OCCLUSION.measurements,
  ],
};

/** Every list of a scan kind, in the order the workbook columns follow. */
export const LANDMARK_SETS: Record<ScanKind, LandmarkSet[]> = {
  head: [HEAD_SET],
  intraoral: [PERMANENT_SET, DECIDUOUS_SET, INFANT_SET, INFANT_UCLP_SET, INFANT_BCLP_SET],
};

export type DentitionStage = "infant" | "deciduous" | "permanent";
export const DENTITION_STAGES: DentitionStage[] = ["infant", "deciduous", "permanent"];
export const DENTITION_STAGE_LABELS: Record<DentitionStage, string> = {
  infant: "Dojenček (brez zob)",
  deciduous: "Mlečno zobovje",
  permanent: "Stalno ali mešano zobovje",
};

export type CleftType = "none" | "unilateral-right" | "unilateral-left" | "bilateral";
export const CLEFT_TYPES: CleftType[] = ["none", "unilateral-right", "unilateral-left", "bilateral"];
export const CLEFT_LABELS: Record<CleftType, string> = {
  none: "Brez razcepa",
  "unilateral-right": "Enostranski razcep, desno",
  "unilateral-left": "Enostranski razcep, levo",
  bilateral: "Obojestranski razcep",
};

/** The list a record is measured with: by dentition, and for an infant by the cleft. */
export function activeSet(kind: ScanKind, record: Pick<ScanRecord, "stage" | "cleft">): LandmarkSet {
  if (kind === "head") return HEAD_SET;
  switch (record.stage) {
    case "infant":
      return record.cleft === "bilateral"
        ? INFANT_BCLP_SET
        : record.cleft === "none"
          ? INFANT_SET
          : INFANT_UCLP_SET;
    case "deciduous":
      return DECIDUOUS_SET;
    default:
      return PERMANENT_SET;
  }
}

/** Landmarks of all lists of a kind, each id once — the workbook columns. */
export function allLandmarks(kind: ScanKind): LandmarkDef[] {
  return uniqueById(LANDMARK_SETS[kind].flatMap((s) => s.landmarks));
}

export function allMeasurements(kind: ScanKind): MeasurementDef[] {
  return uniqueById(LANDMARK_SETS[kind].flatMap((s) => s.measurements));
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
}

export function landmarkSetTag(set: LandmarkSet): string {
  return `${set.id}@${set.version}`;
}

// ── Defaults and normalisation ───────────────────────────────────

export function makeEmptyScanRecord(kind: ScanKind, stage: DentitionStage = "permanent", cleft: CleftType = "none"): ScanRecord {
  return {
    parts: [],
    unit: "mm",
    unitConfirmed: false,
    landmarkSet: landmarkSetTag(activeSet(kind, { stage, cleft })),
    stage,
    cleft,
    landmarks: {},
    teeth: {},
    snapshots: {},
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
      // Sessions from before the lists existed were measured on permanent teeth
      stage: DENTITION_STAGES.includes(r.stage as DentitionStage) ? (r.stage as DentitionStage) : "permanent",
      cleft: CLEFT_TYPES.includes(r.cleft as CleftType) ? (r.cleft as CleftType) : "none",
      landmarks: r.landmarks && typeof r.landmarks === "object" ? r.landmarks : {},
      teeth: r.teeth && typeof r.teeth === "object" ? r.teeth : {},
      snapshots: r.snapshots && typeof r.snapshots === "object" ? r.snapshots : {},
      note: r.note || "",
    };
  }
  return out;
}

export function hasScanContent(r: ScanRecord): boolean {
  return (
    r.parts.length > 0 ||
    Object.keys(r.landmarks).length > 0 ||
    Object.keys(r.teeth || {}).length > 0 ||
    r.note.trim() !== ""
  );
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

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function unit(a: Vec3): Vec3 | null {
  const n = norm(a);
  return n === 0 ? null : [a[0] / n, a[1] / n, a[2] / n];
}

function midpoint(a: Vec3, b: Vec3): Vec3 {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
}

/** Foot of the perpendicular from `p` onto the line through `a` and `b`; null if a = b. */
export function footOnLine(p: Vec3, a: Vec3, b: Vec3): Vec3 | null {
  const ab = sub(b, a);
  const len2 = dot(ab, ab);
  if (len2 === 0) return null;
  const t = dot(sub(p, a), ab) / len2;
  return [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
}

/**
 * Anatomical axes from three points on the upper arch: a molar on the right,
 * its counterpart on the left, and the incisor midline in front. "left" runs
 * from the right molar to the left one, "up" is the normal of the plane of
 * the three points (towards the skull), "anterior" lies in that plane,
 * square to "left", towards the incisors. Independent of how the scanner
 * oriented the file; null when the points are collinear.
 */
export function occlusalFrame(right: Vec3, left: Vec3, front: Vec3): Record<FrameAxis, Vec3> | null {
  const l = unit(sub(left, right));
  if (!l) return null;
  const forward = sub(front, midpoint(right, left));
  // Patient axes are right-handed: anterior × left = up
  const up = unit(cross(forward, l));
  if (!up) return null;
  return { left: l, up, anterior: cross(l, up) };
}

export interface MeasurementValue {
  def: MeasurementDef;
  /** mm for distances, degrees for angles; null while a landmark is missing. */
  value: number | null;
  unit: "mm" | "°";
}

/** One measurement from its points, in file units (distances) or degrees. */
function measure(def: MeasurementDef, lm: Record<string, Vec3>): number | null {
  const ids = measurementPoints(def);
  if (ids.some((id) => !lm[id])) return null;
  const p = def.points.map((id) => lm[id]);
  switch (def.kind) {
    case "distance":
      return distance(p[0], p[1]);
    case "angle":
      return angleDeg(p[0], p[1], p[2]);
    case "pointLine": {
      const foot = footOnLine(p[0], p[1], p[2]);
      return foot ? distance(p[0], foot) : null;
    }
    case "offsetAngle": {
      const foot = footOnLine(p[0], p[1], p[2]);
      if (!foot) return null;
      // Point on the line itself: no perpendicular to compare against
      if (distance(p[0], foot) === 0) return null;
      return angleDeg(foot, p[0], midpoint(p[1], p[2]));
    }
    case "component": {
      const f = def.frame.map((id) => lm[id]);
      const frame = occlusalFrame(f[0], f[1], f[2]);
      return frame ? dot(sub(p[1], p[0]), frame[def.axis]) : null;
    }
  }
}

/** Every measurement of the record's landmark list, computed from its landmarks. */
export function computeMeasurements(kind: ScanKind, record: ScanRecord, defs?: MeasurementDef[]): MeasurementValue[] {
  const scale = SCAN_UNIT_TO_MM[record.unit] || 1;
  return (defs || activeSet(kind, record).measurements).map((def) => {
    const u = measurementUnit(def);
    const v = measure(def, record.landmarks);
    return { def, value: v === null ? null : round2(u === "mm" ? v * scale : v), unit: u };
  });
}

/**
 * What to draw for a measurement: the measured line, plus the reference line
 * and the perpendicular where there is one. Null while a point is missing.
 */
export function measurementSegments(def: MeasurementDef, lm: Record<string, Vec3>): [Vec3, Vec3][] | null {
  if (measurementPoints(def).some((id) => !lm[id])) return null;
  const p = def.points.map((id) => lm[id]);
  switch (def.kind) {
    case "distance":
    case "component":
      return [[p[0], p[1]]];
    case "angle":
      return [[p[0], p[1]], [p[1], p[2]]];
    case "pointLine": {
      const foot = footOnLine(p[0], p[1], p[2]);
      return foot ? [[p[0], foot], [p[1], p[2]]] : [[p[1], p[2]]];
    }
    case "offsetAngle": {
      const foot = footOnLine(p[0], p[1], p[2]);
      const segs: [Vec3, Vec3][] = [[p[1], p[2]], [p[0], midpoint(p[1], p[2])]];
      if (foot) segs.push([p[0], foot]);
      return segs;
    }
  }
}

/**
 * Colour of the n-th of `count` measurements: blue for the first, red for the
 * last, through the hues between, so neighbouring lines stay distinguishable.
 * A CSS colour string, understood by three.js as well.
 */
export function measurementColor(index: number, count: number): string {
  const t = count > 1 ? index / (count - 1) : 0;
  return `hsl(${Math.round(220 * (1 - t))}, 85%, 45%)`;
}

// ── Tooth labels ─────────────────────────────────────────────────

/**
 * FDI numbers in the order they are labelled, from the patient's right to
 * left — the order they appear on screen in the jaw panels.
 */
export const TOOTH_ROWS: { id: string; label: string; jaw: "upper" | "lower"; teeth: string[] }[] = [
  { id: "up", label: "Stalni zgoraj", jaw: "upper", teeth: ["18", "17", "16", "15", "14", "13", "12", "11", "21", "22", "23", "24", "25", "26", "27", "28"] },
  { id: "ud", label: "Mlečni zgoraj", jaw: "upper", teeth: ["55", "54", "53", "52", "51", "61", "62", "63", "64", "65"] },
  { id: "lp", label: "Stalni spodaj", jaw: "lower", teeth: ["48", "47", "46", "45", "44", "43", "42", "41", "31", "32", "33", "34", "35", "36", "37", "38"] },
  { id: "ld", label: "Mlečni spodaj", jaw: "lower", teeth: ["85", "84", "83", "82", "81", "71", "72", "73", "74", "75"] },
];

export function toothJaw(fdi: string): "upper" | "lower" {
  return "1256".includes(fdi[0]) ? "upper" : "lower";
}

/**
 * Tooth rows offered, and labels shown, in a panel: none for an infant, the
 * primary rows first for a primary dentition.
 */
export function toothRowsInView(view: ScanView, stage: DentitionStage): typeof TOOTH_ROWS {
  if (stage === "infant" || view === "head") return [];
  const rows = stage === "deciduous" ? [TOOTH_ROWS[1], TOOTH_ROWS[0], TOOTH_ROWS[3], TOOTH_ROWS[2]] : TOOTH_ROWS;
  return view === "occlusion" ? rows : rows.filter((r) => r.jaw === view);
}

/** Workbook cell form: "11:1.2,3.4,5.6;12:…". */
export function encodeTeeth(teeth: Record<string, Vec3>): string {
  return Object.keys(teeth)
    .sort()
    .map((fdi) => `${fdi}:${teeth[fdi].join(",")}`)
    .join(";");
}

export function decodeTeeth(text: string): Record<string, Vec3> {
  const out: Record<string, Vec3> = {};
  for (const item of (text || "").split(";")) {
    const [fdi, coords] = item.split(":");
    if (!fdi || !coords) continue;
    const v = coords.split(",").map(Number);
    if (v.length === 3 && v.every((x) => Number.isFinite(x))) out[fdi.trim()] = v as Vec3;
  }
  return out;
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

export function landmarksInView(set: LandmarkSet, view: ScanView): LandmarkDef[] {
  return set.landmarks.filter((l) => l.view === view);
}

/** Panels worth showing: those with points to place or teeth to label. */
export function viewsFor(kind: ScanKind, record: ScanRecord): ScanView[] {
  const set = activeSet(kind, record);
  return SCAN_VIEWS[kind].filter(
    (v) => landmarksInView(set, v).length > 0 || toothRowsInView(v, record.stage).length > 0
  );
}
