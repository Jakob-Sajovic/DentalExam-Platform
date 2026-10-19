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
  LANDMARK_SETS,
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
} from "../model/scans3d";
import { ScanFileStore } from "../storage/scan-file-store";
import type { ScanViewer, ViewerPartInput, ViewAxis, CameraState, RotateAxis } from "../scan3d/viewer";

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

type StatusKind = "info" | "ok" | "warn" | "error";

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
        </div>
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
          meritvami: zgornjo čeljust, spodnjo čeljust in okluzijo.
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
    this.activeLandmark = null;
  }

  // ── State helpers ──────────────────────────────────────────────

  private record(): ScanRecord {
    return this.session.getScans3D()[this.kind];
  }

  private recordKey(): string {
    if (!this.session.hasSession()) return "";
    const r = this.record();
    return `${this.session.getSession().sessionId}|${this.kind}|${allRefs(r).map((f) => f.sha256).join(",")}`;
  }

  // ── Rendering ──────────────────────────────────────────────────

  private render(): void {
    if (!this.session.hasSession()) {
      this.renderKindBar();
      this.setStatus("info", NO_SESSION);
      if (this.filesEl) this.filesEl.innerHTML = "";
      if (this.viewerWrap) this.viewerWrap.hidden = true;
      if (this.landmarksEl) this.landmarksEl.innerHTML = "";
      if (this.measurementsEl) this.measurementsEl.innerHTML = "";
      if (this.noteEl) this.noteEl.value = "";
      return;
    }
    this.renderKindBar();
    this.renderViewBar();
    this.renderFiles();
    this.renderLandmarks();
    this.renderMeasurements();
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
        this.saveCamera();
        this.kind = k;
        this.view = this.viewByKind[k];
        this.activeLandmark = null;
        this.setStatus(null);
        this.render();
        void this.ensureViewer();
      });
    });
  }

  private renderViewBar(): void {
    if (!this.viewBar) return;
    const views = SCAN_VIEWS[this.kind];
    const r = this.record();
    this.viewBar.hidden = views.length < 2 || r.parts.length === 0;
    if (this.viewBar.hidden) return;
    this.viewBar.innerHTML = views
      .map((v) => {
        const list = landmarksInView(this.kind, v);
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
    this.activeLandmark = landmarksInView(this.kind, v).find((l) => !r.landmarks[l.id])?.id || null;
    this.setStatus(null);
    this.renderViewBar();
    this.renderFiles();
    this.renderLandmarks();
    this.renderMeasurements();
    this.applyView();
  }

  /** Parts that belong in the current panel, and whether each is switched on. */
  private partsInView(): { part: ScanPart; role: PartRole; visible: boolean }[] {
    const over = this.partOverrides.get(this.view);
    const out: { part: ScanPart; role: PartRole; visible: boolean }[] = [];
    for (const part of this.record().parts) {
      const role = partRole(this.kind, part);
      const rule = partInView(role, this.view);
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
        this.session.getScans3D()[this.kind] = makeEmptyScanRecord(this.kind);
        this.session.touch();
        this.missing = [];
        this.activeLandmark = null;
        this.partOverrides.clear();
        this.setStatus("info", "Sken in njegove točke so odstranjeni s pregleda.");
        this.render();
        void this.ensureViewer();
      });
    }
  }

  private renderLandmarks(): void {
    if (!this.landmarksEl) return;
    const r = this.record();
    const set = LANDMARK_SETS[this.kind];
    if (r.parts.length === 0) {
      this.landmarksEl.innerHTML = "";
      return;
    }

    const notices: string[] = [];
    if (set.draft) {
      notices.push(`<div class="rtg-status rtg-status-info">Seznam točk je <b>osnutek</b> — dokončen bo po dogovoru s kliničnim timom.</div>`);
    }
    if (r.landmarkSet !== landmarkSetTag(set) && Object.keys(r.landmarks).length) {
      notices.push(`<div class="rtg-status rtg-status-warn">Točke so bile postavljene s seznamom ${esc(r.landmarkSet)}, trenutni seznam je ${esc(landmarkSetTag(set))}.</div>`);
    }

    const list = landmarksInView(this.kind, this.view);
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
        <h3>Točke${SCAN_VIEWS[this.kind].length > 1 ? ` — ${esc(SCAN_VIEW_LABELS[this.view].toLowerCase())}` : ""}
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

  private renderMeasurements(): void {
    if (!this.measurementsEl) return;
    const r = this.record();
    if (r.parts.length === 0) {
      this.measurementsEl.innerHTML = "";
      return;
    }
    const rows = computeMeasurements(this.kind, r)
      .filter((m) => m.def.view === this.view)
      .map(
        (m) => `
        <tr>
          <td>${esc(m.def.label)}</td>
          <td class="s3-m-val">${m.value === null ? "—" : `${m.value.toFixed(1)} ${m.unit}`}</td>
        </tr>`
      )
      .join("");
    const unitNote = r.unitConfirmed ? "" : ` <span class="s3-unit-warn">(enota ni preverjena)</span>`;
    this.measurementsEl.innerHTML = `
      <div class="s3-section-head"><h3>Meritve${unitNote}</h3></div>
      <table class="s3-m-table"><tbody>${rows}</tbody></table>`;
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

  private syncMarkers(): void {
    if (!this.viewer || !this.session.hasSession()) return;
    const r = this.record();
    this.viewer.setMarkers(
      landmarksInView(this.kind, this.view)
        .filter((l) => r.landmarks[l.id])
        .map((l) => ({ id: l.id, abbr: l.abbr, position: r.landmarks[l.id], active: l.id === this.activeLandmark }))
    );
  }

  /** A tap on the model: place the selected landmark, then move on to the next empty one. */
  private placeActive(point: Vec3): void {
    if (!this.activeLandmark || !this.session.hasSession()) {
      this.setStatus("info", "Najprej na seznamu izberite točko, ki jo želite postaviti.");
      return;
    }
    const r = this.record();
    r.landmarks[this.activeLandmark] = roundCoord(point);
    r.landmarkSet = landmarkSetTag(LANDMARK_SETS[this.kind]);
    this.session.touch();

    const list = landmarksInView(this.kind, this.view);
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

    const r = makeEmptyScanRecord(this.kind);
    r.parts = parts;
    this.session.getScans3D()[this.kind] = r;
    this.session.touch();
    this.partOverrides.clear();
    this.activeLandmark = landmarksInView(this.kind, this.view)[0]?.id || null;

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
