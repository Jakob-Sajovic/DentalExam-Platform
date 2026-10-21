/* global document, HTMLElement, HTMLInputElement, HTMLTextAreaElement, HTMLButtonElement, HTMLSelectElement, File, crypto */

import { TabController } from "./tab-manager";
import { SessionState } from "../model/session";
import {
  ScanKind,
  ScanRecord,
  ScanPart,
  ScanFileRef,
  ScanUnit,
  SCAN_KINDS,
  SCAN_KIND_LABELS,
  SCAN_UNIT_TO_MM,
  activeSet,
  viewsFor,
  measurementSegments,
  DentitionStage,
  stageForDentition,
  CleftType,
  CLEFT_TYPES,
  CLEFT_LABELS,
  MESH_EXTENSIONS,
  Vec3,
  computeMeasurements,
  fileExtension,
  landmarkSetTag,
  makeEmptyScanRecord,
  roundCoord,
  ScanView,
  SCAN_VIEWS,
  SCAN_VIEW_LABELS,
  PartRole,
  PART_ROLE_LABELS,
  guessPartRole,
  partRole,
  partInView,
  landmarksInView,
  measurementColor,
  toothRowsInView,
  SNAPSHOT_PLAN,
  measurementPoints,
  overlayStamp,
} from "../model/scans3d";
import { ScanFileStore } from "../storage/scan-file-store";
import { FdiToothNumber } from "../model/types";
import { isImplantTooth, isToothMissing } from "../model/tooth-status";
import { DENTITION_LABELS, sessionDentition, sessionTeeth } from "../model/dentition";
import type { ScanViewer, ViewerPartInput, ViewAxis, CameraState, RotateAxis, ViewerLine, SnapshotSpec } from "../scan3d/viewer";

function esc(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

const NO_SESSION = "Ni aktivne seje. Začnite nov pregled na zavihku Začetek.";
const TWO_CLICK_MS = 3000;
const ACCEPT = ".stl,.obj,.ply,.mtl,.jpg,.jpeg,.png";
const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png"];
// Holding a rotate button: first step at once, then small steps for a smooth turn
const ROTATE_HOLD_DELAY_MS = 400;
const ROTATE_HOLD_EVERY_MS = 40;
const ROTATE_HOLD_DEGREES = 2;
// Report pictures, 4:3
const SNAPSHOT_W = 800;
const SNAPSHOT_H = 600;

type StatusKind = "info" | "ok" | "warn" | "error";
/** What a tap on the model places: a measurement landmark or a tooth number. */
type PlaceMode = "landmarks" | "teeth";

async function sha256Hex(blob: Blob): Promise<string> {
  if (!crypto || !crypto.subtle) throw new Error("Brskalnik ne omogoča preverjanja datotek (potrebna je varna povezava https).");
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function formatCoord(p: Vec3): string {
  return p.map((v) => v.toFixed(1)).join(", ");
}

/**
 * Starting camera per panel: [direction from the model to the camera, screen up].
 * TRIOS exports have +Y towards the skull and +Z towards the incisors, so the
 * upper arch is seen from below with the incisors at the top, and the lower
 * arch from above with the incisors at the bottom — both with the patient's
 * right on the screen's left, as when facing the patient.
 */
const VIEW_CAMERA: Record<ScanView, [Vec3, Vec3]> = {
  head: [[0, 0, 1], [0, 1, 0]],
  upper: [[0, -1, 0], [0, 0, 1]],
  lower: [[0, 1, 0], [0, 0, -1]],
  occlusion: [[0, 0, 1], [0, 1, 0]],
};

/** Name each part after its role, numbering repeats ("Griz 1", "Griz 2"). */
function relabelParts(kind: ScanKind, parts: ScanPart[]): void {
  const roles = parts.map((p) => partRole(kind, p));
  parts.forEach((p, i) => {
    const same = roles.filter((r) => r === roles[i]).length;
    const nth = roles.slice(0, i + 1).filter((r) => r === roles[i]).length;
    p.label = same > 1 ? `${PART_ROLE_LABELS[roles[i]]} ${nth}` : PART_ROLE_LABELS[roles[i]];
  });
}

function allRefs(record: ScanRecord): ScanFileRef[] {
  const refs: ScanFileRef[] = [];
  for (const part of record.parts) refs.push(part.mesh, ...part.extras);
  return refs;
}

export class Scans3DTabController implements TabController {
  private panel: HTMLElement | null = null;
  private session: SessionState;
  private files: ScanFileStore;

  private kind: ScanKind = "head";
  /** The panel shown; each scan kind remembers its last one. */
  private view: ScanView = "head";
  private viewByKind: Record<ScanKind, ScanView> = { head: "head", intraoral: "upper" };
  /** Landmark that the next tap on the model places. */
  private activeLandmark: string | null = null;
  private placeMode: PlaceMode = "landmarks";
  /** Tooth number that the next tap places, in tooth mode. */
  private activeTooth: string | null = null;
  /** Parts the operator switched on or off in a panel, over the panel's default. */
  private partOverrides = new Map<ScanView, Map<string, boolean>>();
  /** Camera of each panel, keyed by record and panel, so switching back keeps the view. */
  private cameras = new Map<string, CameraState>();

  private viewer: ScanViewer | null = null;
  private viewerKey = "";
  /** Files available this visit, by SHA-256 (picked now or read from storage). */
  private blobs = new Map<string, Blob>();
  private missing: ScanFileRef[] = [];
  private busy = false;

  private fileInput: HTMLInputElement | null = null;
  private kindBar: HTMLElement | null = null;
  private viewBar: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private filesEl: HTMLElement | null = null;
  private viewerWrap: HTMLElement | null = null;
  private viewerHost: HTMLElement | null = null;
  private viewerMsg: HTMLElement | null = null;
  private modeBar: HTMLElement | null = null;
  private listBar: HTMLElement | null = null;
  private landmarksEl: HTMLElement | null = null;
  private measurementsEl: HTMLElement | null = null;
  private noteEl: HTMLTextAreaElement | null = null;

  constructor(session: SessionState, files: ScanFileStore) {
    this.session = session;
    this.files = files;
  }

  init(panel: HTMLElement): void {
    this.panel = panel;
    panel.innerHTML = `
      <div class="tab-content-inner s3-tab">
        <h2>3D skeni</h2>
        <div class="s3-kind-bar" id="s3-kind-bar"></div>
        <div class="s3-list-bar" id="s3-list-bar" hidden></div>
        <div class="s3-view-bar" id="s3-view-bar" hidden></div>
        <input type="file" id="s3-file-input" multiple accept="${ACCEPT}" hidden />
        <div class="rtg-status" id="s3-status" hidden></div>
        <div id="s3-files"></div>
        <div class="s3-viewer-wrap" id="s3-viewer-wrap" hidden>
          <div class="s3-viewer" id="s3-viewer"></div>
          <div class="s3-viewer-msg" id="s3-viewer-msg" hidden></div>
          <div class="s3-view-buttons">
            <button class="btn btn-secondary btn-sm" data-view="reset" title="Ponastavi pogled">⟲</button>
            <button class="btn btn-secondary btn-sm" data-view="x" title="Pogled vzdolž osi X (ponovni klik: z druge strani)">X</button>
            <button class="btn btn-secondary btn-sm" data-view="y" title="Pogled vzdolž osi Y (ponovni klik: z druge strani)">Y</button>
            <button class="btn btn-secondary btn-sm" data-view="z" title="Pogled vzdolž osi Z (ponovni klik: z druge strani)">Z</button>
          </div>
          <div class="s3-rotate-bar">
            <div class="s3-rot-group">
              <span class="s3-rot-label">Zasuk</span>
              <button class="btn btn-secondary" data-rot="turn" data-dir="-1" title="Zasukaj model v levo">←</button>
              <button class="btn btn-secondary" data-rot="turn" data-dir="1" title="Zasukaj model v desno">→</button>
            </div>
            <div class="s3-rot-group">
              <span class="s3-rot-label">Nagib</span>
              <button class="btn btn-secondary" data-rot="tilt" data-dir="-1" title="Nagni model navzgor">↑</button>
              <button class="btn btn-secondary" data-rot="tilt" data-dir="1" title="Nagni model navzdol">↓</button>
            </div>
            <div class="s3-rot-group">
              <span class="s3-rot-label">Vrtenje</span>
              <button class="btn btn-secondary" data-rot="roll" data-dir="-1" title="Zavrti model v nasprotni smeri urinega kazalca">↺</button>
              <button class="btn btn-secondary" data-rot="roll" data-dir="1" title="Zavrti model v smeri urinega kazalca">↻</button>
            </div>
            <label class="s3-rot-group s3-rot-step">
              <span class="s3-rot-label">Korak</span>
              <select class="form-input" id="s3-rot-step">
                <option value="1">1°</option>
                <option value="5">5°</option>
                <option value="15" selected>15°</option>
                <option value="45">45°</option>
                <option value="90">90°</option>
              </select>
            </label>
          </div>
          <div class="s3-snap-bar">
            <button class="btn btn-secondary" id="s3-snap-btn">📷 Posnetki za poročilo</button>
            <span class="form-hint" id="s3-snap-hint"></span>
          </div>
          <div class="s3-snaps" id="s3-snaps"></div>
        </div>
        <div class="s3-mode-bar" id="s3-mode-bar" hidden></div>
        <div id="s3-landmarks"></div>
        <div id="s3-measurements"></div>
        <div class="form-group">
          <label class="form-label" for="s3-note">Opombe k skenu</label>
          <textarea id="s3-note" class="form-textarea" rows="3" placeholder="Opažanja, kakovost skena ..."></textarea>
        </div>
        <p class="tab-help-footer">
          Naložite izvožene datoteke skena (STL, PLY ali OBJ z datotekama .mtl in teksturo).
          Datoteke ostanejo v tej napravi in niso del datoteke .xlsx — vanjo se shranijo
          le koordinate točk in izračunane meritve. Model vrtite z vlečenjem, povečate s
          kolescem ali dvema prstoma, premaknete z desnim gumbom miške ali tremi prsti.
          Z gumbi pod modelom ga zasukate, nagnete ali zavrtite okoli vseh treh osi
          (pridržite gumb za zvezno vrtenje). Točko postavite tako, da jo izberete na seznamu in
          nato tapnete na model. Intraoralni sken ima tri poglede z ločenimi točkami in
          meritvami: zgornjo čeljust, spodnjo čeljust in okluzijo. Na intraoralnem skenu lahko
          z načinom »Oznake zob« zobe označite s številkami FDI. Meritve so na modelu narisane kot
          črte, obarvane od modre (prva meritev) do rdeče (zadnja), z isto barvo kot v tabeli.
        </p>
      </div>
    `;

    this.fileInput = panel.querySelector("#s3-file-input") as HTMLInputElement;
    this.kindBar = panel.querySelector("#s3-kind-bar") as HTMLElement;
    this.viewBar = panel.querySelector("#s3-view-bar") as HTMLElement;
    this.statusEl = panel.querySelector("#s3-status") as HTMLElement;
    this.filesEl = panel.querySelector("#s3-files") as HTMLElement;
    this.viewerWrap = panel.querySelector("#s3-viewer-wrap") as HTMLElement;
    this.viewerHost = panel.querySelector("#s3-viewer") as HTMLElement;
    this.viewerMsg = panel.querySelector("#s3-viewer-msg") as HTMLElement;
    this.modeBar = panel.querySelector("#s3-mode-bar") as HTMLElement;
    this.listBar = panel.querySelector("#s3-list-bar") as HTMLElement;
    this.landmarksEl = panel.querySelector("#s3-landmarks") as HTMLElement;
    this.measurementsEl = panel.querySelector("#s3-measurements") as HTMLElement;
    this.noteEl = panel.querySelector("#s3-note") as HTMLTextAreaElement;

    this.fileInput.addEventListener("change", () => {
      const picked = Array.from(this.fileInput?.files || []);
      if (this.fileInput) this.fileInput.value = "";
      if (picked.length) void this.handleFiles(picked);
    });

    this.noteEl.addEventListener("input", () => {
      if (!this.session.hasSession()) return;
      this.record().note = this.noteEl?.value || "";
      this.session.touch();
    });

    this.wireRotateButtons(panel);
    panel.querySelector("#s3-snap-btn")?.addEventListener("click", () => this.takeSnapshots());

    panel.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const v = btn.dataset.view;
        if (!this.viewer) return;
        if (v === "reset") this.viewer.resetView(...VIEW_CAMERA[this.view]);
        else this.viewer.viewAlong(v as ViewAxis);
      });
    });
  }

  onActivate(): void {
    this.render();
    // The canvas had no size while the tab was hidden
    this.viewer?.resize();
    void this.ensureViewer();
  }

  onDeactivate(): void {
    this.refreshSnapshotsIfStale();
    this.activeLandmark = null;
    this.activeTooth = null;
  }

  // ── State helpers ──────────────────────────────────────────────

  private record(): ScanRecord {
    return this.session.getScans3D()[this.kind];
  }

  /** The landmark list the current record is measured with. */
  private set() {
    return activeSet(this.kind, this.record());
  }

  /** Keep the shown panel one of the record's panels (an infant has only the upper jaw). */
  private ensureView(): void {
    const views = viewsFor(this.kind, this.record());
    if (!views.includes(this.view)) {
      this.view = views[0] || SCAN_VIEWS[this.kind][0];
      this.viewByKind[this.kind] = this.view;
    }
  }

  private recordKey(): string {
    if (!this.session.hasSession()) return "";
    const r = this.record();
    return `${this.session.getSession().sessionId}|${this.kind}|${allRefs(r).map((f) => f.sha256).join(",")}`;
  }

  // ── Rendering ──────────────────────────────────────────────────

  private render(): void {
    if (this.session.hasSession()) {
      // The intraoral list follows the patient's dentition, which may have changed on the Patient tab
      const io = this.session.getScans3D().intraoral;
      const stage = stageForDentition(sessionDentition(this.session.getSession()));
      if (io.stage !== stage) {
        io.stage = stage;
        io.landmarkSet = landmarkSetTag(activeSet("intraoral", io));
        this.activeLandmark = null;
        this.activeTooth = null;
      }
    }
    if (!this.session.hasSession()) {
      this.renderKindBar();
      this.setStatus("info", NO_SESSION);
      if (this.filesEl) this.filesEl.innerHTML = "";
      if (this.viewerWrap) this.viewerWrap.hidden = true;
      if (this.modeBar) this.modeBar.hidden = true;
      if (this.listBar) this.listBar.hidden = true;
      if (this.landmarksEl) this.landmarksEl.innerHTML = "";
      if (this.measurementsEl) this.measurementsEl.innerHTML = "";
      if (this.noteEl) this.noteEl.value = "";
      return;
    }
    this.ensureView();
    this.renderKindBar();
    this.renderListBar();
    this.renderViewBar();
    this.renderFiles();
    this.renderModeBar();
    this.renderLandmarks();
    this.renderMeasurements();
    this.renderSnapshots();
    if (this.noteEl) this.noteEl.value = this.record().note;
    if (this.viewerWrap) this.viewerWrap.hidden = this.record().parts.length === 0;
  }

  private renderKindBar(): void {
    if (!this.kindBar) return;
    const scans = this.session.hasSession() ? this.session.getScans3D() : null;
    this.kindBar.innerHTML = SCAN_KINDS.map((k) => {
      const n = scans ? scans[k].parts.length : 0;
      const badge = n ? ` <span class="s3-kind-badge">${n}</span>` : "";
      return `<button class="s3-kind-btn${k === this.kind ? " active" : ""}" data-kind="${k}">${esc(SCAN_KIND_LABELS[k])}${badge}</button>`;
    }).join("");
    this.kindBar.querySelectorAll<HTMLButtonElement>("[data-kind]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const k = btn.dataset.kind as ScanKind;
        if (k === this.kind || this.busy) return;
        this.refreshSnapshotsIfStale();
        this.saveCamera();
        this.kind = k;
        this.view = this.viewByKind[k];
        this.activeLandmark = null;
        this.activeTooth = null;
        this.setStatus(null);
        this.render();
        void this.ensureViewer();
      });
    });
  }

  /** Intraoral: dentition and cleft, which choose the landmark list. */
  private renderListBar(): void {
    if (!this.listBar) return;
    this.listBar.hidden = this.kind !== "intraoral";
    if (this.listBar.hidden) return;
    const r = this.record();
    const opts = <T extends string>(values: T[], labels: Record<T, string>, current: T) =>
      values.map((v) => `<option value="${v}" ${v === current ? "selected" : ""}>${esc(labels[v])}</option>`).join("");
    // The dentition is the patient's (Patient tab); only the cleft is chosen here
    const dentition = sessionDentition(this.session.getSession());
    this.listBar.innerHTML = `
      <div class="s3-list-field"><span class="form-label">Zobovje</span>
        <span class="s3-list-value">${esc(DENTITION_LABELS[dentition])} <span class="form-hint">(zavihek Preiskovanec)</span></span></div>
      <label class="s3-list-field"><span class="form-label">Razcep</span>
        <select class="form-input" id="s3-cleft">${opts(CLEFT_TYPES, CLEFT_LABELS, r.cleft)}</select></label>`;
    this.listBar.querySelector("#s3-cleft")?.addEventListener("change", (e) => {
      this.changeList(r.stage, (e.target as HTMLSelectElement).value as CleftType);
    });
  }

  /**
   * Switch the landmark list. Points stay in the record: those the new list
   * shares keep their place, the others come back if the list is switched back.
   */
  private changeList(stage: DentitionStage, cleft: CleftType): void {
    if (!this.session.hasSession()) return;
    const r = this.record();
    this.saveCamera();
    r.stage = stage;
    r.cleft = cleft;
    r.landmarkSet = landmarkSetTag(this.set());
    this.session.touch();
    this.ensureView();
    if (stage === "infant") this.placeMode = "landmarks";
    this.activeLandmark = landmarksInView(this.set(), this.view).find((l) => !r.landmarks[l.id])?.id || null;
    this.activeTooth = this.nextTooth(null);
    this.setStatus(null);
    this.render();
    this.applyView();
  }

  private renderViewBar(): void {
    if (!this.viewBar) return;
    const r = this.record();
    const views = viewsFor(this.kind, r);
    this.viewBar.hidden = views.length < 2 || r.parts.length === 0;
    if (this.viewBar.hidden) return;
    this.viewBar.innerHTML = views
      .map((v) => {
        const list = landmarksInView(this.set(), v);
        const placed = list.filter((l) => r.landmarks[l.id]).length;
        return `<button class="s3-view-btn${v === this.view ? " active" : ""}" data-panel="${v}">
          ${esc(SCAN_VIEW_LABELS[v])} <span class="s3-count">${placed}/${list.length}</span></button>`;
      })
      .join("");
    this.viewBar.querySelectorAll<HTMLButtonElement>("[data-panel]").forEach((btn) => {
      btn.addEventListener("click", () => this.switchView(btn.dataset.panel as ScanView));
    });
  }

  private switchView(v: ScanView): void {
    if (v === this.view || this.busy) return;
    this.saveCamera();
    this.view = v;
    this.viewByKind[this.kind] = v;
    const r = this.record();
    this.activeLandmark = landmarksInView(this.set(), v).find((l) => !r.landmarks[l.id])?.id || null;
    this.activeTooth = this.nextTooth(null);
    this.setStatus(null);
    this.renderViewBar();
    this.renderFiles();
    this.renderLandmarks();
    this.renderMeasurements();
    this.applyView();
  }

  /** Parts that belong in the current panel, and whether each is switched on. */
  private partsInView(view: ScanView = this.view): { part: ScanPart; role: PartRole; visible: boolean }[] {
    const over = this.partOverrides.get(view);
    const out: { part: ScanPart; role: PartRole; visible: boolean }[] = [];
    for (const part of this.record().parts) {
      const role = partRole(this.kind, part);
      const rule = partInView(role, view);
      if (!rule.shown) continue;
      const o = over?.get(part.id);
      out.push({ part, role, visible: o === undefined ? rule.visibleByDefault : o });
    }
    return out;
  }

  private cameraKey(view: ScanView = this.view): string {
    return `${this.recordKey()}|${view}`;
  }

  private saveCamera(): void {
    if (this.viewer && this.session.hasSession() && this.viewerKey === this.recordKey() && this.record().parts.length) {
      this.cameras.set(this.cameraKey(), this.viewer.getCameraState());
    }
  }

  /** Show the current panel's parts, from its remembered or starting camera. */
  private applyView(): void {
    if (!this.viewer || !this.session.hasSession()) return;
    this.viewer.setVisibleParts(this.partsInView().filter((x) => x.visible).map((x) => x.part.id));
    const saved = this.cameras.get(this.cameraKey());
    if (saved) this.viewer.setCameraState(saved);
    else this.viewer.resetView(...VIEW_CAMERA[this.view]);
    this.syncMarkers();
  }

  private renderFiles(): void {
    if (!this.filesEl) return;
    const r = this.record();

    if (r.parts.length === 0) {
      const hint =
        this.kind === "head"
          ? "Izberite izvoz iz Artec Studio: datoteko .obj skupaj z .mtl in teksturo (.jpg), ali samo .stl (brez barve)."
          : "Izberite izvožene datoteke TRIOS (.stl ali .ply): zgornjo in spodnjo čeljust ter po želji skene griza — vse hkrati.";
      this.filesEl.innerHTML = `
        <div class="s3-empty">
          <p class="form-hint">${esc(hint)}</p>
          <button class="btn btn-primary" id="s3-pick-btn">📂 Naloži datoteke skena</button>
        </div>`;
      this.filesEl.querySelector("#s3-pick-btn")?.addEventListener("click", () => this.fileInput?.click());
      return;
    }

    const missingSet = new Set(this.missing.map((f) => f.sha256));
    const inView = this.partsInView();
    const roleOptions = (current: PartRole) =>
      (Object.keys(PART_ROLE_LABELS) as PartRole[])
        .filter((role) => (this.kind === "head") === (role === "head"))
        .map((role) => `<option value="${role}" ${role === current ? "selected" : ""}>${esc(PART_ROLE_LABELS[role])}</option>`)
        .join("");
    const rows = inView
      .map(({ part: p, role, visible }) => {
        const lost = [p.mesh, ...p.extras].filter((f) => missingSet.has(f.sha256));
        const names = [p.mesh, ...p.extras].map((f) => esc(f.name)).join(", ");
        // The head has one role only; intraoral files can be reassigned if the name misled us
        const label =
          this.kind === "head"
            ? `<span class="s3-part-label">${esc(p.label)}</span>`
            : `<select class="form-input s3-role-select" data-role="${esc(p.id)}" title="Vloga datoteke">${roleOptions(role)}</select>`;
        return `
          <div class="s3-part${lost.length ? " missing" : ""}">
            <input type="checkbox" data-part="${esc(p.id)}" ${visible ? "checked" : ""} ${lost.length ? "disabled" : ""}
              title="Prikaži v tem pogledu" />
            ${label}
            <span class="s3-part-files">${names}${lost.length ? " — <b>ni v tej napravi</b>" : ""}</span>
          </div>`;
      })
      .join("");
    const emptyView =
      inView.length === 0
        ? `<div class="rtg-status rtg-status-warn">V tem pogledu ni modela. Na pogledu »Okluzija« datoteki nastavite vlogo »${esc(SCAN_VIEW_LABELS[this.view])}«.</div>`
        : "";

    const units = (Object.keys(SCAN_UNIT_TO_MM) as ScanUnit[])
      .map((u) => `<option value="${u}" ${u === r.unit ? "selected" : ""}>${u}</option>`)
      .join("");
    const size = this.viewer && this.viewerKey === this.recordKey() ? this.viewer.modelSize() : null;
    const sizeText = size ? `Velikost modela: ${size.map((v) => Math.round(v)).join(" × ")} ${r.unit}` : "";

    this.filesEl.innerHTML = `
      ${emptyView}
      <div class="s3-parts">${rows}</div>
      <div class="s3-unit-row">
        <label class="form-label" for="s3-unit">Enota v datoteki</label>
        <select id="s3-unit" class="form-input s3-unit-select">${units}</select>
        <label class="s3-unit-confirm"><input type="checkbox" id="s3-unit-ok" ${r.unitConfirmed ? "checked" : ""}/> preverjeno</label>
        <span class="form-hint">${esc(sizeText)}</span>
      </div>
      ${r.unitConfirmed ? "" : `<div class="s3-unit-warn">Preverite enoto: velikost modela mora ustrezati dejanski (glava ≈ 150–250 mm široka, zobni lok ≈ 50–70 mm).</div>`}
      <div class="s3-file-actions">
        ${this.missing.length ? `<button class="btn btn-primary btn-sm" id="s3-relink-btn">📂 Poišči manjkajoče datoteke</button>` : ""}
        <button class="btn btn-danger-outline btn-sm" id="s3-remove-btn">Odstrani sken</button>
      </div>`;


    this.filesEl.querySelectorAll<HTMLInputElement>("[data-part]").forEach((cb) => {
      cb.addEventListener("change", () => {
        const id = cb.dataset.part as string;
        let over = this.partOverrides.get(this.view);
        if (!over) this.partOverrides.set(this.view, (over = new Map()));
        over.set(id, cb.checked);
        this.viewer?.setPartVisible(id, cb.checked);
      });
    });
    this.filesEl.querySelectorAll<HTMLSelectElement>("[data-role]").forEach((sel) => {
      sel.addEventListener("change", () => {
        const part = r.parts.find((p) => p.id === sel.dataset.role);
        if (!part) return;
        part.role = sel.value as PartRole;
        relabelParts(this.kind, r.parts);
        this.session.touch();
        this.renderFiles();
        this.applyView();
      });
    });
    this.filesEl.querySelector("#s3-unit")?.addEventListener("change", (e) => {
      r.unit = (e.target as HTMLSelectElement).value as ScanUnit;
      r.unitConfirmed = true;
      this.session.touch();
      this.renderFiles();
      this.renderMeasurements();
    });
    this.filesEl.querySelector("#s3-unit-ok")?.addEventListener("change", (e) => {
      r.unitConfirmed = (e.target as HTMLInputElement).checked;
      this.session.touch();
      this.renderMeasurements();
      this.renderFiles();
    });
    this.filesEl.querySelector("#s3-relink-btn")?.addEventListener("click", () => this.fileInput?.click());
    const removeBtn = this.filesEl.querySelector("#s3-remove-btn") as HTMLButtonElement | null;
    if (removeBtn) {
      this.twoClick(removeBtn, "Odstrani sken", () => {
        // The dentition and cleft describe the patient, not the files: keep them
        this.session.getScans3D()[this.kind] = makeEmptyScanRecord(this.kind, r.stage, r.cleft);
        this.session.touch();
        this.missing = [];
        this.activeLandmark = null;
        this.activeTooth = null;
        this.partOverrides.clear();
        this.setStatus("info", "Sken in njegove točke so odstranjeni s pregleda.");
        this.render();
        void this.ensureViewer();
      });
    }
  }

  /** Tooth mode exists only where there are teeth to label. */
  private toothMode(): boolean {
    return this.placeMode === "teeth" && toothRowsInView(this.view, this.record().stage).length > 0;
  }

  private renderModeBar(): void {
    if (!this.modeBar) return;
    const r = this.record();
    this.modeBar.hidden = this.kind !== "intraoral" || r.parts.length === 0 || r.stage === "infant";
    if (this.modeBar.hidden) return;
    const teeth = this.toothMode();
    this.modeBar.innerHTML = `
      <span class="s3-mode-label">Tap na model postavi:</span>
      <div class="s3-mode-seg">
        <button class="s3-mode-btn${teeth ? "" : " active"}" data-mode="landmarks">Točke</button>
        <button class="s3-mode-btn${teeth ? " active" : ""}" data-mode="teeth">Oznake zob</button>
      </div>
      <label class="s3-check"><input type="checkbox" id="s3-show-teeth" ${r.display.teeth ? "checked" : ""}/> prikaži oznake zob</label>`;
    this.modeBar.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const mode = btn.dataset.mode as PlaceMode;
        if (mode === this.placeMode) return;
        this.placeMode = mode;
        if (mode === "teeth") {
          this.record().display.teeth = true;
          if (!this.activeTooth) this.activeTooth = this.nextTooth(null);
        }
        this.setStatus(null);
        this.renderModeBar();
        this.renderLandmarks();
        this.syncMarkers();
      });
    });
    this.modeBar.querySelector("#s3-show-teeth")?.addEventListener("change", (e) => {
      this.record().display.teeth = (e.target as HTMLInputElement).checked;
      this.session.touch();
      this.syncMarkers();
    });
  }

  /**
   * A tooth's state in the rest of the examination (VPI/GBI, ICDAS, probing).
   * Teeth the patient's dentition does not chart are "free".
   */
  private toothState(fdi: string): "present" | "missing" | "implant" | "other" | "free" {
    const t = Number(fdi) as FdiToothNumber;
    const s = this.session.getSession();
    if (!sessionTeeth(s).includes(t)) return "free";
    const td = s.icdas[t];
    if (isImplantTooth(td)) return "implant";
    if (!isToothMissing(s, t)) return "present";
    // Plain missing (no code, 97, 98) can be undone by labelling; the other
    // codes (bridge pontic, unerupted, retained root …) describe something else
    const code = td && td.status === "special" ? td.specialCode : null;
    return code === null || code === "97" || code === "98" ? "missing" : "other";
  }

  /** The tooth after `from` (or the first) in the panel's rows that has no label and is not missing. */
  private nextTooth(from: string | null): string | null {
    const r = this.record();
    const rows = toothRowsInView(this.view, r.stage);
    const order = rows.flatMap((row) => row.teeth);
    const i = from ? order.indexOf(from) : -1;
    // Stay within the row being labelled: permanent and primary teeth are not mixed
    const row = from ? rows.find((x) => x.teeth.includes(from)) : null;
    const rest = row ? row.teeth.slice(row.teeth.indexOf(from as string) + 1) : order.slice(i + 1);
    return rest.find((t) => !r.teeth[t] && this.toothState(t) !== "missing") || null;
  }

  private renderTeeth(): void {
    if (!this.landmarksEl) return;
    const r = this.record();
    const rows = toothRowsInView(this.view, r.stage);
    const all = rows.flatMap((row) => row.teeth);
    const placed = all.filter((t) => r.teeth[t]).length;
    const active = this.activeTooth;
    const STATE_TITLE = {
      present: "",
      free: "",
      missing: " — manjka",
      implant: " — vsadek",
      other: " — posebna koda ICDAS",
    };

    const rowHtml = rows
      .map((row) => {
        const half = row.teeth.length / 2;
        const btn = (t: string) => {
          const state = this.toothState(t);
          const cls = `s3-tooth${r.teeth[t] ? " placed" : ""}${t === active ? " active" : ""}${state === "missing" ? " missing" : ""}${state === "implant" ? " implant" : ""}`;
          return `<button class="${cls}" data-tooth="${t}" title="Zob ${t}${STATE_TITLE[state]}">${t}</button>`;
        };
        return `
          <div class="s3-tooth-row">
            <span class="s3-tooth-row-label">${esc(row.label)}</span>
            <div class="s3-tooth-half">${row.teeth.slice(0, half).map(btn).join("")}</div>
            <div class="s3-tooth-half">${row.teeth.slice(half).map(btn).join("")}</div>
          </div>`;
      })
      .join("");

    const state = active ? this.toothState(active) : "free";
    const hint = !active
      ? "Izberite številko zoba, nato tapnite na zob na modelu."
      : state === "missing"
        ? `Zob ${active} je označen kot manjkajoč. Če ga tapnete na modelu, bo označen kot prisoten na vseh zavihkih.`
        : r.teeth[active]
          ? `Zob ${active} je označen — tapnite na model, da oznako premaknete.`
          : `Tapnite na zob ${active} na modelu.`;
    const actions: string[] = [];
    if (active && r.teeth[active]) {
      actions.push(`<button class="btn btn-secondary btn-sm" id="s3-del-tooth">Odstrani oznako ${active}</button>`);
    }
    if (active && state === "present") {
      actions.push(`<button class="btn btn-secondary btn-sm" id="s3-tooth-missing">✕ Zob ${active} manjka</button>`);
    }
    if (active && state === "missing") {
      actions.push(`<button class="btn btn-secondary btn-sm" id="s3-tooth-present">Zob ${active} je prisoten</button>`);
    }
    if (active && (state === "implant" || state === "other")) {
      actions.push(`<span class="form-hint">Stanje zoba ${active} urejate na zavihku ICDAS.</span>`);
    }

    this.landmarksEl.innerHTML = `
      <div class="s3-section-head">
        <h3>Oznake zob${viewsFor(this.kind, r).length > 1 ? ` — ${esc(SCAN_VIEW_LABELS[this.view].toLowerCase())}` : ""}
          <span class="s3-count">${placed} označenih</span></h3>
        ${placed ? `<button class="btn btn-danger-outline btn-sm" id="s3-clear-teeth">Izbriši oznake zob</button>` : ""}
      </div>
      <p class="form-hint s3-tooth-hint">${esc(hint)} ${actions.join(" ")}</p>
      <div class="s3-tooth-grid">${rowHtml}</div>
      <p class="form-hint">Prečrtani zobje so na drugih zavihkih označeni kot manjkajoči. Zobje, ki jih zobovje
        (zavihek Preiskovanec) prikazuje na kartah, so povezani z zavihki VPI/GBI, ICDAS in Globine.</p>`;

    this.landmarksEl.querySelectorAll<HTMLButtonElement>("[data-tooth]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const t = btn.dataset.tooth as string;
        this.activeTooth = this.activeTooth === t ? null : t;
        this.renderTeeth();
        this.syncMarkers();
      });
    });
    this.landmarksEl.querySelector("#s3-del-tooth")?.addEventListener("click", () => {
      if (!active) return;
      delete r.teeth[active];
      this.session.touch();
      this.renderTeeth();
      this.syncMarkers();
    });
    this.landmarksEl.querySelector("#s3-tooth-missing")?.addEventListener("click", () => {
      if (!active) return;
      // Clears the tooth on every tab and removes its label (SessionState.setToothPresence)
      this.session.setToothPresence(Number(active) as FdiToothNumber, false);
      this.setStatus("info", `Zob ${active} je označen kot manjkajoč na vseh zavihkih.`);
      this.activeTooth = this.nextTooth(active);
      this.renderTeeth();
      this.syncMarkers();
    });
    this.landmarksEl.querySelector("#s3-tooth-present")?.addEventListener("click", () => {
      if (!active) return;
      this.session.setToothPresence(Number(active) as FdiToothNumber, true);
      this.setStatus("info", `Zob ${active} je označen kot prisoten na vseh zavihkih.`);
      this.renderTeeth();
    });
    const clearBtn = this.landmarksEl.querySelector("#s3-clear-teeth") as HTMLButtonElement | null;
    if (clearBtn) {
      this.twoClick(clearBtn, "Izbriši oznake zob", () => {
        // Only the teeth offered in this panel; in the occlusion panel that is all of them
        for (const t of all) delete r.teeth[t];
        this.activeTooth = this.nextTooth(null);
        this.session.touch();
        this.renderTeeth();
        this.syncMarkers();
      });
    }
  }

  private renderLandmarks(): void {
    if (!this.landmarksEl) return;
    const r = this.record();
    const set = this.set();
    if (r.parts.length === 0) {
      this.landmarksEl.innerHTML = "";
      return;
    }
    if (this.toothMode()) {
      this.renderTeeth();
      return;
    }

    const notices: string[] = [];
    if (set.draft) {
      notices.push(`<div class="rtg-status rtg-status-info">Seznam točk je <b>osnutek</b> — dokončen bo po dogovoru s kliničnim timom.</div>`);
    }
    if (r.landmarkSet !== landmarkSetTag(set) && Object.keys(r.landmarks).length) {
      notices.push(`<div class="rtg-status rtg-status-warn">Točke so bile postavljene s seznamom ${esc(r.landmarkSet)}, trenutni seznam je ${esc(landmarkSetTag(set))}.</div>`);
    }

    const list = landmarksInView(this.set(), this.view);
    const placed = list.filter((l) => r.landmarks[l.id]).length;
    const rows = list
      .map((l) => {
        const p = r.landmarks[l.id];
        const active = l.id === this.activeLandmark;
        return `
          <div class="s3-lm${active ? " active" : ""}${p ? " placed" : ""}" data-lm="${esc(l.id)}">
            <span class="s3-lm-abbr">${esc(l.abbr)}</span>
            <span class="s3-lm-label">${esc(l.label)}</span>
            <span class="s3-lm-pos">${p ? esc(formatCoord(p)) : active ? "tapnite na model" : "—"}</span>
            ${p ? `<button class="btn btn-secondary btn-sm s3-lm-del" data-del="${esc(l.id)}" title="Izbriši točko">✕</button>` : ""}
          </div>`;
      })
      .join("");

    this.landmarksEl.innerHTML = `
      ${notices.join("")}
      <div class="s3-section-head">
        <h3>Točke${viewsFor(this.kind, r).length > 1 ? ` — ${esc(SCAN_VIEW_LABELS[this.view].toLowerCase())}` : ""}
          <span class="s3-count">${placed}/${list.length}</span></h3>
        ${placed ? `<button class="btn btn-danger-outline btn-sm" id="s3-clear-lm">Izbriši točke</button>` : ""}
      </div>
      <div class="s3-lm-list">${rows}</div>`;

    this.landmarksEl.querySelectorAll<HTMLElement>("[data-lm]").forEach((row) => {
      row.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).closest("[data-del]")) return;
        const id = row.dataset.lm as string;
        this.activeLandmark = this.activeLandmark === id ? null : id;
        this.renderLandmarks();
        this.syncMarkers();
      });
    });
    this.landmarksEl.querySelectorAll<HTMLButtonElement>("[data-del]").forEach((btn) => {
      btn.addEventListener("click", () => {
        delete r.landmarks[btn.dataset.del as string];
        this.session.touch();
        this.renderViewBar();
        this.renderLandmarks();
        this.renderMeasurements();
        this.syncMarkers();
      });
    });
    const clearBtn = this.landmarksEl.querySelector("#s3-clear-lm") as HTMLButtonElement | null;
    if (clearBtn) {
      this.twoClick(clearBtn, "Izbriši točke", () => {
        // Only this panel's points; the other panels keep theirs
        for (const l of list) delete r.landmarks[l.id];
        this.activeLandmark = list[0]?.id || null;
        this.session.touch();
        this.renderViewBar();
        this.renderLandmarks();
        this.renderMeasurements();
        this.syncMarkers();
      });
    }
  }

  // ── Report snapshots ───────────────────────────────────────────

  /** The camera a panel would show: live, remembered, or its preset framing. */
  private panelCamera(view: ScanView, parts: string[]): CameraState | null {
    if (!this.viewer) return null;
    if (view === this.view) return this.viewer.getCameraState();
    return this.cameras.get(this.cameraKey(view)) || this.viewer.framedState(...VIEW_CAMERA[view], parts);
  }

  private takeSnapshots(): void {
    if (!this.viewer || !this.session.hasSession() || this.busy || this.missing.length) {
      this.setStatus("warn", "Za posnetke morajo biti naložene vse datoteke skena.");
      return;
    }
    const r = this.record();
    const views = viewsFor(this.kind, r);
    const planned: { id: string; label: string; view: ScanView; camera: CameraState; parts: string[] }[] = [];
    for (const plan of SNAPSHOT_PLAN[this.kind]) {
      if (!views.includes(plan.view)) continue;
      const parts = this.partsInView(plan.view).filter((x) => x.visible).map((x) => x.part.id);
      const base = parts.length ? this.panelCamera(plan.view, parts) : null;
      if (!base) continue;
      const camera = plan.turn ? this.viewer.rotatedState(base, "turn", plan.turn) : base;
      planned.push({ id: plan.id, label: plan.label, view: plan.view, camera, parts });
    }
    if (!planned.length) return;
    this.saveCamera();
    r.snapshots = {};
    for (const p of planned) {
      r.snapshots[p.id] = { label: p.label, dataUrl: "", width: SNAPSHOT_W, height: SNAPSHOT_H, view: p.view, camera: p.camera, parts: p.parts };
    }
    const n = this.renderSnapshotImages();
    this.setStatus("ok", `Shranjenih ${n} posnetkov za poročilo.`);
    this.renderSnapshots();
  }

  /**
   * (Re)render every snapshot of the record from its stored camera, with the
   * points, lines and labels as they are now. Returns how many were rendered.
   */
  private renderSnapshotImages(): number {
    if (!this.viewer) return 0;
    const r = this.record();
    const ids = Object.keys(r.snapshots).filter((id) => r.snapshots[id].camera && r.snapshots[id].view);
    const specs: SnapshotSpec[] = ids.map((id) => {
      const snap = r.snapshots[id];
      return { id, camera: snap.camera as CameraState, parts: snap.parts || [], ...this.overlaysFor(snap.view as ScanView, false) };
    });
    if (!specs.length) return 0;
    const shots = this.viewer.captureSnapshots(specs, SNAPSHOT_W, SNAPSHOT_H);
    const stamp = overlayStamp(r);
    for (const shot of shots) {
      r.snapshots[shot.id].dataUrl = shot.dataUrl;
      r.snapshots[shot.id].stamp = stamp;
    }
    // The capture used the viewer's overlay groups; put the live ones back
    this.syncMarkers();
    this.session.touch();
    return shots.length;
  }

  /**
   * Snapshots follow the points: when the points, labels or display switches
   * changed since they were taken, retake them from the same cameras. Runs on
   * leaving the tab or the scan, so the report always shows the current state.
   */
  private refreshSnapshotsIfStale(): void {
    if (!this.viewer || !this.session.hasSession() || this.busy || this.missing.length) return;
    if (this.viewerKey !== this.recordKey()) return;
    const r = this.record();
    const snaps = Object.values(r.snapshots);
    if (!snaps.length) return;
    const stamp = overlayStamp(r);
    if (snaps.every((x) => x.stamp === stamp)) return;
    this.renderSnapshotImages();
  }


  private renderSnapshots(): void {
    const host = this.panel?.querySelector("#s3-snaps") as HTMLElement | null;
    const hint = this.panel?.querySelector("#s3-snap-hint") as HTMLElement | null;
    if (!host || !hint || !this.session.hasSession()) return;
    const r = this.record();
    hint.textContent =
      this.kind === "head"
        ? "Pred posnetkom obrnite glavo, da jo gledate od spredaj (⟲ = privzeti pogled); stranski in zadnji pogled se izračunajo."
        : "Uporabijo se trenutni pogledi panelov: čeljusti od zgoraj, griz od spredaj (⟲ = privzeti pogled); stranska pogleda se izračunata.";
    const shots = SNAPSHOT_PLAN[this.kind].filter((p) => r.snapshots[p.id]?.dataUrl);
    if (!shots.length) {
      host.innerHTML = "";
      return;
    }
    const stale = shots.some((p) => r.snapshots[p.id].stamp !== overlayStamp(r));
    host.innerHTML = `
      ${stale ? `<p class="form-hint s3-snap-stale">Točke so se spremenile — posnetki se posodobijo, ko zapustite zavihek 3D (datoteke skena morajo biti naložene).</p>` : ""}
      ${shots
        .map((p) => `<figure class="s3-snap"><img src="${r.snapshots[p.id].dataUrl}" alt="${esc(p.label)}" /><figcaption>${esc(p.label)}</figcaption></figure>`)
        .join("")}
      <button class="btn btn-danger-outline btn-sm" id="s3-snap-clear">Odstrani posnetke</button>`;
    const clear = host.querySelector("#s3-snap-clear") as HTMLButtonElement;
    this.twoClick(clear, "Odstrani posnetke", () => {
      r.snapshots = {};
      this.session.touch();
      this.renderSnapshots();
    });
  }

  private renderMeasurements(): void {
    if (!this.measurementsEl) return;
    const r = this.record();
    if (r.parts.length === 0) {
      this.measurementsEl.innerHTML = "";
      return;
    }
    const set = this.set();
    const abbr = new Map(set.landmarks.map((l) => [l.id, l.abbr]));
    const inView = computeMeasurements(this.kind, r).filter((m) => m.def.view === this.view);
    const rows = inView
      .map((m, i) => {
        // Say what is still missing, frame points included
        const missing = m.value === null ? measurementPoints(m.def).filter((id) => !r.landmarks[id]) : [];
        const value =
          m.value !== null
            ? `${m.value.toFixed(1)} ${m.unit}`
            : missing.length
              ? `<span class="s3-m-missing">manjka: ${missing.map((id) => esc(abbr.get(id) || id)).join(", ")}</span>`
              : "—";
        return `
        <tr>
          <td><span class="s3-swatch" style="background:${measurementColor(i, inView.length)}"></span>${esc(m.def.label)}</td>
          <td class="s3-m-val">${value}</td>
        </tr>`;
      })
      .join("");
    const usesFrame = inView.some((m) => m.def.kind === "component");
    const frameNote = usesFrame
      ? `<p class="form-hint">Meritve griza so razdalje vzdolž okluzalne ravnine. To določijo meziobukalni grbici prvih
          molarjev (pri mlečnem zobovju drugih mlečnih) in zgornja središčnica — te tri točke postavite najprej.</p>`
      : "";
    const unitNote = r.unitConfirmed ? "" : ` <span class="s3-unit-warn">(enota ni preverjena)</span>`;
    this.measurementsEl.innerHTML = `
      <div class="s3-section-head"><h3>Meritve${unitNote}</h3>
        <span class="s3-checks">
          <label class="s3-check"><input type="checkbox" id="s3-show-points" ${r.display.points ? "checked" : ""}/> točke</label>
          <label class="s3-check"><input type="checkbox" id="s3-show-lines" ${r.display.lines ? "checked" : ""}/> črte</label>
        </span>
      </div>
      ${frameNote}
      <table class="s3-m-table"><tbody>${rows}</tbody></table>`;
    for (const [id, key] of [["#s3-show-points", "points"], ["#s3-show-lines", "lines"]] as const) {
      this.measurementsEl.querySelector(id)?.addEventListener("change", (e) => {
        r.display[key] = (e.target as HTMLInputElement).checked;
        this.session.touch();
        this.syncMarkers();
      });
    }
  }


  private setStatus(kind: StatusKind | null, text = ""): void {
    if (!this.statusEl) return;
    if (!kind) {
      this.statusEl.hidden = true;
      return;
    }
    this.statusEl.hidden = false;
    this.statusEl.className = `rtg-status rtg-status-${kind}`;
    this.statusEl.textContent = text;
  }

  private setViewerMessage(text: string | null): void {
    if (!this.viewerMsg) return;
    this.viewerMsg.hidden = !text;
    this.viewerMsg.textContent = text || "";
  }

  // ── Viewer ─────────────────────────────────────────────────────

  /** Make the viewer show the current record's files, loading them if needed. */
  private async ensureViewer(): Promise<void> {
    if (!this.session.hasSession()) return;
    const r = this.record();
    const key = this.recordKey();

    if (r.parts.length === 0) {
      this.missing = [];
      if (this.viewer && this.viewerKey !== key) await this.viewer.loadParts([]);
      this.viewerKey = key;
      return;
    }
    if (this.viewerKey === key && this.missing.length === 0) {
      this.applyView();
      return;
    }
    if (this.busy) return;
    this.busy = true;
    // Another patient: panel part switches belong to the previous one
    if (this.viewerKey.split("|")[0] !== key.split("|")[0]) this.partOverrides.clear();

    try {
      // Files from this visit, else from the device's storage
      const missing: ScanFileRef[] = [];
      for (const ref of allRefs(r)) {
        if (this.blobs.has(ref.sha256)) continue;
        const blob = await this.files.get(ref.sha256);
        if (blob) this.blobs.set(ref.sha256, blob);
        else missing.push(ref);
      }
      this.missing = missing;
      if (this.viewerWrap) this.viewerWrap.hidden = false;

      const ready = r.parts.filter((p) => [p.mesh, ...p.extras].every((f) => this.blobs.has(f.sha256)));
      if (missing.length) {
        this.setStatus(
          "warn",
          `Datoteke skena niso shranjene v tej napravi (${missing.map((f) => f.name).join(", ")}). ` +
            "Izberite jih znova z gumbom »Poišči manjkajoče datoteke« — preverjeno bo, da gre za iste datoteke."
        );
      }

      await this.loadViewer(ready);
      this.viewerKey = key;
    } catch (err) {
      this.setStatus("error", err instanceof Error ? err.message : String(err));
    } finally {
      this.busy = false;
      this.renderFiles();
    }
  }

  private async loadViewer(parts: ScanPart[]): Promise<void> {
    if (!this.viewerHost) return;
    this.setViewerMessage(parts.length ? "Nalagam 3D model ..." : "Ni modela za prikaz.");

    if (!this.viewer) {
      const mod = await import(/* webpackChunkName: "scan3d" */ "../scan3d/viewer");
      this.viewer = new mod.ScanViewer(this.viewerHost);
      this.viewer.onPick = (point) => this.placeActive(point);
    }

    const inputs: ViewerPartInput[] = parts.map((p) => ({
      id: p.id,
      mesh: { name: p.mesh.name, blob: this.blobs.get(p.mesh.sha256) as Blob },
      extras: p.extras.map((x) => ({ name: x.name, blob: this.blobs.get(x.sha256) as Blob })),
    }));
    // Let the "loading" message paint before parsing blocks the page
    await new Promise((resolve) => setTimeout(resolve, 30));
    await this.viewer.loadParts(inputs);
    this.viewer.resize();
    this.applyView();
    this.setViewerMessage(parts.length ? null : "Ni modela za prikaz.");
  }

  /**
   * What is drawn on the model in a panel: points, measurement lines (one per
   * measurement with all its points, coloured by its place in the panel's list
   * so it matches the table's swatch) and tooth labels — as switched on.
   */
  private overlaysFor(view: ScanView, live: boolean): Pick<SnapshotSpec, "markers" | "lines" | "teeth"> {
    const r = this.record();
    const teethMode = live && this.toothMode();
    const markers = landmarksInView(this.set(), view)
      .filter((l) => r.display.points && r.landmarks[l.id])
      .map((l) => ({
        id: l.id,
        abbr: l.abbr,
        position: r.landmarks[l.id],
        active: live && !teethMode && l.id === this.activeLandmark,
      }));
    const defs = this.set().measurements.filter((m) => m.view === view);
    const lines: ViewerLine[] = [];
    if (r.display.lines) {
      defs.forEach((def, i) => {
        const segments = measurementSegments(def, r.landmarks);
        if (segments) lines.push({ segments, color: measurementColor(i, defs.length) });
      });
    }
    const teeth = (r.display.teeth ? toothRowsInView(view, r.stage).flatMap((row) => row.teeth) : [])
      .filter((t) => r.teeth[t])
      .map((t) => ({ id: t, text: t, position: r.teeth[t], active: teethMode && t === this.activeTooth }));
    return { markers, lines, teeth };
  }

  private syncMarkers(): void {
    if (!this.viewer || !this.session.hasSession()) return;
    const o = this.overlaysFor(this.view, true);
    this.viewer.setMarkers(o.markers);
    this.viewer.setLines(o.lines);
    this.viewer.setToothLabels(o.teeth);
    // The report pictures may now be out of date
    this.renderSnapshots();
  }


  /** A tap on the model: place the selected landmark, then move on to the next empty one. */
  private placeActive(point: Vec3): void {
    if (this.session.hasSession() && this.toothMode()) {
      this.placeTooth(point);
      return;
    }
    if (!this.activeLandmark || !this.session.hasSession()) {
      this.setStatus("info", "Najprej na seznamu izberite točko, ki jo želite postaviti.");
      return;
    }
    const r = this.record();
    r.landmarks[this.activeLandmark] = roundCoord(point);
    r.landmarkSet = landmarkSetTag(this.set());
    this.session.touch();

    const list = landmarksInView(this.set(), this.view);
    const from = list.findIndex((l) => l.id === this.activeLandmark);
    const next = [...list.slice(from + 1), ...list.slice(0, from)].find((l) => !r.landmarks[l.id]);
    this.activeLandmark = next ? next.id : null;

    this.setStatus(null);
    this.renderViewBar();
    this.renderLandmarks();
    this.renderMeasurements();
    this.syncMarkers();
    this.landmarksEl?.querySelector(".s3-lm.active")?.scrollIntoView({ block: "nearest" });
  }

  /** A tap in tooth mode: label the selected tooth, then move on along its row. */
  private placeTooth(point: Vec3): void {
    if (!this.activeTooth) {
      this.setStatus("info", "Najprej izberite številko zoba.");
      return;
    }
    const r = this.record();
    const fdi = this.activeTooth;
    const state = this.toothState(fdi);
    let note: string | null = null;
    if (state === "missing") {
      // A tooth on the scan is there: undo "missing" on every tab
      this.session.setToothPresence(Number(fdi) as FdiToothNumber, true);
      note = `Zob ${fdi} je bil označen kot manjkajoč — zdaj je označen kot prisoten na vseh zavihkih.`;
    } else if (state === "other") {
      note = `Zob ${fdi} ima na zavihku ICDAS posebno kodo — preverite, ali drži.`;
    }
    r.teeth[fdi] = roundCoord(point);
    this.session.touch();
    this.activeTooth = this.nextTooth(fdi);
    this.setStatus(note ? "info" : null, note || "");
    this.renderTeeth();
    this.syncMarkers();
  }

  // ── Files ──────────────────────────────────────────────────────

  private async handleFiles(picked: File[]): Promise<void> {
    if (!this.session.hasSession()) {
      this.setStatus("error", NO_SESSION);
      return;
    }
    if (this.busy) return;
    this.busy = true;
    this.setStatus("info", "Preverjam datoteke ...");

    try {
      const hashed: { file: File; ref: ScanFileRef }[] = [];
      for (const file of picked) {
        hashed.push({ file, ref: { name: file.name, size: file.size, sha256: await sha256Hex(file) } });
      }
      const r = this.record();
      if (r.parts.length) await this.relink(r, hashed);
      else await this.createScan(hashed);
    } catch (err) {
      this.setStatus("error", err instanceof Error ? err.message : String(err));
    } finally {
      this.busy = false;
    }
    this.render();
    await this.ensureViewer();
  }

  /** First load: the picked files become the scan. */
  private async createScan(hashed: { file: File; ref: ScanFileRef }[]): Promise<void> {
    let meshes = hashed.filter((h) => MESH_EXTENSIONS.includes(fileExtension(h.file.name)));
    const extras = hashed.filter((h) => {
      const ext = fileExtension(h.file.name);
      return ext === "mtl" || IMAGE_EXTENSIONS.includes(ext);
    });
    if (meshes.length === 0) {
      throw new Error("Med izbranimi datotekami ni 3D modela (.stl, .ply ali .obj).");
    }

    const notes: string[] = [];
    if (this.kind === "head" && meshes.length > 1) {
      // Artec exports the same scan in several formats; prefer the textured OBJ
      const chosen = meshes.find((m) => fileExtension(m.file.name) === "obj") || meshes[0];
      notes.push(`Uporabljena je datoteka ${chosen.file.name}; ostali modeli so prezrti.`);
      meshes = [chosen];
    }

    const parts: ScanPart[] = meshes.map((m, i) => ({
      id: `p${i + 1}`,
      label: "",
      role: guessPartRole(this.kind, m.file.name),
      mesh: m.ref,
      extras: fileExtension(m.file.name) === "obj" ? extras.map((x) => x.ref) : [],
    }));
    relabelParts(this.kind, parts);
    if (this.kind === "intraoral" && !parts.some((p) => p.role === "upper" || p.role === "lower")) {
      notes.push("Iz imen datotek ni razvidno, katera je zgornja in katera spodnja čeljust — vlogo nastavite na pogledu »Okluzija«.");
    }
    if (this.kind === "head" && fileExtension(meshes[0].file.name) === "obj" && extras.length === 0) {
      notes.push("Datoteki .mtl in tekstura nista izbrani — model bo prikazan brez barve.");
    }

    const used = new Set(parts.flatMap((p) => [p.mesh.sha256, ...p.extras.map((x) => x.sha256)]));
    const stored = await this.keep(hashed.filter((h) => used.has(h.ref.sha256)));
    if (!stored) notes.push("Datotek ni bilo mogoče shraniti v napravo (premalo prostora) — ob naslednjem odprtju jih boste morali izbrati znova.");

    const prev = this.record();
    const r = makeEmptyScanRecord(this.kind, prev.stage, prev.cleft);
    r.parts = parts;
    this.session.getScans3D()[this.kind] = r;
    this.session.touch();
    this.partOverrides.clear();
    this.activeLandmark = landmarksInView(this.set(), this.view)[0]?.id || null;

    this.setStatus(notes.length ? "warn" : "ok", notes.length ? notes.join(" ") : "Sken je naložen. Preverite enoto in začnite postavljati točke.");
  }

  /** The scan exists but its files are not on this device: accept only the same files back. */
  private async relink(r: ScanRecord, hashed: { file: File; ref: ScanFileRef }[]): Promise<void> {
    const needed = new Set(allRefs(r).map((f) => f.sha256));
    const matching = hashed.filter((h) => needed.has(h.ref.sha256));
    const foreign = hashed.filter((h) => !needed.has(h.ref.sha256));
    await this.keep(matching);

    const stillMissing = allRefs(r).filter((f) => !this.blobs.has(f.sha256));
    const parts: string[] = [];
    if (matching.length) parts.push(`Najdenih ${matching.length} datotek skena.`);
    if (foreign.length) {
      parts.push(
        `Te datoteke ne pripadajo temu skenu: ${foreign.map((h) => h.file.name).join(", ")}. ` +
          "Za nov sken najprej odstranite obstoječega."
      );
    }
    if (stillMissing.length) parts.push(`Še manjka: ${stillMissing.map((f) => f.name).join(", ")}.`);
    this.setStatus(foreign.length || stillMissing.length ? "warn" : "ok", parts.join(" "));
  }

  /** Remember files for this visit and on the device. False if any could not be stored. */
  private async keep(items: { file: File; ref: ScanFileRef }[]): Promise<boolean> {
    let ok = true;
    for (const h of items) {
      this.blobs.set(h.ref.sha256, h.file);
      if (!(await this.files.put(h.ref.sha256, h.file, h.file.name))) ok = false;
    }
    return ok;
  }

  // ── Helpers ────────────────────────────────────────────────────

  /** Rotate buttons: one step per tap; held down, the model keeps turning. */
  private wireRotateButtons(panel: HTMLElement): void {
    const stepSelect = panel.querySelector("#s3-rot-step") as HTMLSelectElement;
    let delay: ReturnType<typeof setTimeout> | null = null;
    let repeat: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (delay) clearTimeout(delay);
      if (repeat) clearInterval(repeat);
      delay = repeat = null;
    };

    panel.querySelectorAll<HTMLButtonElement>("[data-rot]").forEach((btn) => {
      const axis = btn.dataset.rot as RotateAxis;
      const dir = Number(btn.dataset.dir);
      const rotate = (deg: number) => this.viewer?.rotateModel(axis, dir * deg);

      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        stop();
        rotate(Number(stepSelect.value) || 15);
        delay = setTimeout(() => {
          repeat = setInterval(() => rotate(ROTATE_HOLD_DEGREES), ROTATE_HOLD_EVERY_MS);
        }, ROTATE_HOLD_DELAY_MS);
      });
      for (const ev of ["pointerup", "pointerleave", "pointercancel"]) btn.addEventListener(ev, stop);
      // Keyboard (Enter/Space) activation arrives as a click without a pointer
      btn.addEventListener("click", (e) => {
        if ((e as MouseEvent).detail === 0) rotate(Number(stepSelect.value) || 15);
      });
    });
  }

  /** Two-click confirmation — window.confirm() is unreliable in installed apps. */
  private twoClick(btn: HTMLButtonElement, label: string, action: () => void): void {
    let armed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    btn.addEventListener("click", () => {
      if (!armed) {
        armed = true;
        btn.textContent = "Ste prepričani?";
        btn.classList.add("btn-danger-armed");
        timer = setTimeout(() => {
          armed = false;
          btn.textContent = label;
          btn.classList.remove("btn-danger-armed");
        }, TWO_CLICK_MS);
        return;
      }
      if (timer) clearTimeout(timer);
      armed = false;
      btn.textContent = label;
      btn.classList.remove("btn-danger-armed");
      action();
    });
  }
}
