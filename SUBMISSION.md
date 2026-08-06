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
| GitHub release with the 3 assets | ✅ https://github.com/ledokter/obsidian-mega-sync/releases/tag/v1.1.1 |
| `manifest.json` at HEAD of default branch matches latest release | ✅ (`1.1.1` on `master`) |
| `versions.json` present | ✅ |
| README + LICENSE | ✅ |
| At-rest encryption (AES-256-GCM + scrypt) | ✅ |
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
`1.1.1`) and then pulls `main.js`, `manifest.json`, `styles.css` from the
GitHub release whose tag matches the manifest version — that release
(`v1.1.1`) already exists with all three assets.

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
      (Obsidian, MEGA.nz, Remotely Save).
- [x] `minAppVersion` = `1.5.0` (a real Obsidian API version).
- [x] `isDesktopOnly: true` — the plugin uses Node.js APIs (`crypto`, `Buffer`)
      via the bundled `megajs` library, which are desktop-only.
- [x] Command ids do **not** include the plugin id (`sync-now`, `show-log`,
      `test-connection`, `lock`) — Obsidian prefixes them automatically.
- [x] No sample/template code; original implementation.
- [x] No remote code loading; not obfuscated; full TypeScript source in the repo.
- [x] GitHub release `v1.1.1` attaches `main.js`, `manifest.json`, `styles.css`.
- [x] Release tag (`v1.1.1`) matches `manifest.json` version (`1.1.1`).

## Manual test before review

```
mkdir -p "<vault>/.obsidian/plugins/mega-sync"
cp main.js manifest.json styles.css "<vault>/.obsidian/plugins/mega-sync/"
```

Then in Obsidian: Settings → Community plugins → enable "MEGA Sync".