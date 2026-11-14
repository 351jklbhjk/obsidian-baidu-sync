# Baidu Netdisk Sync for Obsidian

**Version 1.0.0.** A modified build of [owl234/obsidian-baidu-netdisk-sync](https://github.com/owl234/obsidian-baidu-netdisk-sync), released under the MIT License. The original project and author are credited in [NOTICE.md](NOTICE.md).

This version keeps the plugin ID baidu-netdisk-sync for settings compatibility, but replaces the original index-based reconciliation with a native Baidu API sync engine and an explicit conflict workflow.

## 中文说明

### 来源与授权

本项目基于 **owl234** 的开源项目 [obsidian-baidu-netdisk-sync](https://github.com/owl234/obsidian-baidu-netdisk-sync) 修改，原项目采用 MIT License。修改版本同样采用 MIT License，原作者信息保留在 [NOTICE.md](NOTICE.md)。

### 主要改动

- 不再读取或写入共享的 .baidu-sync-index.json，改为每台设备维护自己的同步基线 native-state.json。
- 优先使用百度递归接口 listall 扫描目录；如果服务端拒绝，自动回退到逐目录 list。
- 本地文件使用 SHA-256 判断内容变化，不只看修改时间；云端版本使用 fs_id + size + server_mtime + cloud md5 作为版本标识。
- 新增冲突选择表：可逐项选择 **保留本地 / 保留云端 / 保留双方 / 跳过**。
- 启动后的自动同步遇到冲突会直接弹出选择表；定时和保存触发的后台同步只记录冲突，避免打断编辑。
- 不再在每次覆盖前自动生成 .baidu-native-history 历史副本；只有选择“保留双方”时才生成 remote-conflict 副本。
- 删除前显示待删除文件；本地删除进入 Obsidian 回收站，云端删除进入百度网盘回收站。
- 上传遵循百度预上传、上传域名、分片上传、创建文件四阶段流程，并保存可恢复的 uploadid。
- 上传和下载后都会重新读取并校验内容；扫描后文件发生变化会中止操作，不覆盖新内容。

### 安装

1. 备份你的 Obsidian 库。
2. 将本仓库的 main.js、manifest.json、styles.css 放入知识库的 .obsidian/plugins/baidu-netdisk-sync/ 目录。
3. 重启 Obsidian，在“第三方插件”中启用 **Baidu Netdisk Sync**。
4. 在插件设置中填写你自己的百度网盘开放平台 AppKey/AppSecret 并完成授权。

本发布包**不包含** data.json、native-state.json、sync_manifest.json 或任何授权令牌。首次使用时需要重新填写或授权；不要将 data.json 提交到 GitHub。

### 使用提示

- 首次同步会先核对两端内容，建议先运行“预览变化”，确认没有异常后再点击“开始同步”。
- 多设备并行没有分布式锁，建议顺序同步。
- 百度没有提供同时报告删除的全量变更日志，因此仍需要读取完整目录快照。
- 修改 E2EE 模式前请先备份两端数据；本版本不执行旧版全量加密迁移。
- 如果原版插件仍在另一台设备运行，建议先统一升级，避免两个版本同时写同一目录。

## English

### Origin

Modified from [owl234/obsidian-baidu-netdisk-sync](https://github.com/owl234/obsidian-baidu-netdisk-sync), MIT License. The original author is credited in [NOTICE.md](NOTICE.md). This modified build is also MIT licensed.

### What this build adds

- No shared remote index. Each device keeps its own baseline.
- Native listall snapshot with exact-directory list fallback.
- SHA-256 local content comparison and cloud revision tracking.
- Conflict table with **Keep local / Keep cloud / Keep both / Skip** choices.
- Startup auto sync prompts for conflicts; interval and save-triggered background sync hold them.
- No automatic history copy on every overwrite; remote-conflict copies are created only when “Keep both” is selected.
- Reviewed deletions using Obsidian trash and the Baidu recycle bin.
- Four-stage resumable multipart uploads with uploadid recovery.
- Post-transfer content verification and abort-on-change checks.

### Install

Copy main.js, manifest.json and styles.css into .obsidian/plugins/baidu-netdisk-sync/, restart Obsidian, and enable the plugin. Configure your own Baidu Open Platform credentials. No credentials, tokens, state files or sync manifests are included.

## Verification

The packaged engine passed 33 automated tests covering pagination, token refresh, content hashes, conflict choices, startup conflict prompting, renames, deletion protection, interrupted writes, resumable uploads and zero-plan sync. Production tests covered a 138-file baseline, upload, download and deletion paths before this release was packaged.

## License

[MIT](LICENSE). See [NOTICE.md](NOTICE.md) for the original project attribution.

