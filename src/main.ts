import { Plugin, Notice, TAbstractFile } from "obsidian";
import { BaiduSyncSettings, DEFAULT_SETTINGS } from "./settings/settings";
import { BaiduSyncSettingTab } from "./settings/settingsTab";
import { BaiduOAuthManager } from "./baidu/oauth";
import { BaiduClient } from "./baidu/client";
import { ManifestManager } from "./sync/manifest";
import { SyncEngine } from "./sync/engine";
import { StatusBarManager } from "./ui/statusBar";
import { SyncLogModal } from "./ui/logModal";
import { SyncPathSetupModal } from "./ui/syncPathSetupModal";
import { isWebdavSyncPath } from "./settings/syncPath";

export default class BaiduSyncPlugin extends Plugin {
  settings: BaiduSyncSettings = DEFAULT_SETTINGS;
  oauth!: BaiduOAuthManager;
  client!: BaiduClient;
  manifestMgr!: ManifestManager;
  engine!: SyncEngine;
  statusBar!: StatusBarManager;

  private intervalId: number | null = null;
  private saveDebounceTimer: number | null = null;
  private startupTimer: number | null = null;
  private setupTimer: number | null = null;
  private startupGraceUntil = 0;
  private ribbonIconEl: HTMLElement | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    // Initialize core subsystems
    const configDir = this.app.vault.configDir;
    const manifestPath = `${this.manifest.dir || `${configDir}/plugins/baidu-netdisk-sync`}/sync_manifest.json`;
    this.manifestMgr = new ManifestManager(this.app.vault.adapter, manifestPath);

    this.oauth = new BaiduOAuthManager(
      () => this.settings,
      async (s) => {
        this.settings = s;
        await this.saveData(this.settings);
      }
    );

    this.client = new BaiduClient(this.oauth);

    this.engine = new SyncEngine(
      this.app,
      () => this.settings,
      async (s) => {
        this.settings = s;
        await this.saveData(this.settings);
      },
      this.client,
      this.manifestMgr
    );
    (this.engine as unknown as { onSetupRequired?: () => boolean }).onSetupRequired = () => {
      if (!this.needsSyncPathSetup()) return false;
      this.openSyncPathSetup();
      return true;
    };

    // Setup Status Bar
    const statusBarItem = this.addStatusBarItem();
    this.statusBar = new StatusBarManager(statusBarItem, this.engine, () => {
      new SyncLogModal(this.app, this.engine).open();
    });

    // Setup Left Ribbon Icon
    this.ribbonIconEl = this.addRibbonIcon("cloud", "百度网盘同步", async () => {
      if (this.settings.ribbonAction === "syncNow") {
        await this.runManualSync();
      } else {
        new SyncLogModal(this.app, this.engine).open();
      }
    });

    this.engine.onStateChange((state) => {
      if (this.ribbonIconEl) {
        if (state === "syncing" || state === "diffing" || state === "preparing") {
          this.ribbonIconEl.addClass("baidu-sync-spinning");
        } else {
          this.ribbonIconEl.removeClass("baidu-sync-spinning");
        }
      }
    });

    // Register Commands
    this.addCommand({
      id: "baidu-sync-now",
      name: "立即执行同步 (Sync Now)",
      callback: async () => {
        await this.runManualSync();
      }
    });

    this.addCommand({
      id: "baidu-sync-view-logs",
      name: "查看同步日志 (View Sync Logs)",
      callback: () => {
        new SyncLogModal(this.app, this.engine).open();
      }
    });

    this.addCommand({
      id: "baidu-sync-setup",
      name: "设置同步路径",
      callback: () => this.openSyncPathSetup(),
    });

    // Register Settings Tab
    this.addSettingTab(new BaiduSyncSettingTab(this.app, this));

    // Setup Automation Triggers
    this.setupTriggers();

    if (this.needsSyncPathSetup()) {
      this.setupTimer = window.setTimeout(() => {
        this.setupTimer = null;
        if (this.needsSyncPathSetup()) this.openSyncPathSetup();
      }, 400);
    }
  }

  onunload(): void {
    if (this.setupTimer !== null) {
      window.clearTimeout(this.setupTimer);
      this.setupTimer = null;
    }
    if (this.startupTimer !== null) {
      window.clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.saveDebounceTimer !== null) {
      window.clearTimeout(this.saveDebounceTimer);
      this.saveDebounceTimer = null;
    }
  }

  async loadSettings(): Promise<void> {
    const raw = (await this.loadData()) as Partial<BaiduSyncSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, raw || {});
    const validPath = isWebdavSyncPath(this.settings.remoteBasePath);
    if (raw && raw.onboardingComplete === undefined && validPath) {
      this.settings.onboardingComplete = true;
    } else if (!validPath) {
      this.settings.onboardingComplete = false;
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  resetInterval(): void {
    if (this.needsSyncPathSetup()) return;
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }

    if (this.settings.syncIntervalMinutes > 0) {
      const ms = this.settings.syncIntervalMinutes * 60 * 1000;
      this.intervalId = window.setInterval(async () => {
        if (this.settings.accessToken) {
          await this.engine.startSync(true); // Silent sync
        }
      }, ms);
    }
  }

  private setupTriggers(): void {
    if (this.needsSyncPathSetup()) {
      this.engine.addLog("info", "首次安装：请先设置 /WebDAV/ 下的同步文件夹；自动同步暂未启动");
      return;
    }
    // 1. Startup trigger
    if (this.settings.syncOnStartup && this.settings.accessToken) {
      this.startupGraceUntil = Date.now() + 10000;
      if (this.saveDebounceTimer !== null) {
        window.clearTimeout(this.saveDebounceTimer);
        this.saveDebounceTimer = null;
      }
      this.engine.addLog("info", "启动自动同步已安排，将于 3 秒后执行");
      // Delay 3s to let Obsidian complete internal indexing
      this.startupTimer = window.setTimeout(async () => {
        await this.engine.startSync(true);
      }, 3000);
    }

    // 2. Periodic sync
    this.resetInterval();

    // 3. Save / Modify debounced trigger
    const onVaultChange = (file: TAbstractFile) => {
      if (!this.settings.syncOnSave || !this.settings.accessToken) return;
      if (Date.now() < this.startupGraceUntil) return;
      if (this.engine.isSyncing()) return;
      if (
        file.path.includes("sync_manifest.json") ||
        file.path.includes("native-state.json") ||
        file.path.includes("native-plan.json") ||
        file.path.includes("native-renames.json") ||
        file.path.includes("/baidu-sync/") ||
        file.path.includes("workspace")
      )
        return;

      if (this.saveDebounceTimer !== null) {
        window.clearTimeout(this.saveDebounceTimer);
      }

      const debounceMs = (this.settings.syncDebounceSeconds || 5) * 1000;
      this.saveDebounceTimer = window.setTimeout(async () => {
        await this.engine.startSync(true);
      }, debounceMs);
    };

    this.registerEvent(this.app.vault.on("modify", onVaultChange));
    this.registerEvent(this.app.vault.on("create", onVaultChange));
    this.registerEvent(this.app.vault.on("delete", onVaultChange));
  }

  private needsSyncPathSetup(): boolean {
    return !this.settings.onboardingComplete || !isWebdavSyncPath(this.settings.remoteBasePath);
  }

  private async runManualSync(): Promise<void> {
    if (this.engine.isSyncing()) {
      new Notice("同步正在进行，请稍候");
      return;
    }
    new Notice("正在启动百度网盘同步...");
    const res = (await this.engine.startSync(false)) as {
      success: boolean;
      busy?: boolean;
      setupRequired?: boolean;
      cancelled?: boolean;
    };
    if (this.engine.isSyncing() || res.busy) {
      new Notice("同步正在进行，请稍候");
      return;
    }
    if (res.setupRequired || res.cancelled) return;
    if (res.success) {
      new Notice("百度网盘同步完成！");
    } else {
      new Notice("同步未完成，请查看同步日志");
    }
  }

  private openSyncPathSetup(): void {
    new SyncPathSetupModal(this.app, this).open();
  }
}
