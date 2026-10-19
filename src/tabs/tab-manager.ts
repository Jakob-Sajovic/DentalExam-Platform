import { TABS } from "../model/constants";

// Interface that each tab controller must implement
export interface TabController {
  init(panel: HTMLElement): void;
  onActivate(): void;
  onDeactivate(): void;
}

export class TabManager {
  private controllers: Map<string, TabController> = new Map();
  private activeTabId: string | null = null;
  private tabBar: HTMLElement;
  private panelContainer: HTMLElement;
  private includePwaOnly: boolean;

  constructor(tabBar: HTMLElement, panelContainer: HTMLElement, includePwaOnly = false) {
    this.tabBar = tabBar;
    this.panelContainer = panelContainer;
    this.includePwaOnly = includePwaOnly;
    this.renderTabBar();
  }

  // Register a controller for a tab
  registerController(tabId: string, controller: TabController): void {
    this.controllers.set(tabId, controller);

    // Initialize the controller with the scrollable inner panel
    const panelOuter = this.panelContainer.querySelector(`[data-tab="${tabId}"]`) as HTMLElement | null;
    if (panelOuter) {
      const panelInner = panelOuter.querySelector(".panel-scroll") as HTMLElement || panelOuter;
      controller.init(panelInner);
    }
  }

  // Switch to a specific tab
  switchTo(tabId: string): void {
    if (this.activeTabId === tabId) return;

    // Deactivate current tab
    if (this.activeTabId) {
      const currentController = this.controllers.get(this.activeTabId);
      if (currentController) {
        currentController.onDeactivate();
      }
      this.setTabActive(this.activeTabId, false);
    }

    // Activate new tab
    this.activeTabId = tabId;
    this.setTabActive(tabId, true);

    const newController = this.controllers.get(tabId);
    if (newController) {
      newController.onActivate();
    }
  }

  getActiveTabId(): string | null {
    return this.activeTabId;
  }

  private renderTabBar(): void {
    this.tabBar.innerHTML = "";
    for (const tab of TABS) {
      if (tab.pwaOnly && !this.includePwaOnly) continue;
      const btn = document.createElement("button");
      btn.className = "tab-btn";
      btn.dataset.tabId = tab.id;
      btn.innerHTML = `<span class="tab-icon">${tab.icon}</span><span class="tab-label">${tab.label}</span>`;
      btn.addEventListener("click", () => this.switchTo(tab.id));
      this.tabBar.appendChild(btn);
    }
  }

  private setTabActive(tabId: string, active: boolean): void {
    // Update tab button
    const btn = this.tabBar.querySelector(`[data-tab-id="${tabId}"]`) as HTMLElement | null;
    if (btn) {
      btn.classList.toggle("active", active);
    }

    // Update panel
    const panel = this.panelContainer.querySelector(`[data-tab="${tabId}"]`) as HTMLElement | null;
    if (panel) {
      panel.classList.toggle("active", active);
    }
  }
}
