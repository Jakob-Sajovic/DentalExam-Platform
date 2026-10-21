import { FdiToothNumber, SpecialCaseCode, ProbingSite, LegacyRadiographSlotId, RadiographJaw } from "./types";

// Schema version for data persistence
export const SCHEMA_VERSION = 2;

// FDI tooth numbers by quadrant (used for chart layout)
export const UPPER_RIGHT: FdiToothNumber[] = [18, 17, 16, 15, 14, 13, 12, 11];
export const UPPER_LEFT: FdiToothNumber[] = [21, 22, 23, 24, 25, 26, 27, 28];
export const LOWER_LEFT: FdiToothNumber[] = [38, 37, 36, 35, 34, 33, 32, 31];
export const LOWER_RIGHT: FdiToothNumber[] = [41, 42, 43, 44, 45, 46, 47, 48];

// All 32 teeth in chart display order (upper row L→R, lower row L→R)
export const ALL_TEETH: FdiToothNumber[] = [
  ...UPPER_RIGHT, ...UPPER_LEFT,
  ...LOWER_LEFT, ...LOWER_RIGHT,
];

// Lower jaw mirrored: 48→41, 31→38 (used in probing and ICDAS tabs)
export const LOWER_JAW_MIRRORED: FdiToothNumber[] = [
  48, 47, 46, 45, 44, 43, 42, 41,
  31, 32, 33, 34, 35, 36, 37, 38,
];

// ICDAS restoration/surface status codes (Slovenian labels)
export const RESTORATION_LABELS: Record<number, string> = {
  0: "površina zoba, ki ni restavrirana ali zalita",
  1: "površina zoba z delnim zalitjem fisur",
  2: "površina zoba z zalitjem fisur",
  3: "površina zoba s plombo v barvi zoba",
  4: "površina zoba z amalgamsko plombo",
  5: "polnokovinska prevleka",
  6: "luska, porcelanska / kovinsko-porcelanska / zlata prevleka",
  7: "površina zoba z izpadlo ali poškodovano plombo",
  8: "površina zoba z začasno plombo",
};

// ICDAS caries assessment codes (Slovenian labels)
export const CARIES_LABELS: Record<number, string> = {
  0: "zdrava površina zoba",
  1: "površina s prvimi vidnimi spremembami v sklenini",
  2: "kariozna sprememba vidna na neosušeni sklenini",
  3: "kariozna kavitacija v sklenini, dentin ni viden",
  4: "temno zabarvan dentin pod sklenino",
  5: "očitna kaviteta z razgaljenim dentinom",
  6: "obsežna kaviteta z vidnim dentinom",
};

// ICDAS special case codes (Slovenian labels)
export const SPECIAL_CASE_LABELS: Record<SpecialCaseCode, string> = {
  "60": "popolna prevleka",
  "90": "zobni vsadek po izgubi zoba, ki ni povezana s kariesom",
  "91": "zobni vsadek po izgubi zoba zaradi kariesa",
  "92": "protetični člen po izgubi zoba, ki ni povezana s kariesom",
  "93": "protetični člen po izgubi zoba zaradi kariesa",
  "96": "površina zoba, ki je ni mogoče pregledati",
  "97": "zaradi kariesa manjkajoči zob",
  "98": "manjkajoči zob zaradi vzroka, ki ni povezan s kariesom",
  "99": "zob ni izrasel",
  "06": "zaostala korenina",
};

// OHIP-49 domains (Slovenian)
export interface OhipDomain {
  name: string;
  startItem: number; // 1-based
  endItem: number;   // 1-based, inclusive
}

export const OHIP_DOMAINS: OhipDomain[] = [
  { name: "Splošna okrnjenost", startItem: 1, endItem: 9 },
  { name: "Bolečina", startItem: 10, endItem: 18 },
  { name: "Psihološko nelagodje", startItem: 19, endItem: 23 },
  { name: "Fizična oviranost", startItem: 24, endItem: 32 },
  { name: "Psihološka oviranost", startItem: 33, endItem: 38 },
  { name: "Družbena oviranost", startItem: 39, endItem: 43 },
  { name: "Invalidnost", startItem: 44, endItem: 49 },
];

// OHIP-49 item wording (Slovenian), index 0 = item 1. Kept verbatim from the
// paper questionnaire the subject fills in.
export const OHIP_QUESTIONS: string[] = [
  "Ali imate zaradi problemov z zobmi, ustno votlino ali zobnimi nadomestki kdaj težave z žvečenjem hrane?",
  "Ali imate zaradi problemov z zobmi, ustno votlino ali zobnimi nadomestki kdaj težave z izgovorjavo?",
  "Ali ste opazili, da kakšen vaš zob ni videti v redu?",
  "Ali menite, da je zaradi težav z zobmi, ustno votlino ali zobnimi nadomestki prizadet vaš videz?",
  "Ali imate zaradi težav v zobmi, ustno votlino ali zobnimi nadomestki slab zadah?",
  "Ali se vam zdi, da se je zaradi težav z zobmi, ustno votlino ali zobnimi nadomestki poslabšal vaš čut za okus?",
  "Ali se vam hrana zatika med zobe ali zobne nadomestke?",
  "Ali opažate, da se vam je zaradi težav z zobmi, ustno votlino ali zobnimi nadomestki poslabšala prebava?",
  "Ali občutite, da se vam zobni nadomestki ne prilegajo dobro?",
  "Ali kdaj občutite v ustni votlini hudo bolečino?",
  "Ali vas kdaj boli čeljust?",
  "Ali imate zaradi težav z zobmi, ustno votlino ali zobnimi nadomestki glavobole?",
  "Ali so vaši zobje občutljivi na vročo ali mrzlo hrano oziroma pijačo?",
  "Ali vas kdaj bolijo zobje?",
  "Ali vas kdaj bolijo dlesni?",
  "Ali zaradi težav z zobmi, ustno votlino ali zobnimi nadomestki težko jeste kakšno hrano?",
  "Ali imate kdaj v ustni votlini kakšna boleča mesta?",
  "Ali vas zobni nadomestki tiščijo?",
  "Ali ste zaskrbljeni zaradi težav z zobmi?",
  "Ali ste kdaj razmišljali o vaših zobeh, ustih ali zobnih nadomestkih?",
  "Ali ste zaradi težav z zobmi postali nesrečni?",
  "Ali se neprijetno počutite zaradi izgleda vaših zob, ust ali zobnih nadomestkov?",
  "Ali ste zaradi težav z zobmi, ustno votlino ali zobnimi nadomestki kdaj napeti?",
  "Ali zaradi težav z zobmi, ustno votlino ali zobnimi nadomestki nerazločno govorite?",
  "Ali zaradi vaših težav z zobmi, ustno votlino ali zobnimi nadomestki ljudje kdaj napačno razumejo kakšne vaše besede?",
  "Ali čutite, da je zaradi vaših težav z zobmi, ustno votlino ali zobnimi nadomestki hrana manj okusna?",
  "Ali si zaradi težav z zobmi, ustno votlino ali zobnimi nadomestki ne morete dobro umiti zob?",
  "Ali se morate zaradi težav zobmi, ustno votlino ali zobnimi nadomestki odreči kakšni hrani?",
  "Ali je zaradi težav z zobmi, ustno votlino ali zobnimi nadomestki vaša prehrana premalo raznovrstna?",
  "Ali imate težave z zobnimi nadomestki in zaradi tega z njimi ne morete jesti?",
  "Ali se zaradi težav z zobmi, ustno votlino ali zobnimi nadomestki raje ne nasmihate?",
  "Ali morate zaradi težav z zobmi, ustno votlino ali zobnimi nadomestki kdaj prekiniti obrok?",
  "Ali se zaradi težav z zobmi, ustno votlino ali zobnimi nadomestki ponoči zbujate?",
  "Ali ste zaradi težav z zobmi, ustno votlino ali zobnimi nadomestki vznemirjeni?",
  "Ali se zaradi težav z zobmi, ustno votlino ali zobnimi nadomestki težko sprostite?",
  "Ali ste zaradi težav z zobmi, ustno votlino ali zobnimi nadomestki depresivni?",
  "Ali je zaradi težav z zobmi, ustno votlino ali zobnimi nadomestki prizadeta vaša koncentracija?",
  "Ali vam je zaradi težav z zobmi, ustno votlino ali zobnimi nadomestki kdaj nerodno?",
  "Ali se zaradi težav z zobmi, ustno votlino ali zobnimi nadomestki izogibate iti v družbo?",
  "Ali ste zaradi vaših težav z zobmi, ustno votlino ali zobnimi nadomestki postali manj strpni do soproga/soproge ali bližnjih?",
  "Ali se zaradi težav z zobmi, ustno votlino ali zobnimi nadomestki slabše razumete z drugimi ljudmi?",
  "Ali ste zaradi težav z zobmi, ustno votlino ali zobnimi nadomestki kdaj razdražljivi v odnosu do drugih ljudi?",
  "Ali zaradi težav z zobmi, ustno votlino ali zobnimi nadomestki težje opravljate svoja običajna opravila?",
  "Ali se vam zdi, da se je zaradi težav z zobmi, ustno votlino ali zobnimi nadomestki poslabšalo vaše splošno zdravstveno stanje?",
  "Ali ste zaradi težav z zobmi, ustno votlino ali zobnimi nadomestki utrpeli kakršnokoli finančno izgubo?",
  "Ali zaradi težav z zobmi, ustno votlino ali zobnimi nadomestki ne morete uživati v družbi drugih ljudi tako kot prej?",
  "Ali se vam zdi, da vam zaradi vaših težav z zobmi, ustno votlino ali zobnimi nadomestki življenje na splošno nudi manj zadovoljstva?",
  "Ali ste zaradi problemov z zobmi, ustno votlino ali zobnimi nadomestki popolnoma nesposobni funkcionirati?",
  "Ali zaradi problemov z zobmi, ustno votlino ali zobnimi nadomestki ne morete dati vsega od sebe pri svojem delu?",
];

// One-word self-ratings asked before item 1
export const OHIP_HEALTH_RATING_QUESTION =
  "Kako bi z eno besedo ocenili zdravstveno stanje vašega zobovja in obzobnih tkiv (=dlesni)?";
export const OHIP_APPEARANCE_RATING_QUESTION =
  "Kako bi z eno besedo ocenili izgled vašega zobovja?";

// Closing free-text item and thank-you line
export const OHIP_COMMENT_QUESTION = "Ali nam želite še kaj sporočiti?";
export const OHIP_CLOSING_TEXT =
  "Hvala za vaš čas, ki ste nam ga namenili, pri izpolnjevanju vprašalnika.";

// OHIP Likert scale labels (Slovenian)
export const OHIP_LIKERT_LABELS: Record<number, string> = {
  0: "Nikoli",
  1: "Skoraj nikoli",
  2: "Občasno",
  3: "Pogosto",
  4: "Zelo pogosto",
};

// Tab definitions for UI
export interface TabDefinition {
  id: string;
  label: string;
  icon: string; // emoji or symbol
  pwaOnly?: boolean; // hidden in the Excel task pane (too narrow, no file storage)
}

export const TABS: TabDefinition[] = [
  { id: "landing", label: "Začetek", icon: "🏠" },
  { id: "patient", label: "Preiskovanec", icon: "👤" },
  { id: "plaque-bleeding", label: "VPI/GBI", icon: "🦷" },
  { id: "icdas", label: "ICDAS", icon: "🔍" },
  { id: "fillings", label: "Zalivke", icon: "⬜" },
  { id: "probing", label: "Globine", icon: "📏" },
  { id: "radiographs", label: "RTG", icon: "🩻" },
  { id: "scans3d", label: "3D", icon: "📐", pwaOnly: true },
  { id: "notes", label: "Opombe", icon: "📝" },
  { id: "ohip", label: "OHIP", icon: "📋" },
  { id: "fdi", label: "FDI", icon: "📊" },
  { id: "save-report", label: "Shrani", icon: "💾" },
];

// Plaque/bleeding surface labels (Slovenian)
export const PB_SURFACE_LABELS: Record<string, string> = {
  mesial: "M",
  distal: "D",
  buccal: "V",
  lingual: "O",
};

// Plaque/bleeding surface full names for tooltips (Slovenian)
export const PB_SURFACE_TOOLTIPS: Record<string, string> = {
  mesial: "Mezialno",
  distal: "Distalno",
  buccal: "Vestibularno",
  lingual: "Oralno",
};

// ICDAS surface labels — short (Slovenian)
export const ICDAS_SURFACE_LABELS: Record<string, string> = {
  mesial: "M",
  distal: "D",
  buccal: "V",
  lingual: "O",
  occlusal: "Ok",
};

// ICDAS surface full names (Slovenian)
export const ICDAS_SURFACE_FULL_NAMES: Record<string, string> = {
  mesial: "Mezialno",
  distal: "Distalno",
  buccal: "Vestibularno",
  lingual: "Oralno",
  occlusal: "Okluzalno",
};

// Probing depth constants
export const PROBING_BUCCAL_SITES: ProbingSite[] = ["distoBuccal", "buccal", "mesioBuccal"];
export const PROBING_LINGUAL_SITES: ProbingSite[] = ["distoLingual", "lingual", "mesioLingual"];
export const PROBING_ALL_SITES: ProbingSite[] = [
  "distoBuccal", "buccal", "mesioBuccal",
  "distoLingual", "lingual", "mesioLingual",
];
export const PROBING_SITE_LABELS: Record<ProbingSite, string> = {
  distoBuccal: "Disto-bukalno", buccal: "Bukalno", mesioBuccal: "Mezio-bukalno",
  distoLingual: "Disto-lingvalno", lingual: "Lingvalno", mesioLingual: "Mezio-lingvalno",
};

// Reversed site arrays for per-quadrant visual reordering
export const PROBING_BUCCAL_SITES_REVERSED: ProbingSite[] = ["mesioBuccal", "buccal", "distoBuccal"];
export const PROBING_LINGUAL_SITES_REVERSED: ProbingSite[] = ["mesioLingual", "lingual", "distoLingual"];

/**
 * Get the visual (left-to-right) site order for a given tooth and side.
 * Only specified rows are reordered; the rest keep the default order.
 *
 * Reordered rows:
 *  - Teeth 21–28 and 41–48, buccal: mB, B, dB (reversed)
 *  - Teeth 11–18 and 31–38, lingual: mL, L, dL (reversed)
 */
/** Quadrant 1–4; primary quadrants 5–8 fold onto them (same as dentition.quadrantOf). */
function foldQuadrant(tooth: number): number {
  const q = Math.floor(tooth / 10);
  return q > 4 ? q - 4 : q;
}

export function getVisualBuccalSites(tooth: FdiToothNumber): ProbingSite[] {
  const q = foldQuadrant(tooth);
  // Q2 (21-28) and Q4 (41-48) buccal → reversed
  if (q === 2 || q === 4) return PROBING_BUCCAL_SITES_REVERSED;
  return PROBING_BUCCAL_SITES;
}

export function getVisualLingualSites(tooth: FdiToothNumber): ProbingSite[] {
  const q = foldQuadrant(tooth);
  // Q1 (11-18) and Q3 (31-38) lingual → reversed
  if (q === 1 || q === 3) return PROBING_LINGUAL_SITES_REVERSED;
  return PROBING_LINGUAL_SITES;
}

export const FURCATION_GRADES: { value: number; label: string }[] = [
  { value: 0, label: "0 — Brez prizadetosti" },
  { value: 1, label: "1 — Začetna izguba" },
  { value: 2, label: "2 — Delna prizadetost" },
  { value: 3, label: "3 — Popolna prizadetost" },
];
export const PROBING_DEPTH_COLORS = [
  { max: 3, color: "#4caf50" },   // green — healthy
  { max: 4, color: "#ffc107" },   // yellow — mild
  { max: 5, color: "#ff9800" },   // orange — moderate
  { max: Infinity, color: "#f44336" }, // red — severe >= 6mm
];

// Root caries — measured teeth and entry counts
export const ROOT_CARIES_UPPER_TEETH: FdiToothNumber[] = [18, 17, 16, 26, 27, 28];
export const ROOT_CARIES_LOWER_TEETH: FdiToothNumber[] = [38, 37, 36, 46, 47, 48];
export const ROOT_CARIES_ALL_TEETH: FdiToothNumber[] = [...ROOT_CARIES_UPPER_TEETH, ...ROOT_CARIES_LOWER_TEETH];
export const ROOT_CARIES_UPPER_ENTRIES = 3; // MB, P, DB roots
export const ROOT_CARIES_LOWER_ENTRIES = 2; // M, D roots
export const ROOT_CARIES_UPPER_LABELS = ["Bukalno", "Meziopalatinalno", "Distopalatinalno"];
export const ROOT_CARIES_LOWER_LABELS = ["Bukalno", "Lingvalno"];
export function rootCariesEntryCount(tooth: FdiToothNumber): number {
  if (ROOT_CARIES_UPPER_TEETH.includes(tooth)) return ROOT_CARIES_UPPER_ENTRIES;
  if (ROOT_CARIES_LOWER_TEETH.includes(tooth)) return ROOT_CARIES_LOWER_ENTRIES;
  return 0;
}
export function rootCariesLabels(tooth: FdiToothNumber): string[] {
  if (ROOT_CARIES_UPPER_TEETH.includes(tooth)) return ROOT_CARIES_UPPER_LABELS;
  if (ROOT_CARIES_LOWER_TEETH.includes(tooth)) return ROOT_CARIES_LOWER_LABELS;
  return [];
}

// ── Radiographs ──────────────────────────────────────────────────
// Teeth offered by a figure's location picker, in the order they appear on
// the mount: viewer's left = patient's right.
export const RADIOGRAPH_JAW_TEETH: Record<RadiographJaw, FdiToothNumber[]> = {
  upper: [...UPPER_RIGHT, ...UPPER_LEFT],
  lower: [...LOWER_JAW_MIRRORED],
};

export const RADIOGRAPH_JAW_LABELS: Record<RadiographJaw, string> = {
  upper: "Zgornja čeljust",
  lower: "Spodnja čeljust",
};

// Short prefix used to number figures: Z1, Z2 … / S1, S2 …
export const RADIOGRAPH_JAW_PREFIX: Record<RadiographJaw, string> = {
  upper: "Z",
  lower: "S",
};

// The fixed 10-film mount used before the composite/partial modes, with the
// teeth each film covered. Used only to migrate sessions saved with it.
export interface LegacyRadiographSlotDef {
  id: LegacyRadiographSlotId;
  jaw: RadiographJaw;
  from: FdiToothNumber;
  to: FdiToothNumber;
}

export const LEGACY_RADIOGRAPH_SLOTS: LegacyRadiographSlotDef[] = [
  { id: "T1", jaw: "upper", from: 18, to: 16 },
  { id: "T2", jaw: "upper", from: 15, to: 13 },
  { id: "T3", jaw: "upper", from: 12, to: 22 },
  { id: "T4", jaw: "upper", from: 23, to: 25 },
  { id: "T5", jaw: "upper", from: 26, to: 28 },
  { id: "B1", jaw: "lower", from: 48, to: 46 },
  { id: "B2", jaw: "lower", from: 45, to: 43 },
  { id: "B3", jaw: "lower", from: 42, to: 32 },
  { id: "B4", jaw: "lower", from: 33, to: 35 },
  { id: "B5", jaw: "lower", from: 36, to: 38 },
];

// Client-side compression applied before an image enters the session.
export const RADIOGRAPH_MAX_DIMENSION = 1400; // px on the longest edge, partial films
export const RADIOGRAPH_COMPOSITE_MAX_DIMENSION = 2800; // a whole-mouth scan needs more detail
export const RADIOGRAPH_JPEG_QUALITY = 0.82;
