# 1.0.2

Marketplace identity release for [351jklbhjk/obsidian-baidu-sync](https://github.com/351jklbhjk/obsidian-baidu-sync), based on [owl234/obsidian-baidu-netdisk-sync](https://github.com/owl234/obsidian-baidu-netdisk-sync).

## Changes

- New unique plugin ID baidu-netdisk-sync-plus and name Baidu Netdisk Sync Plus.
- File renames use Baidu filemanager opera=rename in the same directory; cross-directory renames use opera=move.
- Folder renames refresh child metadata and upload only changed child files.
- Obsidian link updates use a full-file upload because Baidu has no character-level patch API.
- Failed or ambiguous renames keep their journal entry and stop the run instead of falling back to add-and-delete.
- Startup auto sync is deduplicated and startup config writes no longer trigger a second save sync.
- Ordinary overwrites do not create .baidu-native-history backups.

## Installation

Copy main.js, manifest.json and styles.css into .obsidian/plugins/baidu-netdisk-sync-plus/ and enable the plugin. Existing settings in the old baidu-netdisk-sync folder are not moved automatically.

## Notes

- No credentials, tokens or state files are included.
- Multi-device sync has no distributed lock.
- E2EE migration is not included.

