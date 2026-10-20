/* global document, HTMLElement, HTMLInputElement, HTMLButtonElement */

import { TabController, TabManager } from "../tabs/tab-manager";
import { SessionState } from "../model/session";
import { PwaStore } from "./pwa-store";
import { LocalSessionInfo } from "../storage/session-store";
import { storageEstimate, requestPersistence } from "./idb";
import { formatBytes } from "../images/image-utils";

function esc(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Landing page for the standalone app. Unlike the add-in there is no host
 * workbook to load from, so this lists the examinations held in this device's
 * browser storage and makes the un-exported ones impossible to miss.
 */
export class PwaLandingTabController implements TabController {
  private panel: HTMLElement | null = null;
  private session: SessionState;
  private store: PwaStore;
  private tabManager: TabManager | null = null;
  private listEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private confirmingDelete: string | null = null;
  // Guards against out-of-order refreshes: init(), onActivate() and every
  // list action can start one, and a slow earlier read must not overwrite a
  // faster later one.
  private refreshToken = 0;

  constructor(session: SessionState, store: PwaStore) {
    this.session = session;
    this.store = store;
  }

  setTabManager(tabManager: TabManager): void {
    this.tabManager = tabManager;
  }

  init(panel: HTMLElement): void {
    this.panel = panel;
    panel.innerHTML = `
      <div class="landing-container">
        <h1 class="landing-title">Zobozdravstveni pregled</h1>
        <p class="landing-subtitle">Platforma · s 3D skeni</p>

        <div class="landing-actions">
          <button id="btn-new-session" class="btn btn-primary btn-large">
            <span class="btn-icon">➕</span> Nov pregled
          </button>
          <button id="btn-import-file" class="btn btn-secondary btn-large">
            <span class="btn-icon">📁</span> Uvozi iz datoteke (.xlsx)
          </button>
          <input type="file" id="file-import-input" accept=".xlsx,.xls" style="display:none;" />
        </div>

        <div id="session-status" class="session-status"></div>

        <div class="pwa-section">
          <div class="pwa-section-head">
            <h2 class="pwa-section-title">Shranjeni pregledi v tej napravi</h2>
            <button id="btn-export-all" class="btn btn-secondary btn-sm">Izvozi vse</button>
          </div>
          <div id="pwa-session-list"></div>
          <div id="pwa-storage-note" class="form-hint"></div>
        </div>

        <p class="tab-help-footer">
          Pregledi se shranjujejo v pomnilnik te naprave in brskalnika, tudi brez povezave.
          <strong>Dokler pregleda ne izvozite v .xlsx, obstaja samo tukaj</strong> — če pobrišete
          podatke brskalnika ali odstranite aplikacijo, je izgubljen.
        </p>
      </div>
    `;

    this.listEl = panel.querySelector("#pwa-session-list") as HTMLElement;
    this.statusEl = panel.querySelector("#session-status") as HTMLElement;

    const fileInput = panel.querySelector("#file-import-input") as HTMLInputElement;
    (panel.querySelector("#btn-new-session") as HTMLButtonElement)
      .addEventListener("click", () => this.handleNewSession());
    (panel.querySelector("#btn-import-file") as HTMLButtonElement)
      .addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => void this.handleFileImport(fileInput));
    (panel.querySelector("#btn-export-all") as HTMLButtonElement)
      .addEventListener("click", () => void this.handleExportAll());

    void requestPersistence();
    void this.refreshList();
  }

  onActivate(): void {
    this.updateStatus();
    void this.refreshList();
  }

  onDeactivate(): void {
    this.confirmingDelete = null;
  }

  private handleNewSession(): void {
    this.session.newSession();
    this.updateStatus();
    this.tabManager?.switchTo("patient");
  }

  private async handleFileImport(fileInput: HTMLInputElement): Promise<void> {
    const file = fileInput.files?.[0];
    if (!file) return;
    fileInput.value = "";

    this.setStatus("Uvažanje datoteke ...", false);
    try {
      const data = await this.store.loadFromFile(file);
      if (!data) {
        this.setStatus("V izbrani datoteki ni podatkov pregleda.", false);
        return;
      }
      this.session.loadSession(data);
      this.updateStatus();
      await this.refreshList();
      this.tabManager?.switchTo("patient");
    } catch (err) {
      this.setStatus(`Napaka pri uvozu: ${err instanceof Error ? err.message : String(err)}`, false);
    }
  }

  private async handleExportAll(): Promise<void> {
    try {
      const msg = await this.store.local.exportAll();
      this.setStatus(msg, true);
      await this.refreshList();
    } catch (err) {
      this.setStatus(err instanceof Error ? err.message : String(err), false);
    }
  }

  private async refreshList(): Promise<void> {
    if (!this.listEl) return;
    const token = ++this.refreshToken;
    const current = () => token === this.refreshToken;

    // Both awaits happen up front, then every DOM write lands in one
    // synchronous block: otherwise the list and the storage note could be
    // painted by two different refreshes and disagree with each other.
    let sessions: LocalSessionInfo[];
    let estimate: { usage: number; quota: number } | null;
    try {
      [sessions, estimate] = await Promise.all([this.store.local.list(), storageEstimate()]);
    } catch (err) {
      if (!current()) return;
      this.listEl.innerHTML = `<p class="placeholder-text">Lokalna baza ni na voljo: ${esc(
        err instanceof Error ? err.message : String(err)
      )}</p>`;
      return;
    }
    if (!current()) return;

    if (sessions.length === 0) {
      this.listEl.innerHTML = `<p class="placeholder-text">Ni shranjenih pregledov.</p>`;
    } else {
      const activeId = this.session.hasSession() ? this.session.getSession().sessionId : null;
      this.listEl.innerHTML = sessions.map((s) => {
        const isActive = s.sessionId === activeId;
        const armed = this.confirmingDelete === s.sessionId;
        return `
          <div class="pwa-session-row${isActive ? " active" : ""}">
            <div class="pwa-session-info">
              <div class="pwa-session-title">
                ${esc(s.title)}
                ${s.exported ? `<span class="pwa-badge pwa-badge-ok">izvoženo</span>`
                             : `<span class="pwa-badge pwa-badge-warn">ni izvoženo</span>`}
              </div>
              <div class="pwa-session-sub">${esc(s.subtitle)} · ${new Date(s.modifiedAt).toLocaleString("sl-SI")}</div>
            </div>
            <div class="pwa-session-actions">
              <button class="btn btn-secondary btn-sm" data-open="${s.sessionId}">${isActive ? "Aktiven" : "Odpri"}</button>
              <button class="btn btn-danger-outline btn-sm${armed ? " btn-danger-armed" : ""}" data-del="${s.sessionId}">
                ${armed ? "Ste prepričani?" : "Izbriši"}
              </button>
            </div>
          </div>`;
      }).join("");

      this.listEl.querySelectorAll<HTMLButtonElement>("[data-open]").forEach((btn) => {
        btn.addEventListener("click", () => void this.handleOpen(btn.dataset.open as string));
      });
      this.listEl.querySelectorAll<HTMLButtonElement>("[data-del]").forEach((btn) => {
        btn.addEventListener("click", () => void this.handleDelete(btn.dataset.del as string));
      });
    }

    const note = this.panel?.querySelector("#pwa-storage-note") as HTMLElement | null;
    if (note) {
      const unexported = sessions.filter((s) => !s.exported).length;
      const parts: string[] = [];
      if (unexported === 1) parts.push("1 pregled še ni izvožen v .xlsx");
      else if (unexported > 1) parts.push(`${unexported} pregledov še ni izvoženih v .xlsx`);
      if (estimate && estimate.quota > 0) {
        parts.push(`porabljeno ${formatBytes(estimate.usage)} od ${formatBytes(estimate.quota)}`);
      }
      note.textContent = parts.join(" · ");
      note.style.color = unexported > 0 ? "#a4262c" : "#605e5c";
    }
  }

  private async handleOpen(sessionId: string): Promise<void> {
    try {
      const data = await this.store.local.open(sessionId);
      if (!data) {
        this.setStatus("Pregleda ni bilo mogoče odpreti.", false);
        return;
      }
      this.session.loadSession(data);
      this.updateStatus();
      await this.refreshList();
      this.tabManager?.switchTo("patient");
    } catch (err) {
      this.setStatus(`Napaka: ${err instanceof Error ? err.message : String(err)}`, false);
    }
  }

  // Two-click confirmation, same pattern the rest of the app uses.
  private async handleDelete(sessionId: string): Promise<void> {
    if (this.confirmingDelete !== sessionId) {
      this.confirmingDelete = sessionId;
      await this.refreshList();
      setTimeout(() => {
        if (this.confirmingDelete === sessionId) {
          this.confirmingDelete = null;
          void this.refreshList();
        }
      }, 3000);
      return;
    }

    this.confirmingDelete = null;
    try {
      await this.store.local.remove(sessionId);
      if (this.session.hasSession() && this.session.getSession().sessionId === sessionId) {
        this.session.resetSession();
      }
      this.updateStatus();
      await this.refreshList();
    } catch (err) {
      this.setStatus(`Napaka pri brisanju: ${err instanceof Error ? err.message : String(err)}`, false);
    }
  }

  private setStatus(text: string, ok: boolean): void {
    if (!this.statusEl) return;
    this.statusEl.textContent = text;
    this.statusEl.className = ok ? "session-status active" : "session-status";
  }

  private updateStatus(): void {
    if (!this.statusEl) return;
    if (this.session.hasSession()) {
      const s = this.session.getSession();
      const p = s.patient;
      const who = p.code || `${p.firstName} ${p.lastName}`.trim() || s.sessionId;
      this.statusEl.textContent = `Aktiven pregled: ${who} (${p.checkup || 1}. pregled)`;
      this.statusEl.className = "session-status active";
    } else {
      this.statusEl.textContent = "Ni aktivnega pregleda.";
      this.statusEl.className = "session-status";
    }
  }
}
