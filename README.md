# MEGA Sync for Obsidian

> Two-way sync between your Obsidian vault and a folder on your **MEGA.nz** account.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

MEGA Sync keeps your Obsidian vault in sync with a folder on your MEGA.nz account. It uses a three-way merge (local state / remote state / last-sync snapshot) so several devices converge toward the same state, and **only supports MEGA.nz** as a backend.

## Features

- **Two-way sync** via a three-way merge (local / remote / last-sync snapshot).
- **Sync direction**: two-way (mirror), upload-only / download-only (strict mirror), or push-only / pull-only (one-way without deletions).
- **Triggers**: on startup, on an interval, after vault changes (debounced), manually (ribbon / command / status bar).
- **MEGA account**: email + password + optional 2FA code.
- Configurable **remote folder** (base folder + sub-folder), auto-created.
- **Filters**: include/exclude glob patterns, regex ignore + regex allowlist, file-type whitelist with presets (Notes, Images, PDF, Audio, Video) + custom extensions, max file size, optional `.obsidian` folder sync, individual `.obsidian/bookmarks.json` sync, dot/underscore hidden-file rules, always-skipped system files (`.git`, `node_modules`, `.DS_Store`, `~$*` Office temp, …).
- **Conflict handling**: local + remote conflict copies (`<file>.conflict-<date>.<ext>`), never any data loss.
- **Safe deletion**: trash-aware, reversible remote/local deletion.
- **Dry run**: simulate a sync (command "Simulate sync") to preview the plan without changing anything.
- **Safety guard**: abort automatically if too many files would change in a single run (`protectModifyPercentage`).
- **Shared snapshot**: `_mega_sync_snapshot.json` stored on MEGA so multiple devices converge.
- **Status bar, ribbon icon, log** view (command "Show sync log"). The ribbon icon animates while syncing.
- **Toggleable sync log** (in-memory ring buffer + optional on-disk file).
- **Test read/write** button: writes a test file to MEGA, reads it back, verifies it, then deletes it.
- **Pre-sync notification** + optional confirmation modal for manual syncs.
- Optional **settings lock** with a passphrase.

## Install

1. Obsidian → **Settings → Community plugins → Turn off safe mode**, then **Browse**.
2. Search **MEGA Sync** and install (once accepted in the community catalog).
3. **Or with BRAT**: add the repo `ledokter/obsidian-mega-sync`.
4. Enable the plugin, open its settings, enter your MEGA credentials.

## Quick start

1. Settings → MEGA Sync → Email / Password.
2. Base folder: created at the root of your MEGA drive (default `Obsidian-MEGA-Sync`).
3. Click **Test read/write** to validate the connection.
4. Click the ribbon icon or run **Sync now** to start the first sync.

## Security & filesystem access

- The plugin is **desktop only** (`isDesktopOnly: true`). The [`megajs`](https://www.npmjs.com/package/megajs) library used to talk to MEGA relies on Node.js `crypto` and `Buffer` (MEGA's protocol requires client-side encryption, handled in pure-JS by megajs). Filesystem access is limited to the **Obsidian vault** and the **plugin's own data folder** — the plugin never reads or writes outside these bounds, except to send deleted files to the system trash via Obsidian's `fileManager.trashFile` API (optional, "Use trash for deletion"). No remote code is loaded; the full TypeScript source is published.
- Your MEGA password is stored **locally** in the plugin's `data.json` (inside your vault's `.obsidian/plugins/mega-sync/`). It is only ever sent to the MEGA API.
- **At-rest encryption**: Settings → Security → "Enable encryption". Your MEGA credentials (email, password, 2FA) **and** the cached session are then encrypted with **AES-256-GCM** (key derived via **scrypt** from a master passphrase). The passphrase is **never** written to disk — it lives only in memory for the session. Once set, it also locks the settings panel.
- **Session persistence**: after a first successful login, the plugin caches the MEGA session (`sid` + key, no password). Subsequent syncs reuse that session and no longer send your password to MEGA. If the session expires, the plugin automatically falls back to email+password login.
- The plugin loads **no remote code** and is **not obfuscated**, per Obsidian's plugin requirements.
- Do not commit `data.json` to a public repository.

## Limitations

- MEGA does not expose a reliable per-file modification time; the plugin relies on the sync snapshot to track `mtime`. A file created directly on MEGA (outside the plugin) is seen as "new remote" and downloaded.
- Mobile (iOS/Android) is not supported yet — the plugin is desktop only for now.

## Contributions

PRs welcome. Please open an issue before a major change.

## License

MIT © ledokter