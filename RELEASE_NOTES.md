# 1.0.1

Maintenance release for [351jklbhjk/obsidian-baidu-sync](https://github.com/351jklbhjk/obsidian-baidu-sync), based on [owl234/obsidian-baidu-netdisk-sync](https://github.com/owl234/obsidian-baidu-netdisk-sync).

## Changes

- Explicit local rename journal with serialized writes, so a folder rename cannot lose child rename events.
- Same-parent file renames use Baidu filemanager opera=rename; cross-parent renames use opera=move.
- A rename is applied in the cloud before changed file contents are uploaded. Links updated by Obsidian still require a full-file upload.
- Folder renames refresh child metadata after the folder rename to avoid false mtime conflicts. Only changed child files upload.
- Failed or ambiguous renames keep their journal entry and stop the run; they never fall back to add-and-delete.
- Startup auto sync is deduplicated for 15 seconds and save-triggered sync is ignored for the first 10 seconds after launch.
- Automatic per-overwrite .baidu-native-history backups remain disabled.

## Installation

Copy main.js, manifest.json and styles.css into .obsidian/plugins/baidu-netdisk-sync/ and enable the plugin. No credentials or state files are included.

## Notes

- Plugin ID remains baidu-netdisk-sync for existing settings compatibility. This ID is already used by the original plugin in the Obsidian community marketplace; a separate marketplace ID is required before submitting this fork.
- Multi-device sync has no distributed lock; run one device at a time.
- E2EE migration is not included.

