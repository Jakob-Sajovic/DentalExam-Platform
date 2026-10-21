import { TabController } from "./tab-manager";
import { SessionState, makeDefaultProbingData, makeDefaultBOPData, makeDefaultFurcationInvolvementData } from "../model/session";
import { FdiToothNumber, ProbingSite, ProbingData, FurcationScore } from "../model/types";
import {
  PROBING_BUCCAL_SITES,
  PROBING_LINGUAL_SITES,
  PROBING_SITE_LABELS,
  PROBING_DEPTH_COLORS,
  PROBING_ALL_SITES,
  FURCATION_GRADES,
  ROOT_CARIES_UPPER_TEETH,
  ROOT_CARIES_LOWER_TEETH,
  rootCariesEntryCount,
  rootCariesLabels,
  getVisualBuccalSites,
  getVisualLingualSites,
} from "../model/constants";
import { buildToothOutlinesSvg, TOOTH_CENTER_PCT, SITE_SPREAD } from "../dental/tooth-outlines";
import { isImplantTooth } from "../model/tooth-status";
import { computePerioWound } from "../model/perio-wound";
import { Dentition, ToothSlot, ChartJaw, chartJaws } from "../model/dentition";
import { sessionDentition, sessionTeeth } from "../model/session";

function getDepthColor(avg: number): string {
  for (const tier of PROBING_DEPTH_COLORS) {
    if (avg <= tier.max) return tier.color;
  }
  return PROBING_DEPTH_COLORS[PROBING_DEPTH_COLORS.length - 1].color;
}

export class ProbingTabController implements TabController {
  private panel: HTMLElement | null = null;
  private session: SessionState;
  private selectedTooth: FdiToothNumber | null = null;
  private detailContainer: HTMLElement | null = null;
  /** Chart strips by "<row index>-<buccal|lingual>". */
  private chartContainers: Map<string, HTMLElement> = new Map();
  private chartHost: HTMLElement | null = null;
  private jaws: ChartJaw[] = [];
  /** Dentition the chart was built for; rebuilt when it changes. */
  private builtFor: Dentition | null = null;
  private furcationContainer: HTMLElement | null = null;
  private bopSummaryEl: HTMLElement | null = null;

  constructor(session: SessionState) {
    this.session = session;
  }

  init(panel: HTMLElement): void {
    this.panel = panel;
    panel.innerHTML = `
      <div class="tab-content-inner">
        <h2>Globine sondiranja</h2>
        <div class="tab-toolbar">
          <button class="btn btn-danger-outline btn-sm" id="probing-reset-btn">Ponastavi globine</button>
        </div>
        <p class="icdas-help-text">
          Kliknite na zob za vnos globin sondiranja (6 mest na zob).
          Barvne vrednosti: zelena &#8804;3, rumena 4, oranžna 5, rdeča &#8805;6 mm.
        </p>
        <div id="probing-chart"></div>
        <div id="probing-detail"></div>
        <div id="bop-summary" class="bop-summary-bar" style="margin-top:12px;"></div>
        <div id="perio-wound" class="perio-wound-bar"></div>
        <div id="furcation-section">
          <h2 style="margin-top:24px;">Prizadetost razcepišč</h2>
          <p class="icdas-help-text">
            Ocena prizadetosti razcepišč na molarjih (0 = brez prizadetosti, 1 = začetna izguba, 2 = delna prizadetost, 3 = popolna prizadetost).
          </p>
          <div id="furcation-content"></div>
        </div>
        <p class="tab-help-footer">
          Za vsak zob vnesite globine sondiranja v milimetrih.
          Graf se posodobi sproti.
        </p>
      </div>
    `;

    const chartContainer = panel.querySelector("#probing-chart") as HTMLElement;
    this.detailContainer = panel.querySelector("#probing-detail") as HTMLElement;
    this.furcationContainer = panel.querySelector("#furcation-content") as HTMLElement;
    this.bopSummaryEl = panel.querySelector("#bop-summary") as HTMLElement;

    this.chartHost = chartContainer;
    this.buildChart(chartContainer, "permanent");
    this.buildFurcationUI();

    // Reset button with two-click confirmation
    const resetBtn = panel.querySelector("#probing-reset-btn") as HTMLButtonElement;
    if (resetBtn) {
      let armed = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      resetBtn.addEventListener("click", () => {
        if (!armed) {
          armed = true;
          resetBtn.textContent = "Ste prepričani?";
          resetBtn.classList.add("btn-danger-armed");
          timer = setTimeout(() => { armed = false; resetBtn.textContent = "Ponastavi globine"; resetBtn.classList.remove("btn-danger-armed"); }, 3000);
        } else {
          if (timer) clearTimeout(timer);
          armed = false;
          resetBtn.textContent = "Ponastavi globine";
          resetBtn.classList.remove("btn-danger-armed");
          this.handleReset();
        }
      });
    }
  }

  onActivate(): void {
    if (!this.session.hasSession()) return;
    const d = sessionDentition(this.session.getSession());
    if (d !== this.builtFor && this.chartHost) {
      this.closeDetail();
      this.buildChart(this.chartHost, d);
    }
    this.refreshAllCharts();
    if (this.selectedTooth !== null) {
      this.showDetail(this.selectedTooth);
    }
    this.refreshFurcationUI();
    this.refreshBOPSummary();
  }

  onDeactivate(): void {
    // Write-through — no-op
  }

  // ── Chart building ────────────────────────────────────────────

  private buildChart(container: HTMLElement, d: Dentition): void {
    this.builtFor = d;
    this.jaws = chartJaws(d);
    this.chartContainers.clear();
    container.innerHTML = "";
    if (!this.jaws.length) {
      container.innerHTML = `<p class="form-hint">Dojenček brez zob — ni zob za sondiranje (zobovje nastavite na zavihku Preiskovanec).</p>`;
    }
    this.jaws.forEach((j, i) => this.buildJaw(container, j.slots, j.jaw, j.label, i));
    // Furcations are graded on permanent molars only
    const furcation = this.panel?.querySelector("#furcation-section") as HTMLElement | null;
    if (furcation) furcation.hidden = !this.jaws.some((j) => !j.primary);
  }

  private buildJaw(
    container: HTMLElement,
    teeth: ToothSlot[],
    jaw: "upper" | "lower",
    label: string,
    index: number
  ): void {
    const jawDiv = document.createElement("div");
    jawDiv.className = "probing-jaw";

    const jawLabel = document.createElement("div");
    jawLabel.className = "probing-jaw-label";
    jawLabel.textContent = label;
    jawDiv.appendChild(jawLabel);

    // Upper: buccal top + palatal bottom; Lower: lingual top + buccal bottom
    const topSide = jaw === "upper" ? "buccal" : "lingual";
    const bottomSide = jaw === "upper" ? "lingual" : "buccal";
    const topLabel = jaw === "upper" ? "Bukalno" : "Lingvalno";
    const bottomLabel = jaw === "upper" ? "Palatinalno" : "Bukalno";

    const topSideLabel = document.createElement("div");
    topSideLabel.className = "probing-side-label";
    topSideLabel.textContent = topLabel;
    jawDiv.appendChild(topSideLabel);

    const topChartEl = document.createElement("div");
    topChartEl.className = "probing-chart-wrap";
    topChartEl.innerHTML = this.buildOutlineOnlySvg(teeth, jaw);
    jawDiv.appendChild(topChartEl);
    this.chartContainers.set(`${index}-${topSide}`, topChartEl);

    // Tooth numbers row — absolutely positioned at tooth center percentages
    const numRow = document.createElement("div");
    numRow.className = "probing-number-row";
    for (let i = 0; i < teeth.length; i++) {
      const tooth = teeth[i];
      if (tooth === null) continue;
      const numEl = document.createElement("div");
      numEl.className = "probing-tooth-num";
      numEl.textContent = String(tooth);
      numEl.dataset.tooth = String(tooth);
      numEl.style.left = `${TOOTH_CENTER_PCT[i]}%`;
      numEl.addEventListener("click", () => this.handleToothClick(tooth));
      numRow.appendChild(numEl);
    }
    jawDiv.appendChild(numRow);

    // Bottom side
    const bottomChartEl = document.createElement("div");
    bottomChartEl.className = "probing-chart-wrap";
    bottomChartEl.innerHTML = this.buildOutlineOnlySvg(teeth, jaw);
    jawDiv.appendChild(bottomChartEl);
    this.chartContainers.set(`${index}-${bottomSide}`, bottomChartEl);

    const bottomSideLabel = document.createElement("div");
    bottomSideLabel.className = "probing-side-label";
    bottomSideLabel.textContent = bottomLabel;
    jawDiv.appendChild(bottomSideLabel);

    container.appendChild(jawDiv);
  }

  // ── SVG helpers ──────────────────────────────────────────────

  /** SVG with just tooth outlines, no data — shown before a session is loaded */
  private buildOutlineOnlySvg(teeth: ToothSlot[], jaw: "upper" | "lower"): string {
    const chartW = 1000;
    const chartH = 100;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${chartW} ${chartH}" class="probing-chart" preserveAspectRatio="none">`
      + buildToothOutlinesSvg(teeth, jaw, chartW, chartH)
      + `</svg>`;
  }

  private buildAreaChartSvg(
    teeth: ToothSlot[],
    sites: ProbingSite[],
    data: ProbingData,
    jaw: "upper" | "lower"
  ): string {
    const chartW = 1000; // high-res viewBox for precision
    const chartH = 100;
    const maxDepth = 12;
    const sitesPerTooth = sites.length; // 3
    const spreadW = chartW * (SITE_SPREAD / 100); // spread in viewBox units

    const parts: string[] = [];
    parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${chartW} ${chartH}" class="probing-chart" preserveAspectRatio="none">`);

    // Tooth outline background
    parts.push(buildToothOutlinesSvg(teeth, jaw, chartW, chartH));

    const polylinePoints: string[] = [];

    for (let ti = 0; ti < teeth.length; ti++) {
      const tooth = teeth[ti];
      if (tooth === null) continue;
      const td = data[tooth];
      const centerX = chartW * (TOOTH_CENTER_PCT[ti] / 100);

      if (!td.present) continue;

      const vals: (number | null)[] = sites.map(s => td[s]);
      const hasData = vals.some(v => v !== null && v > 0);

      // X positions for the 3 sites: left-of-center, center, right-of-center
      const siteXs = [
        centerX - spreadW,
        centerX,
        centerX + spreadW,
      ];

      if (!hasData) {
        for (let si = 0; si < sitesPerTooth; si++) {
          polylinePoints.push(`${siteXs[si].toFixed(1)},0`);
        }
        continue;
      }

      const numericVals = vals.filter(v => v !== null) as number[];
      const avg = numericVals.length > 0 ? numericVals.reduce((a, b) => a + b, 0) / numericVals.length : 0;
      const color = getDepthColor(avg);

      const toothPolyPts: string[] = [];

      for (let si = 0; si < sitesPerTooth; si++) {
        const v = vals[si] ?? 0;
        const py = Math.min(chartH, chartH * (v / maxDepth));
        toothPolyPts.push(`${siteXs[si].toFixed(1)},${py.toFixed(1)}`);
        polylinePoints.push(`${siteXs[si].toFixed(1)},${py.toFixed(1)}`);
      }

      // Close polygon back to baseline
      toothPolyPts.push(`${siteXs[2].toFixed(1)},0`);
      toothPolyPts.push(`${siteXs[0].toFixed(1)},0`);

      parts.push(`<polygon points="${toothPolyPts.join(" ")}" fill="${color}" opacity="0.45"/>`);
    }

    if (polylinePoints.length > 0) {
      parts.push(`<polyline points="${polylinePoints.join(" ")}" fill="none" stroke="#333" stroke-width="1.5"/>`);
    }

    parts.push(`</svg>`);
    return parts.join("");
  }

  private refreshAllCharts(): void {
    if (!this.session.hasSession()) return;
    const data = this.session.getProbing();
    this.jaws.forEach((j, i) => this.refreshJawCharts(i, j.jaw, j.slots, data));
    this.refreshToothNumStyles();
  }

  private refreshJawCharts(index: number, jaw: "upper" | "lower", teeth: ToothSlot[], data: ProbingData): void {
    const buccalEl = this.chartContainers.get(`${index}-buccal`);
    const lingualEl = this.chartContainers.get(`${index}-lingual`);

    if (buccalEl) {
      buccalEl.innerHTML = this.buildAreaChartSvg(teeth, PROBING_BUCCAL_SITES, data, jaw);
    }
    if (lingualEl) {
      lingualEl.innerHTML = this.buildAreaChartSvg(teeth, PROBING_LINGUAL_SITES, data, jaw);
    }
  }

  private refreshToothNumStyles(): void {
    if (!this.panel || !this.session.hasSession()) return;
    const data = this.session.getProbing();
    const icdas = this.session.getIcdas();

    const nums = this.panel.querySelectorAll(".probing-tooth-num") as NodeListOf<HTMLElement>;
    nums.forEach(el => {
      const t = parseInt(el.dataset.tooth || "0", 10) as FdiToothNumber;
      const td = data[t];
      if (td) {
        const implant = isImplantTooth(icdas[t]);
        el.classList.toggle("missing", !td.present && !implant);
        el.classList.toggle("implant", implant);
        el.classList.toggle("selected", t === this.selectedTooth);
      }
    });
  }

  // ── Tooth click / detail panel ────────────────────────────────

  private handleToothClick(tooth: FdiToothNumber): void {
    if (!this.session.hasSession()) return;

    if (this.selectedTooth === tooth) {
      this.closeDetail();
    } else {
      this.selectTooth(tooth);
    }
  }

  private selectTooth(tooth: FdiToothNumber): void {
    this.selectedTooth = tooth;
    this.refreshToothNumStyles();
    this.showDetail(tooth);
  }

  private closeDetail(): void {
    this.selectedTooth = null;
    this.refreshToothNumStyles();
    if (this.detailContainer) {
      this.detailContainer.innerHTML = "";
    }
  }

  private showDetail(tooth: FdiToothNumber): void {
    if (!this.detailContainer || !this.session.hasSession()) return;

    const data = this.session.getProbing();
    const td = data[tooth];
    const bopData = this.session.getBop();
    const bopTooth = bopData[tooth];

    // Use per-quadrant visual site ordering
    const visualBuccal = getVisualBuccalSites(tooth);
    const visualLingual = getVisualLingualSites(tooth);

    const buildInputs = (sites: ProbingSite[], label: string): string => {
      let html = `<div class="probing-side-group"><span class="probing-group-label">${label}:</span>`;
      html += `<div class="probing-inputs-grid">`;
      for (const site of sites) {
        const val = td[site];
        const displayVal = val !== null ? String(val) : "";
        const bopChecked = bopTooth[site] ? "checked" : "";
        html += `
          <div class="probing-input-wrap">
            <label class="probing-input-label">${PROBING_SITE_LABELS[site]}</label>
            <input type="number" class="probing-input" data-site="${site}"
                   min="0" max="25" step="1" value="${displayVal}"
                   placeholder="mm" inputmode="decimal">
            <label class="bop-check-label">
              <input type="checkbox" class="bop-checkbox" data-site="${site}" ${bopChecked} ${!td.present ? "disabled" : ""}>
              <span class="bop-check-text">Krvavitev</span>
            </label>
          </div>`;
      }
      html += `</div></div>`;
      return html;
    };

    // An implant (ICDAS 90/91) is never probed; the state is changed on the ICDAS tab
    const icdasTooth = this.session.getIcdas()[tooth];
    const headerAction = isImplantTooth(icdasTooth)
      ? `<span class="probing-implant-badge">Vsadek (ICDAS ${icdasTooth.specialCode}) — brez sondiranja</span>`
      : `<button class="btn btn-secondary probing-missing-btn" style="min-height:36px;padding:4px 12px;font-size:13px;">
            ${td.present ? "Označi kot manjkajoč" : "Označi kot prisoten"}
          </button>`;

    this.detailContainer.innerHTML = `
      <div class="probing-detail-panel">
        <div class="probing-detail-header">
          <span class="probing-detail-tooth-label">Zob ${tooth}</span>
          ${headerAction}
        </div>
        ${buildInputs(visualBuccal, "Bukalno")}
        ${buildInputs(visualLingual, "Lingvalno")}
      </div>
    `;

    // Attach event listeners for depth inputs
    const inputs = this.detailContainer.querySelectorAll(".probing-input") as NodeListOf<HTMLInputElement>;
    inputs.forEach(input => {
      input.addEventListener("input", () => {
        const site = input.dataset.site as ProbingSite;
        const raw = input.value.trim();
        if (raw === "") {
          td[site] = null;
        } else {
          let v = parseFloat(raw);
          if (isNaN(v)) { td[site] = null; return; }
          if (v < 0) { v = 0; input.value = "0"; }
          if (v > 25) { v = 25; input.value = "25"; }
          td[site] = v;
        }
        this.session.touch();
        this.refreshAllCharts();
        this.refreshBOPSummary();
      });

      input.addEventListener("blur", () => {
        const site = input.dataset.site as ProbingSite;
        const raw = input.value.trim();
        if (raw === "") return;
        let v = parseFloat(raw);
        if (isNaN(v)) { input.value = ""; td[site] = null; return; }
        v = Math.max(0, Math.min(25, v));
        v = Math.round(v * 10) / 10;
        td[site] = v;
        input.value = String(v);
      });

      if (!td.present) {
        input.disabled = true;
      }
    });

    // BOP checkbox listeners
    const bopChecks = this.detailContainer.querySelectorAll(".bop-checkbox") as NodeListOf<HTMLInputElement>;
    bopChecks.forEach(cb => {
      cb.addEventListener("change", () => {
        const site = cb.dataset.site as ProbingSite;
        (bopTooth as Record<string, boolean>)[site] = cb.checked;
        this.session.touch();
        this.refreshBOPSummary();
      });
    });

    // Missing toggle button
    const missingBtn = this.detailContainer.querySelector(".probing-missing-btn") as HTMLButtonElement;
    missingBtn?.addEventListener("click", () => {
      this.session.setToothPresence(tooth, !td.present);
      this.refreshAllCharts();
      this.refreshBOPSummary();
      this.refreshFurcationUI();
      this.showDetail(tooth);
    });

    this.detailContainer.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // ── Reset ───────────────────────────────────────────────────────

  private handleReset(): void {
    if (!this.session.hasSession()) return;

    const session = this.session.getSession();
    session.probing = makeDefaultProbingData();
    session.bop = makeDefaultBOPData();
    session.furcationInvolvement = makeDefaultFurcationInvolvementData();
    this.session.touch();
    this.closeDetail();
    this.refreshAllCharts();
    this.refreshFurcationUI();
    this.refreshBOPSummary();
  }

  // ── BOP summary ─────────────────────────────────────────────────

  private refreshBOPSummary(): void {
    if (!this.bopSummaryEl || !this.session.hasSession()) return;

    const s = this.session.getSession();
    if (!s.bop || !s.probing) return;

    let totalSites = 0;
    let bleedingSites = 0;

    for (const t of sessionTeeth(s)) {
      if (!s.probing[t].present) continue;
      const bopTooth = s.bop[t];
      if (!bopTooth) continue;
      for (const site of PROBING_ALL_SITES) {
        totalSites++;
        if (bopTooth[site as keyof typeof bopTooth]) bleedingSites++;
      }
    }

    const pct = totalSites > 0 ? ((bleedingSites / totalSites) * 100).toFixed(1) : "0.0";
    this.bopSummaryEl.innerHTML = `
      <strong>Krvavitev ob sondiranju (BOP):</strong> ${pct}% (${bleedingSites} od ${totalSites} mest)
    `;
    this.refreshWound();
  }

  /** Periodontal wound (Skalerič 2012), shown under the BOP summary. */
  private refreshWound(): void {
    const el = this.panel?.querySelector("#perio-wound") as HTMLElement | null;
    if (!el || !this.session.hasSession()) return;
    const w = computePerioWound(this.session.getSession());
    if (!w) {
      el.innerHTML = "";
      return;
    }
    const cm2 = (mm2: number) => (mm2 / 100).toFixed(2).replace(".", ",");
    const basis =
      w.basis === "mean"
        ? `Spol ni izpolnjen (zavihek Preiskovanec) — uporabljeno povprečje obeh spolov.`
        : `Obseg zobnega vratu za ${w.basis === "male" ? "moške" : "ženske"}.`;
    const partial = w.sitesMeasured < w.sitesPossible ? ` Izmerjenih ${w.sitesMeasured} od ${w.sitesPossible} mest.` : "";
    el.innerHTML = `
      <strong>Parodontalna rana:</strong> ${cm2(w.total)} cm²
      · vnetna obremenitev ${cm2(w.burden)} cm²
      · krvaveča (aktivna) rana ${cm2(w.bleeding)} cm²
      <div class="perio-wound-note">${basis}${partial} Metoda: Skalerič in sod., Acta Odontol Scand 2012.</div>`;
  }

  // ── Furcation involvement UI ──────────────────────────────────────

  private buildFurcationUI(): void {
    if (!this.furcationContainer) return;

    const buildJawTable = (teeth: FdiToothNumber[], label: string): string => {
      const entryCount = rootCariesEntryCount(teeth[0]);
      const labels = rootCariesLabels(teeth[0]);

      let html = `<div class="root-caries-jaw">`;
      html += `<div class="root-caries-jaw-label">${label}</div>`;
      html += `<table class="root-caries-table"><thead><tr><th>Zob</th>`;
      for (const lbl of labels) {
        html += `<th>${lbl}</th>`;
      }
      html += `</tr></thead><tbody>`;

      for (const tooth of teeth) {
        html += `<tr data-furc-tooth="${tooth}"><td class="root-caries-tooth-num">${tooth}</td>`;
        for (let i = 0; i < entryCount; i++) {
          html += `<td><div class="rc-radio-group" data-tooth="${tooth}" data-entry="${i}">`;
          for (let v = 0; v <= 3; v++) {
            html += `<button type="button" class="rc-radio-btn" data-value="${v}">${v}</button>`;
          }
          html += `</div></td>`;
        }
        html += `</tr>`;
      }

      html += `</tbody></table></div>`;
      return html;
    };

    // Lower molars mirrored to match jaw display: 48,47,46 then 36,37,38
    const lowerMolarsMirrored: FdiToothNumber[] = [48, 47, 46, 36, 37, 38];

    this.furcationContainer.innerHTML =
      buildJawTable(ROOT_CARIES_UPPER_TEETH, "Zgornja čeljust") +
      buildJawTable(lowerMolarsMirrored, "Spodnja čeljust");

    // Event delegation for radio buttons
    this.furcationContainer.addEventListener("click", (e: Event) => {
      const target = e.target as HTMLElement;
      if (!target.classList.contains("rc-radio-btn")) return;
      if (!this.session.hasSession()) return;

      const group = target.parentElement as HTMLElement;
      const tooth = parseInt(group.dataset.tooth || "0", 10) as FdiToothNumber;
      const entry = parseInt(group.dataset.entry || "0", 10);
      const value = parseInt(target.dataset.value || "0", 10) as FurcationScore;

      const fiData = this.session.getFurcationInvolvement();
      if (!fiData[tooth]) {
        fiData[tooth] = new Array(rootCariesEntryCount(tooth)).fill(0) as FurcationScore[];
      }
      fiData[tooth]![entry] = value;
      this.session.touch();

      // Update selected state
      group.querySelectorAll(".rc-radio-btn").forEach(btn => btn.classList.remove("selected"));
      target.classList.add("selected");
    });
  }

  private refreshFurcationUI(): void {
    if (!this.furcationContainer || !this.session.hasSession()) return;

    const fiData = this.session.getFurcationInvolvement();
    const probingData = this.session.getProbing();
    const groups = this.furcationContainer.querySelectorAll(".rc-radio-group") as NodeListOf<HTMLElement>;

    groups.forEach(group => {
      const tooth = parseInt(group.dataset.tooth || "0", 10) as FdiToothNumber;
      const entry = parseInt(group.dataset.entry || "0", 10);
      const toothData = fiData[tooth];
      const currentValue = toothData ? toothData[entry] : 0;
      const isPresent = probingData[tooth]?.present !== false;

      group.querySelectorAll(".rc-radio-btn").forEach((btn: Element) => {
        const btnEl = btn as HTMLButtonElement;
        const v = parseInt(btnEl.dataset.value || "0", 10);
        btnEl.classList.toggle("selected", currentValue === v);
        btnEl.disabled = !isPresent;
      });
    });

    // Dim rows for missing teeth
    const rows = this.furcationContainer.querySelectorAll("tr[data-furc-tooth]") as NodeListOf<HTMLElement>;
    rows.forEach(row => {
      const tooth = parseInt(row.dataset.furcTooth || "0", 10) as FdiToothNumber;
      const isPresent = probingData[tooth]?.present !== false;
      row.classList.toggle("furc-disabled", !isPresent);
    });
  }
}
