import { TabController } from "./tab-manager";
import { SessionState } from "../model/session";
import {
  SEX_LABELS,
  SETTLEMENT_LABELS,
  STAT_REGIONS,
  Sex,
  Settlement,
  StatRegion,
  ageFromBirthDate,
  effectiveAge,
  todayIso,
  fdiAgeBand,
  formatAge,
} from "../model/demographics";
import { DENTITIONS, DENTITION_LABELS, normalizeDentition } from "../model/dentition";

function options(values: readonly string[], labels?: Record<string, string>): string {
  return `<option value="">—</option>` + values.map((v) => `<option value="${v}">${labels ? labels[v] : v}</option>`).join("");
}

export class PatientTabController implements TabController {
  private panel: HTMLElement | null = null;
  private session: SessionState;

  // Form field references
  private dateInput: HTMLInputElement | null = null;
  private checkupSelect: HTMLSelectElement | null = null;
  private firstNameInput: HTMLInputElement | null = null;
  private lastNameInput: HTMLInputElement | null = null;
  private codeInput: HTMLInputElement | null = null;
  private examinerFirstNameInput: HTMLInputElement | null = null;
  private examinerLastNameInput: HTMLInputElement | null = null;
  private validationBanner: HTMLElement | null = null;

  constructor(session: SessionState) {
    this.session = session;
  }

  init(panel: HTMLElement): void {
    this.panel = panel;
    panel.innerHTML = `
      <div class="tab-content-inner">
        <h2>Podatki o preiskovancu</h2>
        <div id="patient-validation" class="validation-banner">
          Vnesite ime in priimek ali kodo preiskovanca.
        </div>
        <div class="form-group">
          <label class="form-label" for="patient-date">Datum pregleda</label>
          <input type="date" id="patient-date" class="form-input" />
        </div>
        <div class="form-group">
          <label class="form-label" for="patient-checkup">Zaporedna številka pregleda</label>
          <select id="patient-checkup" class="form-input">
            ${Array.from({ length: 10 }, (_, i) => `<option value="${i + 1}">${i + 1}. pregled</option>`).join("")}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="patient-firstname">Ime</label>
          <input type="text" id="patient-firstname" class="form-input" placeholder="Ime preiskovanca" autocomplete="off" />
        </div>
        <div class="form-group">
          <label class="form-label" for="patient-lastname">Priimek</label>
          <input type="text" id="patient-lastname" class="form-input" placeholder="Priimek preiskovanca" autocomplete="off" />
        </div>
        <p class="form-hint" style="text-align:center; margin: -8px 0 16px;">— ali —</p>
        <div class="form-group">
          <label class="form-label" for="patient-code">Koda preiskovanca</label>
          <input type="text" id="patient-code" class="form-input" placeholder="Šifra / koda" autocomplete="off" />
        </div>
        <hr style="margin: 16px 0; border: none; border-top: 1px solid #e0e0e0;" />
        <h3 style="font-size: 13px; color: #323130; margin-bottom: 8px;">Demografski podatki</h3>
        <div class="demo-grid">
          <div class="form-group">
            <label class="form-label" for="demo-dentition">Zobovje</label>
            <select id="demo-dentition" class="form-input">${DENTITIONS.map((v) => `<option value="${v}">${DENTITION_LABELS[v]}</option>`).join("")}</select>
          </div>
          <div class="form-group">
            <label class="form-label" for="demo-sex">Spol</label>
            <select id="demo-sex" class="form-input">${options(Object.keys(SEX_LABELS), SEX_LABELS)}</select>
          </div>
          <div class="form-group">
            <label class="form-label" for="demo-birth">Datum rojstva <span class="form-hint">(neobvezno)</span></label>
            <input type="date" id="demo-birth" class="form-input" />
          </div>
          <div class="form-group">
            <label class="form-label" for="demo-age">Starost ob pregledu (leta)</label>
            <input type="number" id="demo-age" class="form-input" min="0" max="120" step="0.1" inputmode="decimal" />
            <div class="form-hint" id="demo-age-hint"></div>
          </div>
          <div class="form-group">
            <label class="form-label" for="demo-residence">Kraj bivanja</label>
            <input type="text" id="demo-residence" class="form-input" placeholder="Kraj" autocomplete="off" />
          </div>
          <div class="form-group">
            <label class="form-label" for="demo-settlement">Okolje bivanja</label>
            <select id="demo-settlement" class="form-input">${options(Object.keys(SETTLEMENT_LABELS), SETTLEMENT_LABELS)}</select>
          </div>
          <div class="form-group">
            <label class="form-label" for="demo-region">Statistična regija</label>
            <select id="demo-region" class="form-input">${options(STAT_REGIONS)}</select>
          </div>
        </div>
        <p class="form-hint">Zobovje določa zobe na vseh kartah (VPI/GBI, ICDAS, globine, zalivke, 3D): mlečni zobje
          so pod svojimi stalnimi nasledniki. Spol in starost izpolnita vprašanji 1 in 2 vprašalnika FDI; spol določa
          tabelo za izračun parodontalne rane.</p>
        <hr style="margin: 16px 0; border: none; border-top: 1px solid #e0e0e0;" />
        <h3 style="font-size: 13px; color: #323130; margin-bottom: 8px;">Izvajalec pregleda</h3>
        <div class="form-group">
          <label class="form-label" for="examiner-firstname">Ime izvajalca</label>
          <input type="text" id="examiner-firstname" class="form-input" placeholder="Ime" autocomplete="off" />
        </div>
        <div class="form-group">
          <label class="form-label" for="examiner-lastname">Priimek izvajalca</label>
          <input type="text" id="examiner-lastname" class="form-input" placeholder="Priimek" autocomplete="off" />
        </div>
        <p class="tab-help-footer">
          Vnesite datum pregleda in podatke o preiskovancu. Obvezno je ime in priimek ali koda preiskovanca.
        </p>
      </div>
    `;

    this.dateInput = panel.querySelector("#patient-date") as HTMLInputElement;
    this.checkupSelect = panel.querySelector("#patient-checkup") as HTMLSelectElement;
    this.firstNameInput = panel.querySelector("#patient-firstname") as HTMLInputElement;
    this.lastNameInput = panel.querySelector("#patient-lastname") as HTMLInputElement;
    this.codeInput = panel.querySelector("#patient-code") as HTMLInputElement;
    this.examinerFirstNameInput = panel.querySelector("#examiner-firstname") as HTMLInputElement;
    this.examinerLastNameInput = panel.querySelector("#examiner-lastname") as HTMLInputElement;
    this.validationBanner = panel.querySelector("#patient-validation") as HTMLElement;

    // Live validation on input
    const validate = () => this.validateAndShow();
    this.firstNameInput.addEventListener("input", validate);
    this.lastNameInput.addEventListener("input", validate);
    this.codeInput.addEventListener("input", validate);

    for (const id of ["demo-sex", "demo-birth", "demo-age", "demo-residence", "demo-settlement", "demo-region"]) {
      const el = panel.querySelector(`#${id}`) as HTMLInputElement;
      el.addEventListener(el.tagName === "SELECT" ? "change" : "input", () => this.writeDemographics(id));
    }
    (panel.querySelector("#demo-dentition") as HTMLSelectElement).addEventListener("change", (e) => {
      if (!this.session.hasSession()) return;
      this.session.setDentition(normalizeDentition((e.target as HTMLSelectElement).value));
    });
  }

  private field<T extends HTMLElement>(id: string): T {
    return this.panel?.querySelector(`#${id}`) as T;
  }

  /** Demographics are saved as they are typed, and passed on to the FDI questionnaire. */
  private writeDemographics(changed?: string): void {
    if (!this.session.hasSession()) return;
    const d = this.session.getDemographics();
    d.sex = (this.field<HTMLSelectElement>("demo-sex").value || null) as Sex | null;
    d.birthDate = this.field<HTMLInputElement>("demo-birth").value;
    if (changed === "demo-birth") {
      // A birth date fills in the age, as of today; clearing it keeps the age
      const fromBirth = ageFromBirthDate(d.birthDate, todayIso());
      if (fromBirth !== null) d.ageYears = fromBirth;
    } else if (changed === "demo-age") {
      // An age alone never fills in a birth date
      const typed = parseFloat(this.field<HTMLInputElement>("demo-age").value.replace(",", "."));
      d.ageYears = Number.isFinite(typed) ? typed : null;
    }
    d.residence = this.field<HTMLInputElement>("demo-residence").value.trim();
    d.settlement = (this.field<HTMLSelectElement>("demo-settlement").value || null) as Settlement | null;
    d.region = (this.field<HTMLSelectElement>("demo-region").value || null) as StatRegion | null;

    const age = effectiveAge(d);
    const fdi = this.session.getFdiQuestionnaire();
    if (d.sex) fdi.gender = d.sex;
    if (age !== null) fdi.age = fdiAgeBand(age);
    this.session.touch();
    this.showAge(changed !== "demo-age");
  }

  /** With a valid birth date the age comes from it and the age field is locked. */
  private showAge(fillField = true): void {
    const d = this.session.getDemographics();
    const fromBirth = ageFromBirthDate(d.birthDate, todayIso()) !== null;
    const ageInput = this.field<HTMLInputElement>("demo-age");
    ageInput.disabled = fromBirth;
    if (fillField) ageInput.value = d.ageYears === null ? "" : String(d.ageYears);
    this.field<HTMLElement>("demo-age-hint").textContent =
      d.ageYears === null ? "" : `${formatAge(d.ageYears)}${fromBirth ? " — izračunano iz datuma rojstva na današnji dan" : ""}`;
  }

  onActivate(): void {
    if (!this.session.hasSession()) return;
    const patient = this.session.getPatient();
    const examiner = this.session.getExaminer();

    if (this.dateInput) this.dateInput.value = patient.date;
    if (this.checkupSelect) this.checkupSelect.value = String(patient.checkup || 1);
    if (this.firstNameInput) this.firstNameInput.value = patient.firstName;
    if (this.lastNameInput) this.lastNameInput.value = patient.lastName;
    if (this.codeInput) this.codeInput.value = patient.code;
    if (this.examinerFirstNameInput) this.examinerFirstNameInput.value = examiner.firstName;
    if (this.examinerLastNameInput) this.examinerLastNameInput.value = examiner.lastName;

    const d = this.session.getDemographics();
    this.field<HTMLSelectElement>("demo-sex").value = d.sex || "";
    this.field<HTMLInputElement>("demo-birth").value = d.birthDate;
    this.field<HTMLInputElement>("demo-age").value = d.ageYears === null ? "" : String(d.ageYears);
    this.field<HTMLInputElement>("demo-residence").value = d.residence;
    this.field<HTMLSelectElement>("demo-settlement").value = d.settlement || "";
    this.field<HTMLSelectElement>("demo-region").value = d.region || "";
    this.field<HTMLSelectElement>("demo-dentition").value = d.dentition;
    this.showAge();

    this.validateAndShow();
  }

  onDeactivate(): void {
    if (!this.session.hasSession()) return;
    this.writeToSession();
  }

  private writeToSession(): void {
    const patient = this.session.getPatient();
    patient.date = this.dateInput?.value || patient.date;
    patient.checkup = parseInt(this.checkupSelect?.value || "1", 10);
    patient.firstName = this.firstNameInput?.value.trim() || "";
    patient.lastName = this.lastNameInput?.value.trim() || "";
    patient.code = this.codeInput?.value.trim() || "";

    const examiner = this.session.getExaminer();
    examiner.firstName = this.examinerFirstNameInput?.value.trim() || "";
    examiner.lastName = this.examinerLastNameInput?.value.trim() || "";
    this.session.touch();
  }

  private validateAndShow(): void {
    const firstName = this.firstNameInput?.value.trim() || "";
    const lastName = this.lastNameInput?.value.trim() || "";
    const code = this.codeInput?.value.trim() || "";

    const isValid = (firstName !== "" && lastName !== "") || code !== "";

    if (this.validationBanner) {
      this.validationBanner.classList.toggle("visible", !isValid);
    }
  }
}
