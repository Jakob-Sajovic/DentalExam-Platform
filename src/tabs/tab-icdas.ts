import { TabController } from "./tab-manager";
import { SessionState } from "../model/session";
import {
  FdiToothNumber,
  ICDASSurface,
  RestorationCode,
  CariesCode,
  SpecialCaseCode,
  ProbingSite,
  ICDASRootCariesScore,
} from "../model/types";
import {
  RESTORATION_LABELS,
  CARIES_LABELS,
  SPECIAL_CASE_LABELS,
  ICDAS_SURFACE_LABELS,
  ICDAS_SURFACE_FULL_NAMES,
  PROBING_BUCCAL_SITES,
  PROBING_LINGUAL_SITES,
  PROBING_SITE_LABELS,
  PROBING_ALL_SITES,
} from "../model/constants";
import { Dentition, ToothSlot, STORED_TEETH, chartJaws } from "../model/dentition";
import { sessionDentition } from "../model/session";
import {
  createICDASToothSvg,
  getICDASSurfaceForPosition,
  ICDASVisualPosition,
} from "../dental/chart-renderer";
import { isImplantCode, isImplantTooth } from "../model/tooth-status";

const TOOTH_SVG_SIZE = 32;
const ICDAS_SURFACES: ICDASSurface[] = ["mesial", "distal", "buccal", "lingual", "occlusal"];

export class ICDASTabController implements TabController {
  private panel: HTMLElement | null = null;
  private session: SessionState;
  private chartContainer: HTMLElement | null = null;
  private detailPanel: HTMLElement | null = null;
  private rootCariesContainer: HTMLElement | null = null;
  private selectedTooth: FdiToothNumber | null = null;
  /** Dentition the chart was built for; rebuilt when it changes. */
  private builtFor: Dentition | null = null;

  constructor(session: SessionState) {
    this.session = session;
  }

  init(panel: HTMLElement): void {
    this.panel = panel;

    panel.innerHTML = `
      <div class="tab-content-inner">
        <h2>ICDAS ocena</h2>
        <div class="tab-toolbar">
          <button class="btn btn-danger-outline btn-sm" id="icdas-reset-btn">Ponastavi ICDAS</button>
        </div>
        <p class="icdas-help-text">
          Kliknite na zob za vnos kod restavracij in kariesa.
          Vsak zob ima 5 površin (M, D, V, O, Ok) z dvema kodama.
        </p>
        <div id="icdas-chart"></div>
        <div id="icdas-detail"></div>
        <div id="icdas-root-caries-section" style="margin-top:24px;">
          <h2>Koreninski karies</h2>
          <p class="icdas-help-text">
            Ocena koreninskega kariesa na zobeh (6 mest na zob). Samo za zobje brez posebnega primera.
            0 = brez kariesa, 1 = začetna lezija, 2 = kavitirana lezija.
          </p>
          <div id="icdas-root-caries-content"></div>
        </div>
        <p class="tab-help-footer">
          Kliknite na zob v karti za prikaz podrobnosti. Za vsako površino izberite kodo zobne površine in kariozne spremembe. Za posebne primere (manjkajoč, neizrasel ipd.) izberite "Poseben primer" v spustnem seznamu.
        </p>
      </div>
    `;

    this.chartContainer = panel.querySelector("#icdas-chart") as HTMLElement;
    this.detailPanel = panel.querySelector("#icdas-detail") as HTMLElement;
    this.rootCariesContainer = panel.querySelector("#icdas-root-caries-content") as HTMLElement;

    this.buildChart("permanent");
    this.buildICDASRootCariesUI("permanent");
    this.wireRootCaries();

    // Event delegation for tooth clicks
    this.chartContainer.addEventListener("click", (e) => this.handleChartClick(e));

    // Reset button with two-click confirmation
    const resetBtn = panel.querySelector("#icdas-reset-btn") as HTMLButtonElement;
    if (resetBtn) {
      let armed = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      resetBtn.addEventListener("click", () => {
        if (!armed) {
          armed = true;
          resetBtn.textContent = "Ste prepričani?";
          resetBtn.classList.add("btn-danger-armed");
          timer = setTimeout(() => { armed = false; resetBtn.textContent = "Ponastavi ICDAS"; resetBtn.classList.remove("btn-danger-armed"); }, 3000);
        } else {
          if (timer) clearTimeout(timer);
          armed = false;
          resetBtn.textContent = "Ponastavi ICDAS";
          resetBtn.classList.remove("btn-danger-armed");
          this.handleReset();
        }
      });
    }
  }

  onActivate(): void {
    if (!this.session.hasSession()) return;
    const d = sessionDentition(this.session.getSession());
    if (d !== this.builtFor) {
      this.closeDetail();
      this.buildChart(d);
      this.buildICDASRootCariesUI(d);
    }
    this.refreshAllTeeth();
    if (this.selectedTooth !== null) {
      this.showDetailForTooth(this.selectedTooth);
    }
    this.refreshICDASRootCariesUI();
  }

  onDeactivate(): void {
    // Write-through — no-op
  }

  // ── Chart building ──────────────────────────────────────────────

  private buildChart(d: Dentition): void {
    if (!this.chartContainer) return;
    this.builtFor = d;
    this.chartContainer.innerHTML = "";
    const jaws = chartJaws(d);
    if (!jaws.length) {
      this.chartContainer.innerHTML = `<p class="form-hint">Dojenček brez zob — ni zob za oceno (zobovje nastavite na zavihku Preiskovanec).</p>`;
      return;
    }
    // Upper rows Q1 then Q2; lower rows mirrored (48→41, 31→38); primary rows
    // keep the 16 columns, under their permanent successors
    for (const j of jaws) this.buildJaw(this.chartContainer, j.slots, j.jaw, jaws.length > 2 ? j.label : "");
  }

  private buildJaw(
    container: HTMLElement,
    allTeeth: ToothSlot[],
    jaw: "upper" | "lower",
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
      jawDiv.appendChild(this.createToothRow(allTeeth));
      jawDiv.appendChild(this.createNumberRow(allTeeth));
    } else {
      jawDiv.appendChild(this.createNumberRow(allTeeth));
      jawDiv.appendChild(this.createToothRow(allTeeth));
    }

    container.appendChild(jawDiv);
  }

  private createToothRow(teeth: ToothSlot[]): HTMLElement {
    const row = document.createElement("div");
    row.className = "chart-row";

    for (const tooth of teeth) {
      if (tooth === null) {
        row.appendChild(emptySlot("icdas-tooth-cell slot-empty"));
        continue;
      }
      const cell = document.createElement("div");
      cell.className = "icdas-tooth-cell";
      cell.dataset.tooth = String(tooth);

      const svg = createICDASToothSvg(tooth, TOOTH_SVG_SIZE);
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

  // ── Click handling ──────────────────────────────────────────────

  private handleChartClick(e: Event): void {
    const target = e.target as Element;
    const cell = target.closest(".icdas-tooth-cell") as HTMLElement | null;
    if (!cell) return;

    const toothStr = cell.dataset.tooth;
    if (!toothStr) return;

    const tooth = parseInt(toothStr, 10) as FdiToothNumber;

    if (this.selectedTooth === tooth) {
      // Click same tooth — close detail panel
      this.closeDetail();
    } else {
      this.selectTooth(tooth);
    }
  }

  private selectTooth(tooth: FdiToothNumber): void {
    // Deselect previous
    if (this.selectedTooth !== null) {
      const prevCell = this.chartContainer?.querySelector(
        `.icdas-tooth-cell[data-tooth="${this.selectedTooth}"]`
      ) as HTMLElement | null;
      if (prevCell) prevCell.classList.remove("selected");
    }

    // Select new
    this.selectedTooth = tooth;
    const cell = this.chartContainer?.querySelector(
      `.icdas-tooth-cell[data-tooth="${tooth}"]`
    ) as HTMLElement | null;
    if (cell) cell.classList.add("selected");

    this.showDetailForTooth(tooth);
  }

  private closeDetail(): void {
    if (this.selectedTooth !== null) {
      const prevCell = this.chartContainer?.querySelector(
        `.icdas-tooth-cell[data-tooth="${this.selectedTooth}"]`
      ) as HTMLElement | null;
      if (prevCell) prevCell.classList.remove("selected");
    }
    this.selectedTooth = null;
    if (this.detailPanel) {
      this.detailPanel.innerHTML = "";
    }
  }

  // ── Detail panel ────────────────────────────────────────────────

  private showDetailForTooth(tooth: FdiToothNumber): void {
    if (!this.detailPanel || !this.session.hasSession()) return;

    const icdasData = this.session.getIcdas();
    const toothData = icdasData[tooth];
    const isSpecial = toothData.status === "special";
    const implant = isImplantTooth(toothData);
    // An implant is a special case whose surfaces are still examined
    const showSurfaces = !isSpecial || implant;

    let surfacesHtml = "";

    if (isSpecial) {
      // Special mode: single dropdown for the whole-tooth code
      const options = Object.entries(SPECIAL_CASE_LABELS)
        .map(
          ([code, desc]) =>
            `<option value="${code}" ${toothData.specialCode === code ? "selected" : ""}>${code} — ${desc}</option>`
        )
        .join("");

      surfacesHtml += `
        <div class="icdas-special-container">
          <label class="form-label">Posebna koda</label>
          <select class="icdas-special-select" id="icdas-special-code">
            <option value="">— Izberi —</option>
            ${options}
          </select>
        </div>
      `;
      if (implant) {
        surfacesHtml += `
          <p class="icdas-implant-note">
            Vsadek: zob se šteje kot manjkajoč, a se zanj vnašajo plak (VPI), krvavitev (GBI)
            in kode površin. Sondiranje, razcepišča in koreninski karies se za vsadek ne vnašajo.
          </p>
        `;
      }
    }

    if (showSurfaces) {
      // Bulk set controls for this tooth
      const restBulkOptions = Object.entries(RESTORATION_LABELS)
        .map(([code, desc]) => `<option value="${code}" title="${desc}">${code}</option>`)
        .join("");
      const cariesBulkOptions = Object.entries(CARIES_LABELS)
        .map(([code, desc]) => `<option value="${code}" title="${desc}">${code}</option>`)
        .join("");

      const bulkSetHtml = `
        <div class="bulk-set-section" style="margin-bottom:8px;">
          <div class="bulk-set-row">
            <select class="bulk-set-select" id="icdas-tooth-bulk-rest">
              <option value="">— Zobna površina —</option>
              ${restBulkOptions}
            </select>
            <button class="btn btn-secondary btn-sm" id="icdas-tooth-bulk-rest-btn">Vsem</button>
          </div>
          <div class="bulk-set-row">
            <select class="bulk-set-select" id="icdas-tooth-bulk-caries">
              <option value="">— Kariozne spr. —</option>
              ${cariesBulkOptions}
            </select>
            <button class="btn btn-secondary btn-sm" id="icdas-tooth-bulk-caries-btn">Vsem</button>
          </div>
          <div class="bulk-set-row">
            <button class="btn btn-secondary btn-sm" id="icdas-tooth-code60-btn" style="flex:1;">60 — Popolna prevleka</button>
          </div>
          <div class="bulk-set-row">
            <button class="btn btn-secondary btn-sm" id="icdas-tooth-zero-btn" style="flex:1;">Brez posebnosti (0/0)</button>
          </div>
        </div>
      `;

      // Normal mode: 5 surface items, each with full name + two dropdowns
      const rows = ICDAS_SURFACES.map((surface) => {
        const surfData = toothData.surfaces[surface];

        const restOptions = Object.entries(RESTORATION_LABELS)
          .map(
            ([code, desc]) =>
              `<option value="${code}" ${surfData.restoration === parseInt(code) ? "selected" : ""} title="${desc}">${code}</option>`
          )
          .join("");

        const cariesOptions = Object.entries(CARIES_LABELS)
          .map(
            ([code, desc]) =>
              `<option value="${code}" ${surfData.caries === parseInt(code) ? "selected" : ""} title="${desc}">${code}</option>`
          )
          .join("");

        return `
          <div class="icdas-surface-item">
            <div class="icdas-surface-name">${ICDAS_SURFACE_FULL_NAMES[surface]} (${ICDAS_SURFACE_LABELS[surface]})</div>
            <div class="icdas-surface-dropdowns">
              <div class="icdas-dropdown-wrapper">
                <span class="icdas-dropdown-label">Zobna površina</span>
                <select class="icdas-select" data-surface="${surface}" data-code-type="restoration">
                  <option value="" ${surfData.restoration === null ? "selected" : ""}>—</option>
                  ${restOptions}
                </select>
              </div>
              <div class="icdas-dropdown-wrapper">
                <span class="icdas-dropdown-label">Kariozne spremembe</span>
                <select class="icdas-select" data-surface="${surface}" data-code-type="caries">
                  <option value="" ${surfData.caries === null ? "selected" : ""}>—</option>
                  ${cariesOptions}
                </select>
              </div>
            </div>
          </div>
        `;
      }).join("");

      surfacesHtml += `
        ${bulkSetHtml}
        <div class="icdas-surfaces-grid">
          ${rows}
        </div>
      `;
    }

    this.detailPanel.innerHTML = `
      <div class="icdas-detail-panel">
        <div class="icdas-detail-header">
          <span class="icdas-detail-tooth-label">Zob ${tooth}</span>
          <select class="icdas-mode-select" id="icdas-mode-toggle">
            <option value="normal" ${!isSpecial ? "selected" : ""}>Normalen</option>
            <option value="special" ${isSpecial ? "selected" : ""}>Poseben primer</option>
          </select>
        </div>
        ${surfacesHtml}
      </div>
    `;

    // Attach event listeners
    const modeSelect = this.detailPanel.querySelector("#icdas-mode-toggle") as HTMLSelectElement;
    modeSelect?.addEventListener("change", () =>
      this.handleModeToggle(tooth, modeSelect.value as "normal" | "special")
    );

    if (isSpecial) {
      const specialSelect = this.detailPanel.querySelector("#icdas-special-code") as HTMLSelectElement;
      specialSelect?.addEventListener("change", () =>
        this.handleSpecialCodeChange(tooth, specialSelect.value)
      );
    }

    if (showSurfaces) {
      const selects = this.detailPanel.querySelectorAll(".icdas-select") as NodeListOf<HTMLSelectElement>;
      selects.forEach((sel) => {
        sel.addEventListener("change", () => {
          const surface = sel.dataset.surface as ICDASSurface;
          const codeType = sel.dataset.codeType as "restoration" | "caries";
          this.handleSurfaceCodeChange(tooth, surface, codeType, sel.value);
        });
      });

      // Per-tooth bulk set buttons
      this.detailPanel.querySelector("#icdas-tooth-bulk-rest-btn")?.addEventListener("click", () =>
        this.handleToothBulkSet(tooth, "restoration")
      );
      this.detailPanel.querySelector("#icdas-tooth-bulk-caries-btn")?.addEventListener("click", () =>
        this.handleToothBulkSet(tooth, "caries")
      );

      // Code 60 button — sets surfaces without clearing other tabs
      this.detailPanel.querySelector("#icdas-tooth-code60-btn")?.addEventListener("click", () =>
        this.handleCode60(tooth)
      );

      // Brez posebnosti button — sets all surfaces to 0/0
      this.detailPanel.querySelector("#icdas-tooth-zero-btn")?.addEventListener("click", () =>
        this.handleAllZero(tooth)
      );
    }

    // Scroll detail panel into view
    this.detailPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // ── Reset & bulk set ───────────────────────────────────────────

  private handleReset(): void {
    if (!this.session.hasSession()) return;

    const icdas = this.session.getIcdas();
    for (const t of STORED_TEETH) {
      icdas[t] = {
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

    // Reset ICDAS root caries
    const icRC = this.session.getICDASRootCaries();
    for (const t of STORED_TEETH) {
      icRC[t] = {
        distoBuccal: null, buccal: null, mesioBuccal: null,
        distoLingual: null, lingual: null, mesioLingual: null,
      };
    }

    this.session.touch();
    this.closeDetail();
    this.refreshAllTeeth();
    this.refreshICDASRootCariesUI();
  }

  private handleToothBulkSet(tooth: FdiToothNumber, codeType: "restoration" | "caries"): void {
    if (!this.session.hasSession()) return;

    const selectId = codeType === "restoration" ? "#icdas-tooth-bulk-rest" : "#icdas-tooth-bulk-caries";
    const selectEl = this.detailPanel?.querySelector(selectId) as HTMLSelectElement | null;
    if (!selectEl || selectEl.value === "") return;

    const value = parseInt(selectEl.value, 10);
    const td = this.session.getIcdas()[tooth];
    if (td.status === "special" && !isImplantTooth(td)) return;

    for (const surface of ICDAS_SURFACES) {
      if (codeType === "restoration") {
        td.surfaces[surface].restoration = value as RestorationCode;
      } else {
        td.surfaces[surface].caries = value as CariesCode;
      }
    }

    this.session.touch();
    this.refreshToothVisual(tooth);

    // Update per-surface dropdowns in place (don't rebuild panel — preserves other bulk dropdown)
    const selects = this.detailPanel?.querySelectorAll(`.icdas-select[data-code-type="${codeType}"]`) as NodeListOf<HTMLSelectElement>;
    selects?.forEach((sel) => {
      sel.value = String(value);
    });
  }

  private handleCode60(tooth: FdiToothNumber): void {
    if (!this.session.hasSession()) return;

    const td = this.session.getIcdas()[tooth];
    // An implant keeps its 90/91 code — only the surface codes are filled in
    if (!isImplantTooth(td)) {
      td.status = "normal";
      td.specialCode = null;
    }
    for (const surface of ICDAS_SURFACES) {
      td.surfaces[surface].restoration = 6 as RestorationCode;
      td.surfaces[surface].caries = 0 as CariesCode;
    }
    // Do NOT call setToothPresence — preserves plaque/bleeding/probing data
    this.session.touch();
    this.refreshToothVisual(tooth);
    this.showDetailForTooth(tooth);
  }

  private handleAllZero(tooth: FdiToothNumber): void {
    if (!this.session.hasSession()) return;

    const td = this.session.getIcdas()[tooth];
    if (!isImplantTooth(td)) {
      td.status = "normal";
      td.specialCode = null;
    }
    for (const surface of ICDAS_SURFACES) {
      td.surfaces[surface].restoration = 0 as RestorationCode;
      td.surfaces[surface].caries = 0 as CariesCode;
    }
    this.session.touch();
    this.refreshToothVisual(tooth);
    this.showDetailForTooth(tooth);
  }

  // ── Data handlers ───────────────────────────────────────────────

  private handleModeToggle(tooth: FdiToothNumber, mode: "normal" | "special"): void {
    if (!this.session.hasSession()) return;

    // Use centralized presence sync
    this.session.setToothPresence(tooth, mode === "normal");

    this.refreshToothVisual(tooth);
    this.showDetailForTooth(tooth);
    this.refreshICDASRootCariesUI();
  }

  private handleSurfaceCodeChange(
    tooth: FdiToothNumber,
    surface: ICDASSurface,
    codeType: "restoration" | "caries",
    value: string
  ): void {
    if (!this.session.hasSession()) return;

    const surfData = this.session.getIcdas()[tooth].surfaces[surface];

    if (codeType === "restoration") {
      surfData.restoration = value === "" ? null : (parseInt(value, 10) as RestorationCode);
    } else {
      surfData.caries = value === "" ? null : (parseInt(value, 10) as CariesCode);
    }

    this.session.touch();
    this.refreshToothVisual(tooth);
  }

  private handleSpecialCodeChange(tooth: FdiToothNumber, value: string): void {
    if (!this.session.hasSession()) return;

    // Code "60" (Popolna prevleka): auto-fill surfaces and switch back to normal
    if (value === "60") {
      const td = this.session.getIcdas()[tooth];
      td.status = "normal";
      td.specialCode = null;
      for (const surface of ICDAS_SURFACES) {
        td.surfaces[surface].restoration = 6 as RestorationCode;
        td.surfaces[surface].caries = 0 as CariesCode;
      }
      // Mark tooth as present in all tabs
      this.session.setToothPresence(tooth, true);
      this.refreshToothVisual(tooth);
      this.showDetailForTooth(tooth);
      return;
    }

    const td = this.session.getIcdas()[tooth];
    const wasImplant = isImplantTooth(td);
    const becomesImplant = isImplantCode(value);

    if (becomesImplant) {
      // Implant: natural tooth missing, implant surfaces examined (plaque, bleeding, ICDAS)
      this.session.setToothImplant(tooth, value as SpecialCaseCode);
    } else {
      // Leaving the implant state: clear the plaque/bleeding data again, like any missing tooth
      if (wasImplant) this.session.setToothPresence(tooth, false);
      td.specialCode = value === "" ? null : (value as SpecialCaseCode);
      this.session.touch();
    }

    this.refreshToothVisual(tooth);
    if (wasImplant || becomesImplant) {
      // The detail panel gains or loses the surface grid
      this.showDetailForTooth(tooth);
      this.refreshICDASRootCariesUI();
    }
  }

  // ── Visual refresh ──────────────────────────────────────────────

  private refreshToothVisual(tooth: FdiToothNumber): void {
    if (!this.chartContainer || !this.session.hasSession()) return;

    const cell = this.chartContainer.querySelector(
      `.icdas-tooth-cell[data-tooth="${tooth}"]`
    ) as HTMLElement | null;
    if (!cell) return;

    const toothData = this.session.getIcdas()[tooth];
    const implant = isImplantTooth(toothData);
    const greyedOut = toothData.status === "special" && !implant;

    // Toggle special / implant state on cell
    cell.classList.toggle("icdas-special", greyedOut);
    cell.classList.toggle("icdas-implant", implant);

    // Update each surface polygon
    const polygons = cell.querySelectorAll(".icdas-surface") as NodeListOf<SVGElement>;
    polygons.forEach((poly) => {
      const position = poly.dataset.position as ICDASVisualPosition;
      const surface = getICDASSurfaceForPosition(
        tooth,
        position
      );

      // Clear all state classes
      for (let i = 0; i <= 6; i++) {
        poly.classList.remove(`icdas-caries-${i}`);
      }
      poly.classList.remove("icdas-restored", "icdas-special-surface");

      if (greyedOut) {
        poly.classList.add("icdas-special-surface");
      } else {
        const surfData = toothData.surfaces[surface];

        // Caries color
        if (surfData.caries !== null) {
          poly.classList.add(`icdas-caries-${surfData.caries}`);
        }

        // Restoration indicator (blue stroke for codes > 0)
        if (surfData.restoration !== null && surfData.restoration > 0) {
          poly.classList.add("icdas-restored");
        }
      }
    });
  }

  private refreshAllTeeth(): void {
    if (!this.chartContainer || !this.session.hasSession()) return;

    const cells = this.chartContainer.querySelectorAll(".icdas-tooth-cell[data-tooth]") as NodeListOf<HTMLElement>;
    cells.forEach((cell) => {
      const toothStr = cell.dataset.tooth;
      if (toothStr) {
        this.refreshToothVisual(parseInt(toothStr, 10) as FdiToothNumber);
      }
    });
  }

  // ── ICDAS Root Caries (Koreninski karies) UI ──────────────────────

  private buildICDASRootCariesUI(d: Dentition): void {
    if (!this.rootCariesContainer) return;

    const buccalSites = PROBING_BUCCAL_SITES;
    const lingualSites = PROBING_LINGUAL_SITES;
    const allSites = [...buccalSites, ...lingualSites];

    const buildJawTable = (teeth: FdiToothNumber[], label: string): string => {
      let html = `<div class="root-caries-jaw">`;
      html += `<div class="root-caries-jaw-label">${label}</div>`;
      html += `<table class="root-caries-table"><thead><tr><th>Zob</th>`;
      for (const site of allSites) {
        html += `<th>${PROBING_SITE_LABELS[site]}</th>`;
      }
      html += `</tr></thead><tbody>`;

      for (const tooth of teeth) {
        html += `<tr data-ircaries-tooth="${tooth}"><td class="root-caries-tooth-num">${tooth}</td>`;
        for (const site of allSites) {
          html += `<td><div class="rc-radio-group ircaries-group" data-tooth="${tooth}" data-site="${site}">`;
          for (let v = 0; v <= 2; v++) {
            html += `<button type="button" class="rc-radio-btn" data-value="${v}">${v}</button>`;
          }
          html += `</div></td>`;
        }
        html += `</tr>`;
      }

      html += `</tbody></table></div>`;
      return html;
    };

    const jaws = chartJaws(d);
    this.rootCariesContainer.innerHTML = jaws.length
      ? jaws.map((j) => buildJawTable(j.slots.filter((t): t is FdiToothNumber => t !== null), j.label)).join("")
      : `<p class="form-hint">Ni zob za oceno.</p>`;
  }

  /** Root-caries clicks, delegated once: the tables are rebuilt with the dentition. */
  private wireRootCaries(): void {
    if (!this.rootCariesContainer) return;
    this.rootCariesContainer.addEventListener("click", (e: Event) => {
      const target = e.target as HTMLElement;
      if (!target.classList.contains("rc-radio-btn")) return;
      if (!this.session.hasSession()) return;

      const group = target.parentElement as HTMLElement;
      if (!group.classList.contains("ircaries-group")) return;

      const tooth = parseInt(group.dataset.tooth || "0", 10) as FdiToothNumber;
      const site = group.dataset.site as ProbingSite;
      const value = parseInt(target.dataset.value || "0", 10) as ICDASRootCariesScore;

      const icData = this.session.getICDASRootCaries();
      const toothData = icData[tooth];
      if (!toothData) return;

      // Only allow input for normal teeth
      const icdasTooth = this.session.getIcdas()[tooth];
      if (icdasTooth.status === "special") return;

      (toothData as Record<string, ICDASRootCariesScore | null>)[site] = value;
      this.session.touch();

      // Update selected state
      group.querySelectorAll(".rc-radio-btn").forEach(btn => btn.classList.remove("selected"));
      target.classList.add("selected");
    });
  }

  private refreshICDASRootCariesUI(): void {
    if (!this.rootCariesContainer || !this.session.hasSession()) return;

    const icData = this.session.getICDASRootCaries();
    const icdasData = this.session.getIcdas();
    const allSites = [...PROBING_BUCCAL_SITES, ...PROBING_LINGUAL_SITES];

    const groups = this.rootCariesContainer.querySelectorAll(".ircaries-group") as NodeListOf<HTMLElement>;
    groups.forEach(group => {
      const tooth = parseInt(group.dataset.tooth || "0", 10) as FdiToothNumber;
      const site = group.dataset.site as ProbingSite;
      const toothData = icData[tooth];
      const currentValue = toothData ? (toothData as Record<string, number | null>)[site] : null;
      const isNormal = icdasData[tooth].status !== "special";

      group.querySelectorAll(".rc-radio-btn").forEach((btn: Element) => {
        const btnEl = btn as HTMLButtonElement;
        const v = parseInt(btnEl.dataset.value || "0", 10);
        btnEl.classList.toggle("selected", currentValue === v);
        btnEl.disabled = !isNormal;
      });
    });

    // Dim rows for special case teeth
    const rows = this.rootCariesContainer.querySelectorAll("tr[data-ircaries-tooth]") as NodeListOf<HTMLElement>;
    rows.forEach(row => {
      const tooth = parseInt(row.dataset.ircariesTooth || "0", 10) as FdiToothNumber;
      const isNormal = icdasData[tooth].status !== "special";
      row.classList.toggle("furc-disabled", !isNormal);
    });
  }
}

/** A chart column with no tooth (primary rows have no molars 6–8). */
function emptySlot(className: string): HTMLElement {
  const el = document.createElement("div");
  el.className = className;
  el.setAttribute("aria-hidden", "true");
  return el;
}
