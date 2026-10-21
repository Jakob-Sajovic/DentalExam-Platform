import { TabController } from "./tab-manager";
import { SessionState } from "../model/session";
import { FdiToothNumber, PBSurface, PBToothData } from "../model/types";
import { PB_SURFACE_TOOLTIPS } from "../model/constants";
import { Dentition, ToothSlot, STORED_TEETH, chartJaws } from "../model/dentition";
import { sessionDentition, sessionTeeth } from "../model/session";
import { createPBToothSvg, getSurfaceForPosition, VisualPosition } from "../dental/chart-renderer";
import { isImplantTooth } from "../model/tooth-status";

type ChartType = "plaque" | "bleeding";

const TOOTH_SVG_SIZE = 32;

export class PlaqueBleedingTabController implements TabController {
  private panel: HTMLElement | null = null;
  private session: SessionState;

  private plaqueScoreEl: HTMLElement | null = null;
  private bleedingScoreEl: HTMLElement | null = null;
  private plaqueContainer: HTMLElement | null = null;
  private bleedingContainer: HTMLElement | null = null;
  /** Dentition the charts were built for; rebuilt when it changes. */
  private builtFor: Dentition | null = null;

  constructor(session: SessionState) {
    this.session = session;
  }

  init(panel: HTMLElement): void {
    this.panel = panel;
    panel.innerHTML = `
      <div class="tab-content-inner">
        <div class="tab-toolbar">
          <button class="btn btn-danger-outline btn-sm" id="pb-reset-btn">Ponastavi VPI/GBI</button>
        </div>
        <div class="chart-section" id="plaque-section">
          <div class="chart-header">
            <span class="chart-title">Plak (VPI)</span>
            <span class="chart-score" id="plaque-score">0.0% (0 od 0)</span>
          </div>
          <div id="plaque-chart"></div>
        </div>
        <div class="chart-section" id="bleeding-section">
          <div class="chart-header">
            <span class="chart-title">Krvavitev (GBI)</span>
            <span class="chart-score" id="bleeding-score">0.0% (0 od 0)</span>
          </div>
          <div id="bleeding-chart"></div>
        </div>
        <p class="tab-help-footer">
          Kliknite na površino zoba za označitev plaka ali krvavitve. Z gumbom ✕ nad/pod karto označite zob kot manjkajoč.
        </p>
      </div>
    `;

    // Reset button with two-click confirmation
    const resetBtn = panel.querySelector("#pb-reset-btn") as HTMLButtonElement;
    if (resetBtn) {
      let armed = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      resetBtn.addEventListener("click", () => {
        if (!armed) {
          armed = true;
          resetBtn.textContent = "Ste prepričani?";
          resetBtn.classList.add("btn-danger-armed");
          timer = setTimeout(() => { armed = false; resetBtn.textContent = "Ponastavi VPI/GBI"; resetBtn.classList.remove("btn-danger-armed"); }, 3000);
        } else {
          if (timer) clearTimeout(timer);
          armed = false;
          resetBtn.textContent = "Ponastavi VPI/GBI";
          resetBtn.classList.remove("btn-danger-armed");
          this.handleReset();
        }
      });
    }

    this.plaqueScoreEl = panel.querySelector("#plaque-score") as HTMLElement;
    this.bleedingScoreEl = panel.querySelector("#bleeding-score") as HTMLElement;
    this.plaqueContainer = panel.querySelector("#plaque-chart") as HTMLElement;
    this.bleedingContainer = panel.querySelector("#bleeding-chart") as HTMLElement;

    this.buildCharts("permanent");

    // Event delegation for surface clicks
    this.plaqueContainer.addEventListener("click", (e) => this.handleSurfaceClick(e, "plaque"));
    this.bleedingContainer.addEventListener("click", (e) => this.handleSurfaceClick(e, "bleeding"));

    // Missing tooth buttons (click handler via delegation)
    this.plaqueContainer.addEventListener("click", (e) => this.handleMissingBtnClick(e));
  }

  onActivate(): void {
    if (!this.session.hasSession()) return;
    const d = sessionDentition(this.session.getSession());
    if (d !== this.builtFor) this.buildCharts(d);
    this.refreshAllSurfaces();
    this.updateScores();
  }

  onDeactivate(): void {
    // Data is written immediately on click
  }

  private buildCharts(d: Dentition): void {
    this.builtFor = d;
    if (this.plaqueContainer) this.buildChart(this.plaqueContainer, "plaque", d);
    if (this.bleedingContainer) this.buildChart(this.bleedingContainer, "bleeding", d);
  }

  private buildChart(container: HTMLElement, chartType: ChartType, d: Dentition): void {
    container.innerHTML = "";
    const jaws = chartJaws(d);
    if (!jaws.length) {
      container.innerHTML = `<p class="form-hint">Dojenček brez zob — ni zob za oceno (zobovje nastavite na zavihku Preiskovanec).</p>`;
      return;
    }
    // Upper rows: 18…11 | 21…28; lower rows mirrored: 48…41 | 31…38. Primary
    // rows keep the 16 columns, with their teeth under the permanent successors.
    for (const j of jaws) this.buildJaw(container, j.slots, j.jaw, chartType, jaws.length > 2 ? j.label : "");
  }

  private buildJaw(
    container: HTMLElement,
    allTeeth: ToothSlot[],
    jaw: "upper" | "lower",
    chartType: ChartType,
    caption: string
  ): void {
    const jawDiv = document.createElement("div");
    jawDiv.className = "chart-jaw";
    if (caption) {
      const cap = document.createElement("div");
      cap.className = "chart-jaw-caption";
      cap.textContent = caption;
      jawDiv.appendChild(cap);
    }

    if (jaw === "upper") {
      if (chartType === "plaque") jawDiv.appendChild(this.createMissingBtnRow(allTeeth));
      jawDiv.appendChild(this.createToothRow(allTeeth, chartType));
      jawDiv.appendChild(this.createNumberRow(allTeeth));
    } else {
      jawDiv.appendChild(this.createNumberRow(allTeeth));
      jawDiv.appendChild(this.createToothRow(allTeeth, chartType));
      if (chartType === "plaque") jawDiv.appendChild(this.createMissingBtnRow(allTeeth));
    }

    container.appendChild(jawDiv);
  }

  private createToothRow(teeth: ToothSlot[], chartType: ChartType): HTMLElement {
    const row = document.createElement("div");
    row.className = "chart-row";

    for (const tooth of teeth) {
      if (tooth === null) {
        row.appendChild(emptySlot("tooth-cell slot-empty"));
        continue;
      }
      const cell = document.createElement("div");
      cell.className = "tooth-cell";
      cell.dataset.tooth = String(tooth);
      cell.dataset.chartType = chartType;

      const svg = createPBToothSvg(tooth, TOOTH_SVG_SIZE);

      // Add tooltip to each surface polygon
      const polygons = svg.querySelectorAll(".tooth-surface");
      polygons.forEach((poly) => {
        const position = (poly as SVGElement).dataset.position as VisualPosition;
        const surface = getSurfaceForPosition(tooth, position);
        (poly as SVGElement).dataset.surface = surface;
        const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
        title.textContent = `${tooth} ${PB_SURFACE_TOOLTIPS[surface]}`;
        poly.appendChild(title);
      });

      cell.appendChild(svg);
      row.appendChild(cell);
    }

    return row;
  }

  private createNumberRow(teeth: ToothSlot[]): HTMLElement {
    const row = document.createElement("div");
    row.className = "chart-number-row";

    for (const tooth of teeth) {
      if (tooth === null) {
        row.appendChild(emptySlot("tooth-number"));
        continue;
      }
      const num = document.createElement("div");
      num.className = "tooth-number";
      num.textContent = String(tooth);
      row.appendChild(num);
    }

    return row;
  }

  private handleSurfaceClick(e: Event, chartType: ChartType): void {
    if (!this.session.hasSession()) return;

    const target = e.target as SVGElement;
    if (!target.classList.contains("tooth-surface")) return;

    const toothStr = target.dataset.tooth;
    const position = target.dataset.position as VisualPosition;
    if (!toothStr || !position) return;

    const tooth = parseInt(toothStr, 10) as FdiToothNumber;
    const surface = getSurfaceForPosition(tooth, position);

    const data = chartType === "plaque"
      ? this.session.getPlaque()
      : this.session.getBleeding();

    const toothData = data[tooth];
    if (!toothData.present) return; // Missing tooth — ignore

    // Toggle the surface
    toothData[surface] = !toothData[surface];
    this.session.touch();

    // Update visual
    const activeClass = chartType === "plaque" ? "active-plaque" : "active-bleeding";
    target.classList.toggle(activeClass, toothData[surface]);

    this.updateScores();
  }

  private createMissingBtnRow(teeth: ToothSlot[]): HTMLElement {
    const row = document.createElement("div");
    row.className = "chart-number-row pb-missing-row";

    for (const tooth of teeth) {
      if (tooth === null) {
        row.appendChild(emptySlot("pb-missing-btn slot-empty"));
        continue;
      }
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pb-missing-btn";
      btn.dataset.tooth = String(tooth);
      btn.textContent = "✕";
      btn.title = `Označi zob ${tooth} kot manjkajoč`;
      row.appendChild(btn);
    }

    return row;
  }

  private handleMissingBtnClick(e: Event): void {
    if (!this.session.hasSession()) return;
    const target = e.target as HTMLElement;
    if (!target.classList.contains("pb-missing-btn")) return;

    const toothStr = target.dataset.tooth;
    if (!toothStr) return;
    const tooth = parseInt(toothStr, 10) as FdiToothNumber;

    const newPresent = !this.session.getPlaque()[tooth].present;
    this.session.setToothPresence(tooth, newPresent);

    this.refreshAllSurfaces();
    this.updateScores();
  }

  private clearToothSurfaces(toothData: PBToothData): void {
    toothData.mesial = false;
    toothData.distal = false;
    toothData.buccal = false;
    toothData.lingual = false;
  }

  private refreshAllSurfaces(): void {
    if (!this.session.hasSession()) return;

    this.refreshChart(this.plaqueContainer, "plaque");
    this.refreshChart(this.bleedingContainer, "bleeding");
  }

  private refreshChart(container: HTMLElement | null, chartType: ChartType): void {
    if (!container) return;

    const data = chartType === "plaque"
      ? this.session.getPlaque()
      : this.session.getBleeding();

    const activeClass = chartType === "plaque" ? "active-plaque" : "active-bleeding";
    const icdas = this.session.getIcdas();

    // Update tooth cells (missing / implant state)
    const cells = container.querySelectorAll(".tooth-cell[data-tooth]") as NodeListOf<HTMLElement>;
    cells.forEach((cell) => {
      const tooth = parseInt(cell.dataset.tooth || "0", 10) as FdiToothNumber;
      const toothData = data[tooth];
      const implant = isImplantTooth(icdas[tooth]);
      cell.classList.toggle("missing", !toothData.present);
      cell.classList.toggle("implant", implant);
      cell.title = implant ? `Zob ${tooth}: vsadek (ICDAS ${icdas[tooth].specialCode})` : "";
    });

    // Update surface polygons
    const polygons = container.querySelectorAll(".tooth-surface") as NodeListOf<SVGElement>;
    polygons.forEach((poly) => {
      const tooth = parseInt(poly.dataset.tooth || "0", 10) as FdiToothNumber;
      const surface = poly.dataset.surface as PBSurface;
      const toothData = data[tooth];
      poly.classList.toggle(activeClass, toothData[surface]);
    });

    // Update missing buttons (plaque chart only)
    if (chartType === "plaque") {
      const btns = container.querySelectorAll(".pb-missing-btn[data-tooth]") as NodeListOf<HTMLElement>;
      btns.forEach((btn) => {
        const tooth = parseInt(btn.dataset.tooth || "0", 10) as FdiToothNumber;
        btn.classList.toggle("active", !data[tooth].present);
      });
    }
  }

  private updateScores(): void {
    if (!this.session.hasSession()) return;

    this.updateScore(this.session.getPlaque(), this.plaqueScoreEl);
    this.updateScore(this.session.getBleeding(), this.bleedingScoreEl);
  }

  private handleReset(): void {
    if (!this.session.hasSession()) return;

    const plaque = this.session.getPlaque();
    const bleeding = this.session.getBleeding();
    for (const t of STORED_TEETH) {
      plaque[t] = { present: true, mesial: false, distal: false, buccal: false, lingual: false };
      bleeding[t] = { present: true, mesial: false, distal: false, buccal: false, lingual: false };
    }
    this.session.touch();
    this.refreshAllSurfaces();
    this.updateScores();
  }

  private updateScore(
    data: Record<FdiToothNumber, PBToothData>,
    scoreEl: HTMLElement | null
  ): void {
    if (!scoreEl) return;

    let totalSurfaces = 0;
    let activeSurfaces = 0;

    const surfaces: PBSurface[] = ["mesial", "distal", "buccal", "lingual"];

    // Only the teeth charted for this dentition count
    for (const t of sessionTeeth(this.session.getSession())) {
      const toothData = data[t];
      if (!toothData.present) continue;

      for (const s of surfaces) {
        totalSurfaces++;
        if (toothData[s]) activeSurfaces++;
      }
    }

    const pct = totalSurfaces > 0
      ? ((activeSurfaces / totalSurfaces) * 100).toFixed(1)
      : "0.0";

    scoreEl.textContent = `${pct}% (${activeSurfaces} od ${totalSurfaces} površin)`;
  }
}

/** A chart column with no tooth (primary rows have no molars 6–8). */
function emptySlot(className: string): HTMLElement {
  const el = document.createElement("div");
  el.className = className;
  el.setAttribute("aria-hidden", "true");
  return el;
}
