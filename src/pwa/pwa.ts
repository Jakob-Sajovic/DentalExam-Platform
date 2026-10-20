/* global document, window, navigator */

import "../taskpane/taskpane.css";
import "./pwa.css";
import { SessionState } from "../model/session";
import { TabManager } from "../tabs/tab-manager";
import { PwaLandingTabController } from "./tab-pwa-landing";
import { PatientTabController } from "../tabs/tab-patient";
import { PlaqueBleedingTabController } from "../tabs/tab-plaque-bleeding";
import { ICDASTabController } from "../tabs/tab-icdas";
import { ProbingTabController } from "../tabs/tab-probing";
import { RadiographsTabController } from "../tabs/tab-radiographs";
import { Scans3DTabController } from "../tabs/tab-scans3d";
import { NotesTabController } from "../tabs/tab-notes";
import { OhipTabController } from "../tabs/tab-ohip";
import { FdiTabController } from "../tabs/tab-fdi";
import { SaveReportTabController } from "../tabs/tab-save-report";
import { PwaStore } from "./pwa-store";

const AUTOSAVE_DEBOUNCE_MS = 1500;

// Injected by webpack's DefinePlugin; changes on every build.
declare const __PWA_BUILD_ID__: string;

function initApp(): void {
  const tabBar = document.getElementById("tab-bar") as HTMLElement;
  const panelContainer = document.getElementById("panel-container") as HTMLElement;

  const session = SessionState.getInstance();
  const store = new PwaStore();
  const tabManager = new TabManager(tabBar, panelContainer, true);

  const landingCtrl = new PwaLandingTabController(session, store);
  landingCtrl.setTabManager(tabManager);

  tabManager.registerController("landing", landingCtrl);
  tabManager.registerController("patient", new PatientTabController(session));
  tabManager.registerController("plaque-bleeding", new PlaqueBleedingTabController(session));
  tabManager.registerController("icdas", new ICDASTabController(session));
  tabManager.registerController("probing", new ProbingTabController(session));
  tabManager.registerController("radiographs", new RadiographsTabController(session));
  tabManager.registerController("scans3d", new Scans3DTabController(session, store.scanFiles));
  tabManager.registerController("notes", new NotesTabController(session));
  tabManager.registerController("ohip", new OhipTabController(session));
  tabManager.registerController("fdi", new FdiTabController(session));
  tabManager.registerController("save-report", new SaveReportTabController(session, store));

  const buildEl = document.getElementById("build-id");
  if (buildEl) buildEl.textContent = `platforma · različica ${__PWA_BUILD_ID__}`;

  wireAutosave(session, store);
  tabManager.switchTo("landing");
}

/**
 * The add-in relies on the examiner pressing Save. Here the app owns the only
 * copy of the data until it is exported, so every change is written back to
 * IndexedDB — debounced, and again on the way out of the page.
 */
function wireAutosave(session: SessionState, store: PwaStore): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const indicator = document.getElementById("autosave-indicator");

  const flush = () => {
    if (!session.hasSession()) return;
    store.local
      .autosave(session.getSession())
      .then(() => {
        if (indicator) {
          indicator.textContent = `shranjeno ${new Date().toLocaleTimeString("sl-SI")}`;
          indicator.className = "autosave-indicator ok";
        }
      })
      .catch((err: unknown) => {
        if (indicator) {
          indicator.textContent = `NI SHRANJENO: ${err instanceof Error ? err.message : String(err)}`;
          indicator.className = "autosave-indicator error";
        }
      });
  };

  session.onChange(() => {
    if (indicator && session.hasSession()) {
      indicator.textContent = "shranjujem ...";
      indicator.className = "autosave-indicator pending";
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, AUTOSAVE_DEBOUNCE_MS);
  });

  // Leaving the page, backgrounding the app, or switching apps on a tablet
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}

/**
 * Offline support, plus telling the operator when a new build is available.
 *
 * Without this an installed app keeps serving the cached bundle and the only
 * way to pick up a deploy is a double reload — easy to get wrong, and
 * impossible to verify. The banner makes the update explicit and the build id
 * in the status bar makes it checkable.
 */
function wireServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;

  const banner = document.getElementById("update-banner");
  const reloadBtn = document.getElementById("update-reload-btn");
  const showBanner = () => {
    if (banner) banner.hidden = false;
  };
  reloadBtn?.addEventListener("click", () => window.location.reload());

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("sw.js")
      .then((reg) => {
        // A worker already waiting means an update landed on a previous visit.
        if (reg.waiting && navigator.serviceWorker.controller) showBanner();

        reg.addEventListener("updatefound", () => {
          const incoming = reg.installing;
          if (!incoming) return;
          incoming.addEventListener("statechange", () => {
            // "installed" with an existing controller = an update, not a first install.
            if (incoming.state === "installed" && navigator.serviceWorker.controller) {
              showBanner();
            }
          });
        });

        // Check again whenever the app is brought back to the foreground, so a
        // deploy is noticed without having to fully restart the app.
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") reg.update().catch(() => undefined);
        });
      })
      .catch(() => {
        // Offline support is a bonus; the app works without it.
      });
  });
}

wireServiceWorker();
