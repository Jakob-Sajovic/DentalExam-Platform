/* global document, HTMLElement, HTMLButtonElement */

import { TabController } from "./tab-manager";
import { SessionState } from "../model/session";
import { FdiToothNumber, RestorationCode } from "../model/types";
import { RESTORATION_LABELS } from "../model/constants";
import { RESTORATION_BRUSHES, restorationsBlocked, summarizeRestorations } from "../model/restorations";
import { buildSurfaceChart } from "./surface-chart";

const BRUSHES = RESTORATION_BRUSHES;
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
    const blocked = (t: FdiToothNumber) => restorationsBlocked(s, t);
    const sum = summarizeRestorations(s);
    const parts = BRUSHES.filter((b) => sum.perCode.get(b.code)).map((b) => `${b.label.toLowerCase()} ${sum.perCode.get(b.code)}`);
    count.innerHTML =
      `<strong>${sum.fillingSurfaces}</strong> ploskev z zalivko · <strong>${sum.sealedTeeth}</strong> zob z zalitimi fisurami` +
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
