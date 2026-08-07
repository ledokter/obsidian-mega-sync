# MEGA Sync for Obsidian

> Two-way sync between your Obsidian vault and a folder on your **MEGA.nz** account.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

MEGA Sync keeps your Obsidian vault in sync with a folder on your MEGA.nz account. It uses a three-way merge (local state / remote state / last-sync snapshot) so several devices converge toward the same state, and **only supports MEGA.nz** as a backend.

## Features

- **Two-way sync** via a three-way merge (local / remote / last-sync snapshot).
- **Sync direction**: two-way (mirror), upload-only / download-only (strict mirror), or push-only / pull-only (one-way without deletions).
- **Triggers**: on startup, on an interval, after vault changes (debounced), manually (ribbon / command / status bar).
- **Auto bootstrap**: on a device with an empty vault, the first sync downloads everything from MEGA (one-way), then switches back to two-way automatically.
- **Mobile (experimental)**: the plugin also runs on iOS/Android — see [Mobile](#mobile-experimental).
- **MEGA account**: email + password + optional 2FA code.
- Configurable **remote folder** (base folder + sub-folder), auto-created.
- **Filters**: include/exclude glob patterns, regex ignore + regex allowlist, file-type whitelist with presets (Notes, Images, PDF, Audio, Video) + custom extensions, max file size, optional `.obsidian` folder sync, individual `.obsidian/bookmarks.json` sync, dot/underscore hidden-file rules, always-skipped system files (`.git`, `node_modules`, `.DS_Store`, `~$*` Office temp, …).
- **Conflict handling**: for text notes (`.md`/`.markdown`/`.txt`, under 2MB), tries a three-way merge first — if both sides changed different, non-overlapping parts, the merge is applied automatically and no duplicate is created. The plugin keeps a private local cache of each such file's last-synced content (never inside the vault) to use as the real merge ancestor; without a cached ancestor yet, it falls back to a reconstructed one, which is more conservative. Otherwise (or for any other file type), local + remote conflict copies are kept (`<file>.conflict-<date>.<ext>`) — never any data loss. Toggle: "Auto-merge text conflicts".
- **Safe deletion**: trash-aware, reversible remote/local deletion.
- **Dry run**: simulate a sync (command "Simulate sync") to preview the plan without changing anything.
- **Safety guard**: abort automatically if too many files would change in a single run (`protectModifyPercentage`).
- **Per-file timeout**: give up on a single stalled upload/download after N minutes (default 10) instead of hanging the whole sync forever — e.g. a stuck connection or an exhausted MEGA transfer quota.
- **Live progress**: the ribbon icon fills as a gauge while syncing, with a tooltip / status-bar readout showing percent, done/total, and an ETA. **Stop a running sync** anytime — right-click the ribbon icon, or the "Stop sync" button in the log window; whatever was already synced is kept.
- **Shared snapshot**: `_mega_sync_snapshot.json` stored on MEGA so multiple devices converge.
- **Status bar, ribbon icon, log** view (command "Show sync log") with a live-updating progress row and a "Copy log" button while a sync runs.
- **Toggleable sync log** (in-memory ring buffer + optional on-disk file).
- **Test read/write** button: writes a test file to MEGA, reads it back, verifies it, then deletes it.
- **Pre-sync notification** + optional confirmation modal for manual syncs.
- Optional **settings lock** with a passphrase.

## Install

1. Obsidian → **Settings → Community plugins → Turn off safe mode**, then **Browse**.
2. Search **MEGA Sync** and install.
3. **Or with BRAT**: add the repo `ledokter/obsidian-mega-sync`.
4. Enable the plugin, open its settings, enter your MEGA credentials.

## Quick start

1. Settings → MEGA Sync → Email / Password.
2. Base folder: created at the root of your MEGA drive (default `Obsidian-MEGA-Sync`).
3. Click **Test read/write** to validate the connection.
4. Click the ribbon icon or run **Sync now** to start the first sync.

## Security & filesystem access

- The plugin runs on **desktop and mobile** (`isDesktopOnly: false`). It is bundled for the browser: the [`megajs`](https://www.npmjs.com/package/megajs) browser build handles MEGA's client-side encryption in pure JS, `Buffer` is provided by a bundled polyfill, and no Node.js built-in module is used at runtime. Filesystem access is limited to the **Obsidian vault** and the **plugin's own data folder** — the plugin never reads or writes outside these bounds, except to send deleted files to the system trash via Obsidian's `fileManager.trashFile` API (optional, "Use trash for deletion"). No remote code is loaded; the full TypeScript source is published.
- Your MEGA password is stored **locally** in the plugin's `data.json` (inside your vault's `.obsidian/plugins/mega-sync/`). It is only ever sent to the MEGA API.
- **At-rest encryption**: Settings → Security → "Enable encryption". Your MEGA credentials (email, password, 2FA) **and** the cached session are then encrypted with **AES-256-GCM** (key derived via **scrypt**, N=16384/r=8/p=1, from a master passphrase). Encryption uses the **Web Crypto API** and a WASM scrypt implementation, so it works identically on desktop and mobile; secrets encrypted by earlier versions stay readable. The passphrase is **never** written to disk — it lives only in memory for the session. Once set, it also locks the settings panel.
- **Session persistence**: after a first successful login, the plugin caches the MEGA session (`sid` + key, no password). Subsequent syncs reuse that session and no longer send your password to MEGA. If the session expires, the plugin automatically falls back to email+password login.
- The plugin loads **no remote code** and is **not obfuscated**, per Obsidian's plugin requirements.
- Do not commit `data.json` to a public repository.

## Limitations

- MEGA does not expose a reliable per-file modification time; the plugin relies on the sync snapshot to track `mtime`. A file created directly on MEGA (outside the plugin) is seen as "new remote" and downloaded.
- Mobile support is **experimental** — see below.

## Mobile (experimental)

The plugin installs and runs on Obsidian for iOS and Android. Login, folder listing and the settings UI work the same as on desktop.

**Caveat**: MEGA's file-transfer servers negotiate TLS with cipher suites that some mobile webviews refuse. If that happens on your device, uploads and downloads fail while login and listing still work. This cannot be worked around from the plugin — please open an issue with your OS/version if you hit it.

**Recommended first run on a new phone/tablet:**

1. Create an empty vault, install the plugin, enter your MEGA credentials.
2. Leave **Auto bootstrap empty vault** on (default).
3. Run a sync: the vault is empty and MEGA has files, so this first run downloads everything one-way. When it finishes, the plugin switches to two-way sync by itself and never bootstraps again for that vault.

Turn the toggle off if you prefer to control the first sync direction manually.

## Contributions

PRs welcome. Please open an issue before a major change.

## License

MIT © ledokter