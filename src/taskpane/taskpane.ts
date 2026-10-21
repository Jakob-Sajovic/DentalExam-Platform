/* global document, Office */

import "./taskpane.css";
import { SessionState } from "../model/session";
import { TabManager } from "../tabs/tab-manager";
import { LandingTabController } from "../tabs/tab-landing";
import { PatientTabController } from "../tabs/tab-patient";
import { PlaqueBleedingTabController } from "../tabs/tab-plaque-bleeding";
import { ICDASTabController } from "../tabs/tab-icdas";
import { FillingsTabController } from "../tabs/tab-fillings";
import { ProbingTabController } from "../tabs/tab-probing";
import { RadiographsTabController } from "../tabs/tab-radiographs";
import { NotesTabController } from "../tabs/tab-notes";
import { OhipTabController } from "../tabs/tab-ohip";
import { FdiTabController } from "../tabs/tab-fdi";
import { SaveReportTabController } from "../tabs/tab-save-report";

let initialized = false;

function initApp() {
  if (initialized) return;
  initialized = true;
  const tabBar = document.getElementById("tab-bar") as HTMLElement;
  const panelContainer = document.getElementById("panel-container") as HTMLElement;

  const session = SessionState.getInstance();
  const tabManager = new TabManager(tabBar, panelContainer);

  // Create controllers
  const landingCtrl = new LandingTabController(session);
  landingCtrl.setTabManager(tabManager);

  const patientCtrl = new PatientTabController(session);
  const plaqueBleedingCtrl = new PlaqueBleedingTabController(session);
  const icdasCtrl = new ICDASTabController(session);
  const probingCtrl = new ProbingTabController(session);
  const radiographsCtrl = new RadiographsTabController(session);
  const notesCtrl = new NotesTabController(session);
  const ohipCtrl = new OhipTabController(session);
  const fdiCtrl = new FdiTabController(session);
  const saveReportCtrl = new SaveReportTabController(session);

  // Register controllers — each receives its panel via init()
  tabManager.registerController("landing", landingCtrl);
  tabManager.registerController("patient", patientCtrl);
  tabManager.registerController("plaque-bleeding", plaqueBleedingCtrl);
  tabManager.registerController("icdas", icdasCtrl);
  tabManager.registerController("fillings", new FillingsTabController(session));
  tabManager.registerController("probing", probingCtrl);
  tabManager.registerController("radiographs", radiographsCtrl);
  tabManager.registerController("notes", notesCtrl);
  tabManager.registerController("ohip", ohipCtrl);
  tabManager.registerController("fdi", fdiCtrl);
  tabManager.registerController("save-report", saveReportCtrl);

  // Start on Landing tab
  tabManager.switchTo("landing");
}

Office.onReady(() => { initApp(); });

// Fallback: if Office.onReady doesn't fire within 8 seconds, init anyway
setTimeout(() => {
  if (!initialized) {
    initApp();
  }
}, 8000);
