/* global document, HTMLElement, HTMLButtonElement */

import { TabController } from "./tab-manager";
import { SessionState } from "../model/session";
import { FdiToothNumber, ICDASSurface, RestorationCode } from "../model/types";
import { ALL_TEETH, RESTORATION_LABELS } from "../model/constants";
import { isImplantTooth, isToothMissing } from "../model/tooth-status";
import { buildSurfaceChart } from "./surface-chart";

/** Paintable restoration codes: a short label and a fill for the chart. */
const BRUSHES: { code: RestorationCode; label: string; color: string }[] = [
  { code: 3, label: "Kompozit", color: "#b9d9f2" },
  { code: 4, label: "Amalgam", color: "#8a8886" },
  { code: 2, label: "Zalitje fisur", color: "#c7e8cf" },
  { code: 1, label: "Delno zalitje", color: "#e6f4ea" },
  { code: 8, label: "Začasna", color: "#fbe9a6" },
  { code: 7, label: "Izpadla / poškodovana", color: "#f4b6b6" },
  { code: 5, label: "Kovinska prevleka", color: "#c9b37e" },
  { code: 6, label: "Prevleka / luska", color: "#e8dcc0" },
];
const COLOR = new Map<number, string>(BRUSHES.map((b) => [b.code, b.color]));

/**
 * Fillings: the ICDAS restoration code of each surface, entered with a brush
 * (pick a material, tap surfaces) as in the cleft-study app. It edits the
 * same data as the ICDAS tab, so the two always agree.
 */
export class FillingsTabController implements TabController {
  private panel: HTMLElement | null = null;
  private session: SessionState;
  private brush: RestorationCode = 3;

  constructor(session: SessionState) {
    this.session = session;
  }

  init(panel: HTMLElement): void {
    this.panel = panel;
    panel.innerHTML = `
      <div class="tab-content-inner">
        <h2>Zalivke</h2>
        <div class="fc-count" id="fil-count"></div>
        <div class="fc-brush-bar" id="fil-brush">
          ${BRUSHES.map(
            (b) => `<button type="button" class="fc-brush" data-code="${b.code}" style="--brush-color:${b.color}"
                      title="${RESTORATION_LABELS[b.code]}"><b>${b.code}</b> ${b.label}</button>`
          ).join("")}
          <button type="button" class="fc-brush fc-brush-erase" data-code="0" title="${RESTORATION_LABELS[0]}">⌫ Brez</button>
        </div>
        <p class="fc-brush-desc" id="fil-desc"></p>
        <div id="fil-chart"></div>
        <p class="tab-help-footer">
          Izberite material in tapnite ploskve zoba. Ponoven tap ploskve z istim materialom jo vrne na
          »brez« (koda 0). Pet ploskev na zob, okluzalna/incizalna je v sredini. Vnosi so restavracijske
          kode ICDAS (0–8) in so isti kot na zavihku ICDAS. Manjkajočih zob ni mogoče označiti; vsadke lahko.
        </p>
      </div>`;
    panel.querySelectorAll<HTMLButtonElement>("[data-code]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.brush = Number(btn.dataset.code) as RestorationCode;
        this.syncBrush();
      });
    });
    this.syncBrush();
  }

  onActivate(): void {
    this.render();
  }

  onDeactivate(): void {
    // Nothing to tidy: the chart is rebuilt on every visit
  }

  private syncBrush(): void {
    if (!this.panel) return;
    this.panel.querySelectorAll<HTMLButtonElement>("[data-code]").forEach((btn) => {
      btn.classList.toggle("active", Number(btn.dataset.code) === this.brush);
    });
    const desc = this.panel.querySelector("#fil-desc") as HTMLElement;
    desc.textContent = `${this.brush} — ${RESTORATION_LABELS[this.brush]}`;
  }

  private render(): void {
    if (!this.panel) return;
    const host = this.panel.querySelector("#fil-chart") as HTMLElement;
    const count = this.panel.querySelector("#fil-count") as HTMLElement;
    if (!this.session.hasSession()) {
      host.innerHTML = `<p class="form-hint">Ni aktivne seje. Začnite nov pregled na zavihku Začetek.</p>`;
      count.textContent = "";
      return;
    }
    const s = this.session.getSession();
    const icdas = this.session.getIcdas();
    const blocked = (t: FdiToothNumber) => isToothMissing(s, t) && !isImplantTooth(icdas[t]);

    // Surfaces per code, and teeth with fissure sealants
    const perCode = new Map<number, number>();
    let sealedTeeth = 0;
    for (const t of ALL_TEETH) {
      if (blocked(t)) continue;
      let sealed = false;
      for (const surf of Object.keys(icdas[t].surfaces) as ICDASSurface[]) {
        const code = icdas[t].surfaces[surf].restoration;
        if (code === null || code === 0) continue;
        perCode.set(code, (perCode.get(code) || 0) + 1);
        if (code === 1 || code === 2) sealed = true;
      }
      if (sealed) sealedTeeth++;
    }
    const fillings = (perCode.get(3) || 0) + (perCode.get(4) || 0) + (perCode.get(8) || 0);
    const parts = BRUSHES.filter((b) => perCode.get(b.code)).map((b) => `${b.label.toLowerCase()} ${perCode.get(b.code)}`);
    count.innerHTML =
      `<strong>${fillings}</strong> ploskev z zalivko · <strong>${sealedTeeth}</strong> zob z zalitimi fisurami` +
      (parts.length ? `<div class="fc-count-sub">${parts.join(" · ")}</div>` : "");

    host.innerHTML = "";
    host.appendChild(
      buildSurfaceChart({
        isDisabled: blocked,
        fillFor: (t, surf) => COLOR.get(icdas[t].surfaces[surf].restoration ?? -1) || "",
        textFor: (t, surf) => {
          const code = icdas[t].surfaces[surf].restoration;
          return code ? String(code) : "";
        },
        onSurface: (t, surf) => {
          const data = icdas[t].surfaces[surf];
          data.restoration = data.restoration === this.brush ? 0 : this.brush;
          this.session.touch();
          this.render();
        },
      })
    );
  }
}
