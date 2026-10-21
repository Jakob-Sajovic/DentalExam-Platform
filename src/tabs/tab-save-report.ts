import { TabController } from "./tab-manager";
import { SessionState } from "../model/session";
import { FdiToothNumber, PBSurface, PBToothData, ICDASData, ExaminationSession } from "../model/types";
import { isImplantTooth, isToothMissing } from "../model/tooth-status";
import { PROBING_ALL_SITES } from "../model/constants";
import { sessionTeeth } from "../model/dentition";
import { SessionStore } from "../storage/session-store";
import { ExcelStore } from "../storage/excel-store";
import { generateReport } from "../report/report-generator";
import { openReportLayer } from "../report/report-layer";
import { radiographIssueText } from "../model/radiographs";

export class SaveReportTabController implements TabController {
  private panel: HTMLElement | null = null;
  private session: SessionState;
  private summaryContainer: HTMLElement | null = null;
  private saveBtn: HTMLButtonElement | null = null;
  private reportBtn: HTMLButtonElement | null = null;
  private statusMsg: HTMLElement | null = null;
  private store: SessionStore;

  constructor(session: SessionState, store?: SessionStore) {
    this.session = session;
    this.store = store || new ExcelStore();
  }

  init(panel: HTMLElement): void {
    this.panel = panel;
    panel.innerHTML = `
      <div class="tab-content-inner">
        <h2>Shrani in poročilo</h2>
        <div id="save-summary"></div>
        <div id="save-status" class="form-hint" style="text-align:center; margin:8px 0; min-height:18px;"></div>
        <div style="display:flex; flex-direction:column; gap:12px; margin-top:12px;">
          <button id="btn-save-excel" class="btn btn-primary btn-large">
            <span class="btn-icon">${this.store.saveAction.icon}</span>
            ${this.store.saveAction.label}
          </button>
          <button id="btn-generate-pdf" class="btn btn-secondary btn-large">
            <span class="btn-icon">📄</span>
            Ustvari PDF
          </button>
        </div>
        <p class="tab-help-footer">${this.store.saveHelp}</p>
      </div>
    `;

    this.summaryContainer = panel.querySelector("#save-summary") as HTMLElement;
    this.saveBtn = panel.querySelector("#btn-save-excel") as HTMLButtonElement;
    this.reportBtn = panel.querySelector("#btn-generate-pdf") as HTMLButtonElement;
    this.statusMsg = panel.querySelector("#save-status") as HTMLElement;

    this.saveBtn.addEventListener("click", () => this.handleSave());
    this.reportBtn.addEventListener("click", () => this.handleReport());
  }

  onActivate(): void {
    if (!this.session.hasSession()) {
      if (this.summaryContainer) {
        this.summaryContainer.innerHTML = `<p class="placeholder-text">Ni aktivnega pregleda.</p>`;
      }
      this.setButtonsEnabled(false);
      return;
    }

    this.setButtonsEnabled(true);
    this.renderSummary();
    if (this.statusMsg) this.statusMsg.textContent = "";
  }

  onDeactivate(): void {
    // Nothing to save
  }

  private setButtonsEnabled(enabled: boolean): void {
    if (this.saveBtn) this.saveBtn.disabled = !enabled;
    if (this.reportBtn) this.reportBtn.disabled = !enabled;
  }

  private async handleSave(): Promise<void> {
    if (!this.session.hasSession()) return;

    this.setButtonsEnabled(false);
    if (this.statusMsg) {
      this.statusMsg.textContent = "Shranjevanje ...";
      this.statusMsg.style.color = "#605e5c";
    }

    try {
      const message = await this.store.save(this.session.getSession());
      if (this.statusMsg) {
        this.statusMsg.textContent = message;
        this.statusMsg.style.color = "#0b6a0b";
      }
    } catch (err) {
      if (this.statusMsg) {
        this.statusMsg.textContent = `Napaka: ${err instanceof Error ? err.message : String(err)}`;
        this.statusMsg.style.color = "#a4262c";
      }
    } finally {
      this.setButtonsEnabled(true);
    }
  }

  private handleReport(): void {
    if (!this.session.hasSession()) return;

    // The PWA (the store with local sessions) shows the report in-app and builds
    // the PDF itself — window.open and window.print() both fail in an installed
    // iOS app. The add-in keeps its print window.
    if (this.store.local) {
      openReportLayer(this.session.getSession());
      if (this.statusMsg) this.statusMsg.textContent = "";
      return;
    }

    try {
      generateReport(this.session.getSession());
      if (this.statusMsg) {
        this.statusMsg.textContent = "Poročilo ustvarjeno v novem oknu. Uporabite Ctrl+P za tisk ali shranjevanje v PDF.";
        this.statusMsg.style.color = "#0b6a0b";
      }
    } catch (err) {
      if (this.statusMsg) {
        this.statusMsg.textContent = `Napaka: ${err instanceof Error ? err.message : String(err)}`;
        this.statusMsg.style.color = "#a4262c";
      }
    }
  }

  private renderSummary(): void {
    if (!this.summaryContainer) return;

    const s = this.session.getSession();
    const patient = s.patient;

    const patientName = (patient.firstName && patient.lastName)
      ? `${patient.firstName} ${patient.lastName}`
      : (patient.code || "—");

    const examiner = s.examiner || { firstName: "", lastName: "" };
    const examinerName = (examiner.firstName && examiner.lastName)
      ? `${examiner.firstName} ${examiner.lastName}`
      : "—";

    const teethCount = this.calcTeethCount(s);
    const vpiScore = this.calcPBScore(s.plaque);
    const gbiScore = this.calcPBScore(s.bleeding);
    const bopScore = this.calcBOPScore(s);
    const icdasSummary = this.calcICDASSummary(s.icdas);

    let ohipTotal = 0;
    let ohipAnswered = 0;
    for (const val of s.ohip) {
      if (val !== null) {
        ohipTotal += val;
        ohipAnswered++;
      }
    }

    const diagPreview = s.notes.diagnosticNotes
      ? s.notes.diagnosticNotes.substring(0, 100) + (s.notes.diagnosticNotes.length > 100 ? "..." : "")
      : "—";
    const qualPreview = s.notes.qualitativeNotes
      ? s.notes.qualitativeNotes.substring(0, 100) + (s.notes.qualitativeNotes.length > 100 ? "..." : "")
      : "—";

    this.summaryContainer.innerHTML = `
      <div class="summary-card">
        <div class="summary-card-title">Preiskovanec</div>
        <div class="summary-card-content">
          <span class="label">Datum:</span> ${patient.date || "—"}<br>
          <span class="label">Pregled:</span> ${patient.checkup || 1}. pregled<br>
          <span class="label">Preiskovanec:</span> ${this.escapeHtml(patientName)}<br>
          ${patient.code ? `<span class="label">Koda:</span> ${this.escapeHtml(patient.code)}<br>` : ""}
          <span class="label">Izvajalec:</span> ${this.escapeHtml(examinerName)}
        </div>
      </div>

      <div class="summary-card">
        <div class="summary-card-title">Zobje</div>
        <div class="summary-card-content">
          <span class="label">Prisotni:</span> ${teethCount.present} / 32<br>
          <span class="label">Manjkajoči:</span> ${teethCount.missing}
        </div>
      </div>

      <div class="summary-card">
        <div class="summary-card-title">VPI (Plak)</div>
        <div class="summary-card-content">
          ${vpiScore.pct}% (${vpiScore.active} od ${vpiScore.total} površin)
        </div>
      </div>

      <div class="summary-card">
        <div class="summary-card-title">GBI (Krvavitev)</div>
        <div class="summary-card-content">
          ${gbiScore.pct}% (${gbiScore.active} od ${gbiScore.total} površin)
        </div>
      </div>

      <div class="summary-card">
        <div class="summary-card-title">BOP (Krvavitev ob sondiranju)</div>
        <div class="summary-card-content">
          ${bopScore.pct}% (${bopScore.active} od ${bopScore.total} mest)
        </div>
      </div>

      <div class="summary-card">
        <div class="summary-card-title">ICDAS</div>
        <div class="summary-card-content">
          <span class="label">Ocenjenih zob:</span> ${icdasSummary.assessed} / 32<br>
          <span class="label">Posebni primeri:</span> ${icdasSummary.special}<br>
          <span class="label">Površin s kariesom:</span> ${icdasSummary.cariesSurfaces}<br>
          <span class="label">Površin z restavracijo:</span> ${icdasSummary.restoredSurfaces}
        </div>
      </div>

      <div class="summary-card">
        <div class="summary-card-title">Opombe</div>
        <div class="summary-card-content">
          <span class="label">Diagnostične:</span> ${this.escapeHtml(diagPreview)}<br>
          <span class="label">Kvalitativne:</span> ${this.escapeHtml(qualPreview)}
        </div>
      </div>

      ${this.buildRadiographSummaryCard()}

      <div class="summary-card">
        <div class="summary-card-title">OHIP-49</div>
        <div class="summary-card-content">
          Skupaj: ${ohipTotal} / 196 (${ohipAnswered}/49 odgovorov)
        </div>
      </div>

      ${this.buildFdiSummaryCard(s)}
    `;
  }

  private buildRadiographSummaryCard(): string {
    const rg = this.session.getRadiographs();
    let body: string;
    if (rg.mode === "composite") {
      body = `Ena sestavljena slika: ${rg.composite ? "naložena" : "ni naložena"}`;
    } else if (rg.mode === "partial") {
      const films = (list: typeof rg.upper) => list.filter((f) => !f.skip).length;
      body = `Delni posnetki — zgoraj: ${films(rg.upper)}, spodaj: ${films(rg.lower)}`;
    } else {
      body = "Ni vnosa";
    }
    // Not blocking: the operator can still save, but sees what is missing
    const issue = radiographIssueText(rg);
    const warning = issue
      ? `<br><span style="color:#a4262c; font-weight:600;">⚠ ${this.escapeHtml(issue)}</span>`
      : "";
    return `
      <div class="summary-card">
        <div class="summary-card-title">Rentgenske slike</div>
        <div class="summary-card-content">${body}${warning}</div>
      </div>`;
  }

  private calcPBScore(data: Record<FdiToothNumber, PBToothData>): {
    pct: string;
    active: number;
    total: number;
  } {
    let total = 0;
    let active = 0;
    const surfaces: PBSurface[] = ["mesial", "distal", "buccal", "lingual"];

    for (const tooth of Object.keys(data)) {
      const t = parseInt(tooth, 10) as FdiToothNumber;
      const td = data[t];
      if (!td.present) continue;
      for (const s of surfaces) {
        total++;
        if (td[s]) active++;
      }
    }

    const pct = total > 0 ? ((active / total) * 100).toFixed(1) : "0.0";
    return { pct, active, total };
  }

  private calcBOPScore(s: ExaminationSession): {
    pct: string;
    active: number;
    total: number;
  } {
    let total = 0;
    let active = 0;

    if (s.bop && s.probing) {
      for (const tooth of Object.keys(s.probing)) {
        const t = parseInt(tooth, 10) as FdiToothNumber;
        if (!s.probing[t].present) continue;
        for (const site of PROBING_ALL_SITES) {
          total++;
          if ((s.bop[t] as Record<string, boolean>)[site]) active++;
        }
      }
    }

    const pct = total > 0 ? ((active / total) * 100).toFixed(1) : "0.0";
    return { pct, active, total };
  }

  private calcICDASSummary(data: ICDASData): {
    assessed: number;
    special: number;
    cariesSurfaces: number;
    restoredSurfaces: number;
  } {
    let assessed = 0;
    let special = 0;
    let cariesSurfaces = 0;
    let restoredSurfaces = 0;

    for (const tooth of sessionTeeth(this.session.getSession())) {
      const td = data[tooth];
      if (td.status === "special" && !isImplantTooth(td)) {
        if (td.specialCode !== null) assessed++;
        special++;
      } else {
        if (isImplantTooth(td)) special++;
        let hasData = false;
        for (const surf of Object.values(td.surfaces)) {
          if (surf.restoration !== null || surf.caries !== null) hasData = true;
          if (surf.caries !== null && surf.caries > 0) cariesSurfaces++;
          if (surf.restoration !== null && surf.restoration > 0) restoredSurfaces++;
        }
        if (hasData) assessed++;
      }
    }

    return { assessed, special, cariesSurfaces, restoredSurfaces };
  }

  private calcTeethCount(s: ExaminationSession): { present: number; missing: number } {
    let missing = 0;
    const teeth = sessionTeeth(s);
    for (const tooth of teeth) {
      // ICDAS special case (except 96), or absent on any chart; implants count as missing
      if (isToothMissing(s, tooth)) missing++;
    }
    return { present: teeth.length - missing, missing };
  }

  private buildFdiSummaryCard(s: ExaminationSession): string {
    const fdi = s.fdiQuestionnaire;
    if (!fdi) return "";

    const labels: Record<string, Record<string, string>> = {
      gender: { male: "Moški", female: "Ženski", rather_not_say: "Ne želim odgovoriti" },
      age: { lt35: "< 35", "35to44": "35–44", "45to64": "45–64", gt64: "> 64" },
      smoking: { no: "Ne", lt10: "< 10/dan", "10to15": "10–15/dan", gt15: "> 15/dan" },
      diabetes: { no: "Ne", well_controlled: "Urejen", poorly_controlled: "Neurejen" },
      toothLoss: { no: "Ne", yes: "Da" },
      plaque: { lt10: "< 10%", "10to50": "10–50%", gt50: "> 50%" },
      bleeding: { lt10: "< 10%", "10to50": "10–50%", gt50: "> 50%" },
      probingDepth: { lt4: "< 4 mm", "4to5": "4–5 mm", localized_gt5: "Lokalizirano > 5 mm", generalized_gt5: "Generalizirano > 5 mm" },
    };

    const items: { label: string; key: string }[] = [
      { label: "Spol", key: "gender" },
      { label: "Starost", key: "age" },
      { label: "Kajenje", key: "smoking" },
      { label: "Diabetes", key: "diabetes" },
      { label: "Izguba zob", key: "toothLoss" },
      { label: "Obloge", key: "plaque" },
      { label: "Krvavitev", key: "bleeding" },
      { label: "Glob. sondiranja", key: "probingDepth" },
    ];

    let answered = 0;
    let content = "";
    for (const item of items) {
      const val = fdi[item.key as keyof typeof fdi] as string | null;
      if (val) answered++;
      const display = val ? (labels[item.key]?.[val] || val) : "—";
      content += `<span class="label">${item.label}:</span> ${this.escapeHtml(display)}<br>`;
    }

    return `
      <div class="summary-card">
        <div class="summary-card-title">FDI vprašalnik</div>
        <div class="summary-card-content">
          ${content}
          <span class="label">Odgovorjeno:</span> ${answered}/8
        </div>
      </div>`;
  }

  private escapeHtml(str: string): string {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }
}
