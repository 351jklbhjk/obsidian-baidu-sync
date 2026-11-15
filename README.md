# Baidu Netdisk Sync for Obsidian

Version 1.0.1. A modified build based on [owl234/obsidian-baidu-netdisk-sync](https://github.com/owl234/obsidian-baidu-netdisk-sync), MIT License. The original project and author are credited in [NOTICE.md](NOTICE.md).

This build replaces the original shared index with per-device baselines, a conflict choice table and an explicit rename journal.

## Changes in 1.0.1

- File renames use Baidu filemanager opera=rename when the parent directory is unchanged; cross-directory renames use opera=move.
- Folder renames rename the cloud folder first, refresh child metadata, then upload only changed child files.
- Obsidian link updates require a full-file upload because Baidu has no character-level patch API.
- A failed or ambiguous rename keeps its journal entry and stops the run instead of uploading a new file and deleting the old one.
- Startup auto sync is deduplicated; Obsidian's startup config writes no longer cause a second save-triggered sync.
- Ordinary overwrites no longer create .baidu-native-history copies.

## Install

Copy main.js, manifest.json and styles.css into .obsidian/plugins/baidu-netdisk-sync/, restart Obsidian and enable the plugin. Configure your own Baidu Open Platform AppKey/AppSecret. The repository contains no credentials, tokens, native-state.json, sync_manifest.json or native-renames.json.

## Attribution and license

Based on owl234/obsidian-baidu-netdisk-sync. Both the original and this modified build use the MIT License. See [NOTICE.md](NOTICE.md) and [LICENSE](LICENSE).

## Marketplace note

The plugin ID baidu-netdisk-sync belongs to the original community plugin. Before submitting this fork to the Obsidian community marketplace, assign a new unique plugin ID and update the installation folder and settings migration path.

