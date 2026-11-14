# 1.0.0

Initial public fork of [owl234/obsidian-baidu-netdisk-sync](https://github.com/owl234/obsidian-baidu-netdisk-sync).

## Features

- Native Baidu API two-way sync without the shared remote index.
- Per-device baseline with SHA-256 local content verification.
- listall snapshot with exact-directory list fallback.
- Conflict choice table: keep local, keep cloud, keep both, or skip.
- Startup auto sync prompts for conflicts; interval/save background sync holds them.
- Reviewed deletions with local and cloud recycle bins.
- Resumable four-stage multipart upload and post-transfer verification.
- No automatic .baidu-native-history copy on ordinary overwrites.
- Path safety checks and abort-on-change guards.

## Notes

- Plugin ID remains baidu-netdisk-sync.
- No credentials, tokens, state files or sync manifests are included.
- Multi-device sync is sequential; there is no distributed lock.
- E2EE mode migration is not included in this version.

