import {
  ExaminationSession,
  ExaminerData,
  FdiToothNumber,
  FdiQuestionnaireData,
  PlaqueData,
  BleedingData,
  ICDASData,
  ICDASToothData,
  PBToothData,
  ProbingData,
  ProbingToothData,
  ProbingSite,
  RootCariesData,
  BOPData,
  BOPToothData,
  FurcationScore,
  FurcationInvolvementData,
  ICDASRootCariesData,
  ICDASRootCariesToothData,
  PatientData,
  OhipData,
  OhipExtraData,
  NotesData,
  RadiographData,
  SpecialCaseCode,
} from "./types";
import { makeDefaultRadiographs as createDefaultRadiographs, normalizeRadiographs } from "./radiographs";
import { ALL_TEETH, SCHEMA_VERSION, ROOT_CARIES_ALL_TEETH, PROBING_ALL_SITES, rootCariesEntryCount } from "./constants";
import { isImplantCode } from "./tooth-status";
import { Scans3DData, makeDefaultScans3D, normalizeScans3D } from "./scans3d";

type ChangeListener = () => void;

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

function createDefaultPBTooth(): PBToothData {
  return { present: true, mesial: false, distal: false, buccal: false, lingual: false };
}

function createDefaultICDASTooth(): ICDASToothData {
  return {
    status: "normal",
    specialCode: null,
    surfaces: {
      mesial: { restoration: null, caries: null },
      distal: { restoration: null, caries: null },
      buccal: { restoration: null, caries: null },
      lingual: { restoration: null, caries: null },
      occlusal: { restoration: null, caries: null },
    },
  };
}

function createDefaultPBData(): PlaqueData {
  const data: Partial<PlaqueData> = {};
  for (const tooth of ALL_TEETH) {
    data[tooth] = createDefaultPBTooth();
  }
  return data as PlaqueData;
}

function createDefaultProbingTooth(): ProbingToothData {
  return {
    present: true,
    distoBuccal: null, buccal: null, mesioBuccal: null,
    distoLingual: null, lingual: null, mesioLingual: null,
    furcation: null,
  };
}

function createDefaultProbingData(): ProbingData {
  const data: Partial<ProbingData> = {};
  for (const tooth of ALL_TEETH) {
    data[tooth] = createDefaultProbingTooth();
  }
  return data as ProbingData;
}

export function makeDefaultProbingData(): ProbingData {
  return createDefaultProbingData();
}

function createDefaultRootCariesData(): RootCariesData {
  const data: RootCariesData = {};
  for (const tooth of ROOT_CARIES_ALL_TEETH) {
    const count = rootCariesEntryCount(tooth);
    data[tooth] = new Array(count).fill(null);
  }
  return data;
}

export function makeDefaultRootCariesData(): RootCariesData {
  return createDefaultRootCariesData();
}

function createDefaultBOPTooth(): BOPToothData {
  return {
    distoBuccal: false, buccal: false, mesioBuccal: false,
    distoLingual: false, lingual: false, mesioLingual: false,
  };
}

function createDefaultBOPData(): BOPData {
  const data: Partial<BOPData> = {};
  for (const tooth of ALL_TEETH) {
    data[tooth] = createDefaultBOPTooth();
  }
  return data as BOPData;
}

export function makeDefaultBOPData(): BOPData {
  return createDefaultBOPData();
}

function createDefaultFurcationInvolvementData(): FurcationInvolvementData {
  const data: FurcationInvolvementData = {};
  for (const tooth of ROOT_CARIES_ALL_TEETH) {
    const count = rootCariesEntryCount(tooth);
    data[tooth] = new Array(count).fill(0) as FurcationScore[];
  }
  return data;
}

export function makeDefaultFurcationInvolvementData(): FurcationInvolvementData {
  return createDefaultFurcationInvolvementData();
}

function createDefaultICDASRootCariesTooth(): ICDASRootCariesToothData {
  return {
    distoBuccal: 0, buccal: 0, mesioBuccal: 0,
    distoLingual: 0, lingual: 0, mesioLingual: 0,
  };
}

function createDefaultICDASRootCariesData(): ICDASRootCariesData {
  const data: Partial<ICDASRootCariesData> = {};
  for (const tooth of ALL_TEETH) {
    data[tooth] = createDefaultICDASRootCariesTooth();
  }
  return data as ICDASRootCariesData;
}

export function makeDefaultICDASRootCariesData(): ICDASRootCariesData {
  return createDefaultICDASRootCariesData();
}

function createDefaultICDASData(): ICDASData {
  const data: Partial<ICDASData> = {};
  for (const tooth of ALL_TEETH) {
    data[tooth] = createDefaultICDASTooth();
  }
  return data as ICDASData;
}

function createDefaultFdiQuestionnaire(): FdiQuestionnaireData {
  return {
    gender: null, age: null, smoking: null, diabetes: null,
    toothLoss: null, plaque: null, bleeding: null, probingDepth: null,
    country: "",
  };
}

export function makeDefaultFdiQuestionnaire(): FdiQuestionnaireData {
  return createDefaultFdiQuestionnaire();
}

export function makeDefaultOhipExtra(): OhipExtraData {
  return { healthRating: "", appearanceRating: "", comment: "" };
}

export function makeDefaultRadiographs(): RadiographData {
  return createDefaultRadiographs();
}

function createBlankSession(): ExaminationSession {
  const now = new Date().toISOString();
  return {
    sessionId: generateId(),
    schemaVersion: SCHEMA_VERSION,
    createdAt: now,
    modifiedAt: now,
    patient: { date: new Date().toISOString().split("T")[0], firstName: "", lastName: "", code: "", checkup: 1 },
    examiner: { firstName: "", lastName: "" },
    plaque: createDefaultPBData(),
    bleeding: createDefaultPBData(),
    icdas: createDefaultICDASData(),
    probing: createDefaultProbingData(),
    rootCaries: createDefaultRootCariesData(),
    bop: createDefaultBOPData(),
    furcationInvolvement: createDefaultFurcationInvolvementData(),
    icdasRootCaries: createDefaultICDASRootCariesData(),
    notes: { diagnosticNotes: "", qualitativeNotes: "" },
    radiographs: createDefaultRadiographs(),
    ohip: new Array(49).fill(null) as OhipData,
    ohipExtra: makeDefaultOhipExtra(),
    fdiQuestionnaire: createDefaultFdiQuestionnaire(),
    scans3d: makeDefaultScans3D(),
  };
}

export class SessionState {
  private static instance: SessionState | null = null;

  private session: ExaminationSession | null = null;
  private listeners: ChangeListener[] = [];
  // VPI/GBI surfaces cleared when a tooth was marked missing, kept so that
  // choosing an implant code (90/91) afterwards brings them back. Entry order
  // on the ICDAS tab is "Poseben primer" (defaults to 97, clears) then the code.
  private clearedPB: Partial<Record<FdiToothNumber, { plaque: PBToothData; bleeding: PBToothData }>> = {};

  private constructor() {}

  static getInstance(): SessionState {
    if (!SessionState.instance) {
      SessionState.instance = new SessionState();
    }
    return SessionState.instance;
  }

  // Create a new blank session
  newSession(): ExaminationSession {
    this.session = createBlankSession();
    this.clearedPB = {};
    this.notifyListeners();
    return this.session;
  }

  // Load an existing session (e.g. from Excel)
  loadSession(data: ExaminationSession): void {
    this.session = data;
    this.clearedPB = {};
    this.notifyListeners();
  }

  // Reset to no active session
  resetSession(): void {
    this.session = null;
    this.clearedPB = {};
    this.notifyListeners();
  }

  // Check if a session is active
  hasSession(): boolean {
    return this.session !== null;
  }

  // Get the full session (throws if none)
  getSession(): ExaminationSession {
    if (!this.session) {
      throw new Error("No active session");
    }
    return this.session;
  }

  // Convenience accessors
  getPatient(): PatientData {
    return this.getSession().patient;
  }

  getExaminer(): ExaminerData {
    return this.getSession().examiner;
  }

  getPlaque(): PlaqueData {
    return this.getSession().plaque;
  }

  getBleeding(): BleedingData {
    return this.getSession().bleeding;
  }

  getIcdas(): ICDASData {
    return this.getSession().icdas;
  }

  getProbing(): ProbingData {
    return this.getSession().probing;
  }

  getRootCaries(): RootCariesData {
    return this.getSession().rootCaries;
  }

  getBop(): BOPData {
    return this.getSession().bop;
  }

  getFurcationInvolvement(): FurcationInvolvementData {
    return this.getSession().furcationInvolvement;
  }

  getICDASRootCaries(): ICDASRootCariesData {
    return this.getSession().icdasRootCaries;
  }

  getNotes(): NotesData {
    return this.getSession().notes;
  }

  getRadiographs(): RadiographData {
    const s = this.getSession();
    // Also upgrades sessions restored from local storage in an older shape
    s.radiographs = normalizeRadiographs(s.radiographs);
    return s.radiographs;
  }

  getOhip(): OhipData {
    return this.getSession().ohip;
  }

  getOhipExtra(): OhipExtraData {
    const s = this.getSession();
    if (!s.ohipExtra) s.ohipExtra = makeDefaultOhipExtra();
    return s.ohipExtra;
  }

  getFdiQuestionnaire(): FdiQuestionnaireData {
    return this.getSession().fdiQuestionnaire;
  }

  getScans3D(): Scans3DData {
    const s = this.getSession();
    // Sessions saved before the 3D tab existed have no scans3d at all. Only
    // replaced when incomplete, so callers may hold on to the records.
    if (!s.scans3d || !s.scans3d.head || !s.scans3d.intraoral) s.scans3d = normalizeScans3D(s.scans3d);
    return s.scans3d;
  }

  // Sync tooth presence across all tabs (plaque, bleeding, icdas, probing)
  setToothPresence(tooth: FdiToothNumber, present: boolean): void {
    const s = this.getSession();

    // Remember the VPI/GBI surfaces being cleared (restored by setToothImplant)
    if (!present && s.plaque[tooth].present) {
      this.clearedPB[tooth] = { plaque: { ...s.plaque[tooth] }, bleeding: { ...s.bleeding[tooth] } };
    } else if (present) {
      delete this.clearedPB[tooth];
    }

    // Plaque
    s.plaque[tooth].present = present;
    if (!present) {
      s.plaque[tooth].mesial = false;
      s.plaque[tooth].distal = false;
      s.plaque[tooth].buccal = false;
      s.plaque[tooth].lingual = false;
    }

    // Bleeding
    s.bleeding[tooth].present = present;
    if (!present) {
      s.bleeding[tooth].mesial = false;
      s.bleeding[tooth].distal = false;
      s.bleeding[tooth].buccal = false;
      s.bleeding[tooth].lingual = false;
    }

    // Probing
    s.probing[tooth].present = present;
    if (!present) {
      for (const site of PROBING_ALL_SITES) {
        s.probing[tooth][site as ProbingSite] = null;
      }
      s.probing[tooth].furcation = null;
    }

    // BOP
    if (s.bop && s.bop[tooth]) {
      if (!present) {
        for (const site of PROBING_ALL_SITES) {
          (s.bop[tooth] as Record<string, boolean>)[site] = false;
        }
      }
    }

    // Furcation involvement — null when missing, 0 when becoming present
    if (s.furcationInvolvement) {
      const fiData = s.furcationInvolvement[tooth];
      if (fiData) {
        for (let i = 0; i < fiData.length; i++) fiData[i] = present ? 0 : null;
      }
    }

    // ICDAS root caries — null when missing/special, 0 when becoming present/normal
    if (s.icdasRootCaries && s.icdasRootCaries[tooth]) {
      const val = present ? 0 : null;
      for (const site of PROBING_ALL_SITES) {
        (s.icdasRootCaries[tooth] as Record<string, number | null>)[site] = val;
      }
    }

    // ICDAS — a tooth marked missing from another tab becomes a plain missing
    // tooth (97) unless it already carries a non-implant special code.
    if (!present) {
      s.icdas[tooth].status = "special";
      if (!s.icdas[tooth].specialCode || isImplantCode(s.icdas[tooth].specialCode)) {
        s.icdas[tooth].specialCode = "97";
      }
    } else {
      s.icdas[tooth].status = "normal";
      s.icdas[tooth].specialCode = null;
    }

    this.touch();
  }

  // Mark a tooth as an implant (ICDAS code 90/91). The natural tooth is missing,
  // but plaque, bleeding and ICDAS surface codes stay recordable on the implant;
  // probing, BOP, furcation and root caries are cleared and disabled.
  setToothImplant(tooth: FdiToothNumber, code: SpecialCaseCode): void {
    const s = this.getSession();

    // Plaque / bleeding: the implant surfaces are examined — keep what is recorded,
    // and bring back what marking the tooth missing had cleared
    const stash = this.clearedPB[tooth];
    if (stash && !s.plaque[tooth].present) {
      s.plaque[tooth] = { ...stash.plaque, present: true };
      s.bleeding[tooth] = { ...stash.bleeding, present: true };
    } else {
      s.plaque[tooth].present = true;
      s.bleeding[tooth].present = true;
    }
    delete this.clearedPB[tooth];

    // Probing: not applicable to an implant
    s.probing[tooth].present = false;
    for (const site of PROBING_ALL_SITES) {
      s.probing[tooth][site as ProbingSite] = null;
    }
    s.probing[tooth].furcation = null;

    if (s.bop && s.bop[tooth]) {
      for (const site of PROBING_ALL_SITES) {
        (s.bop[tooth] as Record<string, boolean>)[site] = false;
      }
    }

    if (s.furcationInvolvement) {
      const fiData = s.furcationInvolvement[tooth];
      if (fiData) {
        for (let i = 0; i < fiData.length; i++) fiData[i] = null;
      }
    }

    if (s.icdasRootCaries && s.icdasRootCaries[tooth]) {
      for (const site of PROBING_ALL_SITES) {
        (s.icdasRootCaries[tooth] as Record<string, number | null>)[site] = null;
      }
    }

    // ICDAS: special code, surfaces kept for entry
    s.icdas[tooth].status = "special";
    s.icdas[tooth].specialCode = code;

    this.touch();
  }

  // Mark session as modified
  touch(): void {
    if (this.session) {
      this.session.modifiedAt = new Date().toISOString();
      this.notifyListeners();
    }
  }

  // Register a change listener
  onChange(listener: ChangeListener): void {
    this.listeners.push(listener);
  }

  // Remove a change listener
  offChange(listener: ChangeListener): void {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
