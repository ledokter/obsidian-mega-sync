# Submission to the Obsidian community plugin directory

Obsidian **no longer** accepts submissions via pull requests to
`obsidianmd/obsidian-releases` (PRs and issues are disabled on that repo).
The official channel is now the **Obsidian Community directory** at
<https://community.obsidian.md>.

Reference: <https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin>

## Status

| Step | Status |
|---|---|
| Source code on GitHub | ✅ https://github.com/ledokter/obsidian-mega-sync |
| `manifest.json` complete & compliant | ✅ (id `mega-sync`, no `obsidian` in id, no `fundingUrl`) |
| `main.js` / `styles.css` built | ✅ |
| GitHub release with the 3 assets | ✅ https://github.com/ledokter/obsidian-mega-sync/releases/tag/2.0.0 |
| `manifest.json` at HEAD of default branch matches latest release | ✅ (`2.0.0` on `master`) |
| `versions.json` present | ✅ |
| README + LICENSE | ✅ |
| At-rest encryption (AES-256-GCM + scrypt, Web Crypto) | ✅ |
| Mobile support (browser bundle, experimental) | ✅ |
| MEGA session caching (no password re-sent) | ✅ |
| Submitted via community.obsidian.md | ⏳ **manual step below** |
| Accepted & published | ⏳ pending review |

## How to submit (3 minutes)

1. Go to **<https://community.obsidian.md>** and sign in with your **Obsidian account**.
2. **Link your GitHub account** to your profile (Profile → Settings → GitHub).
   The directory uses this to verify you own the repository.
3. In the sidebar, choose **Plugins → New plugin**.
4. Enter the repository URL:
   ```
   https://github.com/ledokter/obsidian-mega-sync
   ```
5. Review and agree to the **Developer policies**, and confirm you'll keep
   supporting the plugin.
6. Click **Submit**.

The directory reads the `manifest.json` at the HEAD of `master` (currently
`2.0.0`) and then pulls `main.js`, `manifest.json`, `styles.css` from the
GitHub release whose tag matches the manifest version — that release
(`2.0.0`) is produced automatically by the `release` GitHub Actions workflow,
which also attests build provenance for the assets.

## After submission

- The directory runs an **automated review** and shows guidance for anything
  to correct. To address feedback: fix the repo, bump the version in
  `manifest.json` + `versions.json`, run `node esbuild.config.mjs production`,
  commit, push, and create a new GitHub release whose tag matches the new
  version. Then back on community.obsidian.md, edit the description and select
  **Publish**.
- The plugin won't be installable from inside Obsidian until the automated
  review passes.
- Once published, announce it:
  - Forum: <https://forum.obsidian.md/c/share-showcase/9>
  - Discord `#updates` (needs the `developer` role).

## Compliance checklist (verified)

Per <https://docs.obsidian.md/Plugins/Releasing/Submission+requirements+for+plugins>:

- [x] `manifest.json` fields: `id`, `name`, `version` (x.y.z), `minAppVersion`,
      `description`, `author`, `authorUrl`, `isDesktopOnly`.
- [x] `id` = `mega-sync` — unique, lowercase, does not contain `obsidian`.
- [x] No `fundingUrl` (no donation channel is configured).
- [x] `description` ≤ 250 chars, ends with `.`, no emoji, proper capitalization
      (Obsidian, MEGA.nz).
- [x] `minAppVersion` = `1.13.0` (uses the declarative settings API:
      `getSettingDefinitions` / `SettingDefinitionItem`, available since 1.13.0).
- [x] `isDesktopOnly: false` — the plugin is bundled for the browser and uses no
      Node.js built-in module at runtime: MEGA's client-side encryption comes
      from the `megajs` browser build, at-rest encryption uses the Web Crypto
      API + WASM scrypt, and `Buffer` is provided by a bundled polyfill.
- [x] Command ids do **not** include the plugin id (`sync-now`, `show-log`,
      `test-connection`, `lock`) — Obsidian prefixes them automatically.
- [x] No sample/template code; original implementation.
- [x] No remote code loading; not obfuscated; full TypeScript source in the repo.
- [x] **Filesystem access is justified**: file access goes through Obsidian's
      vault API and is limited to the vault and the plugin's own data folder;
      the only out-of-vault operation is sending deleted files to the system
      trash via Obsidian's `fileManager.trashFile` API (optional). See the
      "Security & filesystem access" section in README.md.
- [x] GitHub release `2.0.0` attaches `main.js`, `manifest.json`, `styles.css`,
      with build-provenance attestations.
- [x] Release tag (`2.0.0`) matches `manifest.json` version (`2.0.0`).

## Features (2.0.0)

- Mobile support (experimental): browser bundle, no Node.js built-ins.
- Auto bootstrap: on a device with an empty vault, the first sync downloads
  everything from MEGA one-way, then switches back to two-way automatically.

- Sync direction: two-way mirror (default), upload-only / download-only (strict
  mirror), or push-only / pull-only (one-way without deletions).
- Pre-sync notification + optional confirmation modal for manual syncs.
- Round-trip "Test read/write" button (write → read → verify → delete).
- File-type filter: all types, or a whitelist with presets (Notes, Images,
  PDF, Audio, Video) + custom extensions. Excluded files are left untouched.
- Path filtering: glob exclude/include, regex ignore + regex allowlist, always-
  skipped system files (.git, node_modules, .DS_Store, ~$* Office temp, …),
  dot/underscore hidden-file rules, individual `.obsidian/bookmarks.json` sync.
- Dry-run command (simulate sync, no changes) + safety guard
  `protectModifyPercentage` (abort if too many files change in one run).
- Toggleable sync log (in-memory ring buffer + optional on-disk file).
- Ribbon icon animates while syncing.

## Manual test before review

```
mkdir -p "<vault>/.obsidian/plugins/mega-sync"
cp main.js manifest.json styles.css "<vault>/.obsidian/plugins/mega-sync/"
```

Then in Obsidian: Settings → Community plugins → enable "MEGA Sync".