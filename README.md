# Baidu Netdisk Sync Plus for Obsidian

Baidu Netdisk Sync Plus synchronizes an Obsidian vault with Baidu Netdisk in
both directions. It is a modified build of
[owl234/obsidian-baidu-netdisk-sync](https://github.com/owl234/obsidian-baidu-netdisk-sync)
under the MIT License, with a separate plugin ID so both plugins can be
installed side by side.

The sync engine was rewritten around per-device content baselines instead of a
shared remote index.

## Features

- Per-device baseline with SHA-256 local content hashes and cloud revision
  metadata.
- Conflict table with four choices: keep local, keep cloud, keep both, or skip.
- Startup auto sync prompts for conflicts; interval and save-triggered sync hold
  conflicts until the next manual run.
- Explicit file and folder rename journal. Same-parent renames use Baidu
  `filemanager opera=rename`; cross-directory renames use `opera=move`.
- Folder renames update cloud paths first, refresh child metadata, and upload
  only files whose content changed.
- Reviewed deletions use the Obsidian vault trash and the Baidu recycle bin.
- Four-stage resumable multipart uploads with post-transfer verification.
- No automatic history copies on ordinary overwrites.

## Network use

The plugin sends requests only to Baidu Open Platform endpoints
(`pan.baidu.com`, `d.pcs.baidu.com`, and hosts returned by Baidu's
`locateupload` response). It does not send telemetry or data to any other
service. AppKey, AppSecret, OAuth tokens and the optional E2EE password are
stored locally in the plugin's `data.json` and are never included in this
repository.

## Install manually

1. Download `main.js`, `manifest.json` and `styles.css` from the latest GitHub
   release.
2. Put them in `<vault>/.obsidian/plugins/baidu-netdisk-sync-plus/`.
3. Reload Obsidian and enable **Baidu Netdisk Sync Plus**.
4. Create a Baidu Open Platform application and enter its AppKey and AppSecret
   in the plugin settings.

Existing settings under `.obsidian/plugins/baidu-netdisk-sync/` are not migrated
automatically. Copy `data.json` only if you intend to reuse the old
authorization and sync settings.

## Build from source

```bash
npm install
npm test
npm run build
```

`npm test` runs the original TypeScript unit tests and the native sync engine
tests. `npm run build` bundles `src/entry.ts` to `main.js`.

The source tree contains the original TypeScript modules under `src/`, the
native Baidu API reconciler in `src/native-sync.js`, and the bundle entry point
in `src/entry.ts`.

## Attribution and license

Based on [owl234/obsidian-baidu-netdisk-sync](https://github.com/owl234/obsidian-baidu-netdisk-sync).
The original author is credited in [NOTICE.md](NOTICE.md). Both the original
project and this modified build use the MIT License; see [LICENSE](LICENSE).

This repository contains no Baidu credentials, tokens, sync manifest, native
state or machine-specific sync data.
