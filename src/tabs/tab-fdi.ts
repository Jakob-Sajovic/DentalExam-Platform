import { TabController } from "./tab-manager";
import { SessionState } from "../model/session";
import { FdiQuestionnaireData, PBSurface, ProbingSite } from "../model/types";
import { PROBING_ALL_SITES } from "../model/constants";
import { sessionTeeth } from "../model/dentition";
import { isToothMissing } from "../model/tooth-status";

const PB_SURFACES: PBSurface[] = ["mesial", "distal", "buccal", "lingual"];

interface FdiOption { value: string; label: string }

const GENDER_OPTIONS: FdiOption[] = [
  { value: "male", label: "Moški" },
  { value: "female", label: "Ženski" },
  { value: "rather_not_say", label: "Ne želim odgovoriti" },
];

const AGE_OPTIONS: FdiOption[] = [
  { value: "lt35", label: "< 35 let" },
  { value: "35to44", label: "35–44 let" },
  { value: "45to64", label: "45–64 let" },
  { value: "gt64", label: "> 64 let" },
];

const SMOKING_OPTIONS: FdiOption[] = [
  { value: "no", label: "Ne" },
  { value: "lt10", label: "< 10 cigaret/dan" },
  { value: "10to15", label: "10–15 cigaret/dan" },
  { value: "gt15", label: "> 15 cigaret/dan" },
];

const DIABETES_OPTIONS: FdiOption[] = [
  { value: "no", label: "Ne" },
  { value: "well_controlled", label: "Urejen (HbA1c < 7%)" },
  { value: "poorly_controlled", label: "Neurejen (HbA1c ≥ 7%)" },
];

const TOOTH_LOSS_OPTIONS: FdiOption[] = [
  { value: "no", label: "Brez izgube zob" },
  { value: "yes", label: "Izguba zob zaradi parodontitisa" },
];

const PLAQUE_OPTIONS: FdiOption[] = [
  { value: "lt10", label: "< 10% površin" },
  { value: "10to50", label: "10–50% površin" },
  { value: "gt50", label: "> 50% površin" },
];

const BLEEDING_OPTIONS: FdiOption[] = [
  { value: "lt10", label: "< 10% površin" },
  { value: "10to50", label: "10–50% površin" },
  { value: "gt50", label: "> 50% površin" },
];

const PROBING_DEPTH_OPTIONS: FdiOption[] = [
  { value: "lt4", label: "< 4 mm" },
  { value: "4to5", label: "4–5 mm" },
  { value: "localized_gt5", label: "Lokalizirana mesta > 5 mm" },
  { value: "generalized_gt5", label: "Generalizirana mesta > 5 mm" },
];

interface QuestionDef {
  key: keyof FdiQuestionnaireData;
  label: string;
  options: FdiOption[];
  autoCalc: boolean;
}

const QUESTIONS: QuestionDef[] = [
  { key: "gender", label: "1. Spol", options: GENDER_OPTIONS, autoCalc: false },
  { key: "age", label: "2. Starost", options: AGE_OPTIONS, autoCalc: false },
  { key: "smoking", label: "3. Kajenje", options: SMOKING_OPTIONS, autoCalc: false },
  { key: "diabetes", label: "4. Diabetes", options: DIABETES_OPTIONS, autoCalc: false },
  { key: "toothLoss", label: "5. Izguba zob zaradi parodontalnih bolezni", options: TOOTH_LOSS_OPTIONS, autoCalc: true },
  { key: "plaque", label: "6. Obsežne obloge pokrivajo", options: PLAQUE_OPTIONS, autoCalc: true },
  { key: "bleeding", label: "7. Krvavitev ob sondiranju", options: BLEEDING_OPTIONS, autoCalc: true },
  { key: "probingDepth", label: "8. Globina sondiranja", options: PROBING_DEPTH_OPTIONS, autoCalc: true },
];

export class FdiTabController implements TabController {
  private panel: HTMLElement | null = null;
  private session: SessionState;

  constructor(session: SessionState) {
    this.session = session;
  }

  init(panel: HTMLElement): void {
    this.panel = panel;
    panel.innerHTML = `
      <div class="tab-content-inner">
        <h2>FDI vprašalnik</h2>
        <div class="tab-toolbar">
          <button class="btn btn-primary btn-sm" id="fdi-autocalc-btn">Samodejni izračun</button>
          <button class="btn btn-danger-outline btn-sm" id="fdi-reset-btn">Ponastavi FDI</button>
        </div>
        <p class="fdi-description">
          Vprašalnik za profil parodontalne bolezni (FDI). Vprašanja 5–8 se lahko samodejno izračunajo iz podatkov drugih zavihkov.
        </p>
        <div id="fdi-questions"></div>
        <div class="form-group" style="margin-top:12px;">
          <label class="form-label" for="fdi-country">Država</label>
          <input type="text" id="fdi-country" class="form-input" placeholder="npr. Slovenija" />
        </div>
        <p class="tab-help-footer">
          Kliknite »Samodejni izračun« za izpolnitev vprašanj 5–8 na podlagi podatkov iz zavihkov VPI/GBI in Globine sondiranja.
        </p>
      </div>
    `;

    const container = panel.querySelector("#fdi-questions") as HTMLElement;
    for (const q of QUESTIONS) {
      const qEl = document.createElement("div");
      qEl.className = "fdi-question";
      qEl.dataset.key = q.key;

      let labelHtml = `<div class="fdi-question-label">${q.label}`;
      if (q.autoCalc) labelHtml += ` <span class="fdi-auto-badge">auto</span>`;
      labelHtml += `</div>`;

      let optionsHtml = `<div class="fdi-options" data-key="${q.key}">`;
      for (const opt of q.options) {
        optionsHtml += `<button type="button" class="fdi-option-btn" data-key="${q.key}" data-value="${opt.value}">${opt.label}</button>`;
      }
      optionsHtml += `</div>`;

      qEl.innerHTML = labelHtml + optionsHtml;
      container.appendChild(qEl);
    }

    // Event delegation for option buttons
    container.addEventListener("click", (e: Event) => {
      const target = e.target as HTMLElement;
      if (!target.classList.contains("fdi-option-btn")) return;
      if (!this.session.hasSession()) return;

      const key = target.dataset.key as keyof FdiQuestionnaireData;
      const value = target.dataset.value as string;
      const fdi = this.session.getFdiQuestionnaire();

      // Toggle: clicking the same value deselects
      if (fdi[key] === value) {
        (fdi as Record<string, unknown>)[key] = null;
      } else {
        (fdi as Record<string, unknown>)[key] = value;
      }
      this.session.touch();
      this.refreshQuestion(key);
    });

    // Country input
    const countryInput = panel.querySelector("#fdi-country") as HTMLInputElement;
    countryInput.addEventListener("change", () => {
      if (!this.session.hasSession()) return;
      this.session.getFdiQuestionnaire().country = countryInput.value;
      this.session.touch();
    });

    // Auto-calc button
    const autoCalcBtn = panel.querySelector("#fdi-autocalc-btn") as HTMLButtonElement;
    autoCalcBtn.addEventListener("click", () => {
      if (!this.session.hasSession()) return;
      this.autoCalculate();
    });

    // Reset button with two-click confirmation
    const resetBtn = panel.querySelector("#fdi-reset-btn") as HTMLButtonElement;
    if (resetBtn) {
      let armed = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      resetBtn.addEventListener("click", () => {
        if (!armed) {
          armed = true;
          resetBtn.textContent = "Ste prepričani?";
          resetBtn.classList.add("btn-danger-armed");
          timer = setTimeout(() => { armed = false; resetBtn.textContent = "Ponastavi FDI"; resetBtn.classList.remove("btn-danger-armed"); }, 3000);
        } else {
          if (timer) clearTimeout(timer);
          armed = false;
          resetBtn.textContent = "Ponastavi FDI";
          resetBtn.classList.remove("btn-danger-armed");
          if (!this.session.hasSession()) return;
          const fdi = this.session.getFdiQuestionnaire();
          fdi.gender = null; fdi.age = null; fdi.smoking = null;
          fdi.diabetes = null; fdi.toothLoss = null; fdi.plaque = null;
          fdi.bleeding = null; fdi.probingDepth = null; fdi.country = "";
          this.session.touch();
          this.refreshAll();
        }
      });
    }
  }

  onActivate(): void {
    if (this.session.hasSession()) {
      this.autoCalculate();
    }
    this.refreshAll();
  }

  onDeactivate(): void {
    // Country input saved on change, nothing else needed
  }

  private refreshAll(): void {
    if (!this.session.hasSession()) return;
    for (const q of QUESTIONS) {
      this.refreshQuestion(q.key);
    }
    const fdi = this.session.getFdiQuestionnaire();
    const countryInput = this.panel?.querySelector("#fdi-country") as HTMLInputElement | null;
    if (countryInput) countryInput.value = fdi.country;
  }

  private refreshQuestion(key: keyof FdiQuestionnaireData): void {
    if (!this.session.hasSession()) return;
    const fdi = this.session.getFdiQuestionnaire();
    const currentValue = fdi[key];
    const buttons = this.panel?.querySelectorAll(`.fdi-option-btn[data-key="${key}"]`) as NodeListOf<HTMLElement>;
    buttons?.forEach((btn) => {
      btn.classList.toggle("selected", btn.dataset.value === currentValue);
    });
  }

  private autoCalculate(): void {
    const fdi = this.session.getFdiQuestionnaire();

    // Q5 - Tooth loss: check if any tooth is missing
    fdi.toothLoss = this.calcToothLoss();

    // Q6 - Plaque deposits
    fdi.plaque = this.calcPlaquePct();

    // Q7 - Bleeding on probing
    fdi.bleeding = this.calcBleedingPct();

    // Q8 - Probing depth
    fdi.probingDepth = this.calcProbingDepth();

    this.session.touch();
    this.refreshAll();
  }

  private calcToothLoss(): "no" | "yes" {
    // Same rule as the tooth count: an implant (ICDAS 90/91) is a lost tooth
    const s = this.session.getSession();
    for (const t of sessionTeeth(this.session.getSession())) {
      if (isToothMissing(s, t)) return "yes";
    }
    return "no";
  }

  private calcPlaquePct(): "lt10" | "10to50" | "gt50" {
    const plaque = this.session.getPlaque();
    let total = 0;
    let active = 0;
    for (const t of sessionTeeth(this.session.getSession())) {
      if (!plaque[t].present) continue;
      for (const s of PB_SURFACES) {
        total++;
        if (plaque[t][s]) active++;
      }
    }
    const pct = total > 0 ? (active / total) * 100 : 0;
    if (pct < 10) return "lt10";
    if (pct <= 50) return "10to50";
    return "gt50";
  }

  private calcBleedingPct(): "lt10" | "10to50" | "gt50" {
    const bleeding = this.session.getBleeding();
    let total = 0;
    let active = 0;
    for (const t of sessionTeeth(this.session.getSession())) {
      if (!bleeding[t].present) continue;
      for (const s of PB_SURFACES) {
        total++;
        if (bleeding[t][s]) active++;
      }
    }
    const pct = total > 0 ? (active / total) * 100 : 0;
    if (pct < 10) return "lt10";
    if (pct <= 50) return "10to50";
    return "gt50";
  }

  private calcProbingDepth(): "lt4" | "4to5" | "localized_gt5" | "generalized_gt5" {
    const probing = this.session.getProbing();
    let maxDepth = 0;
    let teethWithGt5 = 0;
    let presentTeeth = 0;

    for (const t of sessionTeeth(this.session.getSession())) {
      const td = probing[t];
      if (!td.present) continue;
      presentTeeth++;
      let toothHasGt5 = false;

      for (const site of PROBING_ALL_SITES) {
        const v = td[site as ProbingSite];
        if (v !== null && v > maxDepth) maxDepth = v;
        if (v !== null && v > 5) toothHasGt5 = true;
      }
      if (toothHasGt5) teethWithGt5++;
    }

    if (maxDepth < 4) return "lt4";
    if (maxDepth <= 5) return "4to5";

    // > 5mm exists; localized vs generalized (threshold: 30% of present teeth)
    const pctGt5 = presentTeeth > 0 ? (teethWithGt5 / presentTeeth) * 100 : 0;
    if (pctGt5 < 30) return "localized_gt5";
    return "generalized_gt5";
  }
}
