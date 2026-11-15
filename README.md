# Baidu Netdisk Sync Plus for Obsidian

Version 1.0.2. A modified build based on [owl234/obsidian-baidu-netdisk-sync](https://github.com/owl234/obsidian-baidu-netdisk-sync), MIT License. Original author attribution is retained in [NOTICE.md](NOTICE.md).

The plugin ID is now **baidu-netdisk-sync-plus**, distinct from the original community plugin. The marketplace listing name is **Baidu Netdisk Sync Plus**.

## Features

- Per-device baseline instead of the original shared remote index.
- SHA-256 local content verification and Baidu cloud revision tracking.
- Conflict table: keep local, keep cloud, keep both, or skip.
- Startup auto sync prompts for conflicts; interval/save background sync holds them.
- Explicit file and folder rename journal. Same-parent renames use Baidu filemanager opera=rename; cross-parent renames use opera=move.
- Folder renames reload child metadata before deciding which changed files need upload.
- Reviewed deletions with Obsidian trash and the Baidu recycle bin.
- Four-stage resumable multipart uploads and post-transfer verification.
- No automatic .baidu-native-history copy on ordinary overwrites.

## Install

Copy main.js, manifest.json and styles.css into .obsidian/plugins/baidu-netdisk-sync-plus/, restart Obsidian and enable **Baidu Netdisk Sync Plus**. Configure your own Baidu Open Platform AppKey/AppSecret.

Existing settings under .obsidian/plugins/baidu-netdisk-sync/ are not migrated automatically. Copy data.json into the new folder only if you intend to reuse the old authorization and sync settings.

The repository contains no credentials, tokens, native-state.json, sync_manifest.json or native-renames.json.

## Attribution and license

Based on owl234/obsidian-baidu-netdisk-sync. Both the original and this modified build use the MIT License. See [NOTICE.md](NOTICE.md) and [LICENSE](LICENSE).

## Marketplace

This release uses a unique plugin ID and is ready for submission to the Obsidian community plugin list. The release tag 1.0.2 matches manifest.json and includes main.js, manifest.json, styles.css and a zip asset.

