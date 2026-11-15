import { App, ButtonComponent, Modal, Notice, Setting } from "obsidian";
import type BaiduSyncPlugin from "../main";
import type { BaiduSyncSettings } from "../settings/settings";
import { isWebdavSyncPath, normalizeWebdavPath, webdavPathError } from "../settings/syncPath";

export class SyncPathSetupModal extends Modal {
  private inputEl!: HTMLInputElement;
  private errorEl!: HTMLElement;
  private saveButton?: ButtonComponent;

  constructor(app: App, private plugin: BaiduSyncPlugin) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "设置百度网盘同步路径" });
    contentEl.createEl("p", {
      text: "首次使用需要先选择同步文件夹。默认位置是 /WebDAV/，必须在 WebDAV 下再填写一个文件夹名，例如 /WebDAV/Obsidian。只填写 /WebDAV 或 /WebDAV/ 不允许同步。",
    });
    contentEl.createEl("p", {
      text: "不同路径就是不同的同步目标。首次同步会先核对两端内容，内容相同的文件不会重复上传；保存后不会自动开始同步，请手动执行首次同步。",
    });

    const current = isWebdavSyncPath(this.plugin.settings.remoteBasePath)
      ? this.plugin.settings.remoteBasePath
      : "/WebDAV/";
    new Setting(contentEl)
      .setName("同步文件夹")
      .setDesc("必须位于 /WebDAV/ 下，并填写下一级文件夹名")
      .addText((text) => {
        this.inputEl = text.inputEl;
        text
          .setPlaceholder("/WebDAV/Obsidian")
          .setValue(current)
          .onChange(() => this.updateState());
      });

    this.errorEl = contentEl.createDiv({ cls: "baidu-sync-path-error" });

    new Setting(contentEl)
      .addButton((btn) => {
        this.saveButton = btn;
        btn
          .setButtonText("保存路径")
          .setCta()
          .onClick(async () => {
            const error = webdavPathError(this.inputEl.value);
            if (error) {
              this.errorEl.setText(error);
              return;
            }
            const path = normalizeWebdavPath(this.inputEl.value);
            this.plugin.settings.remoteBasePath = path;
            this.plugin.settings.onboardingComplete = true;
            await this.plugin.saveSettings();
            (this.plugin.engine as unknown as { filter: { updateSettings(settings: BaiduSyncSettings): void } }).filter.updateSettings(this.plugin.settings);
            new Notice(`同步路径已保存：${path}。请手动开始首次同步；自动同步将在下次启动 Obsidian 后生效。`);
            this.close();
          });
      })
      .addButton((btn) => btn.setButtonText("取消").onClick(() => this.close()));

    this.updateState();
  }

  private updateState(): void {
    const error = webdavPathError(this.inputEl?.value ?? "");
    if (this.errorEl) this.errorEl.setText(error ?? "");
    this.saveButton?.setDisabled(error !== null);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
