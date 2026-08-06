# Submission to the Obsidian community plugin store

This document tracks the state of the submission of **MEGA Sync** to the
official Obsidian community plugin directory.

## Status

| Step | Status |
|---|---|
| Source code on GitHub | ✅ https://github.com/ledokter/obsidian-mega-sync |
| `manifest.json` complete | ✅ |
| `main.js` / `styles.css` built | ✅ |
| GitHub release with the 3 assets | ✅ https://github.com/ledokter/obsidian-mega-sync/releases/tag/v1.1.0 |
| At-rest encryption (AES-256-GCM + scrypt) | ✅ |
| MEGA session caching (no password re-sent) | ✅ |
| Fork of `obsidianmd/obsidian-releases` | ✅ https://github.com/ledokter/obsidian-releases |
| Branch `add-mega-sync-plugin` (1 commit) | ✅ ahead of `master` by 1 |
| Pull request opened | ⏳ **manual step below** |
| Accepted by Obsidian | ⏳ pending review |

## Why the PR is not opened automatically

The GitHub account used (`ledokter`) can fork, push, and create releases, but
the OAuth token could not open a pull request against `obsidianmd/obsidian-releases`
(error: `does not have the correct permissions to execute CreatePullRequest`,
which is the usual signature of an **SSO/organisation permission** gate on the
Obsidian org). This must be done from a browser where the account has an
interactive session.

## Open the PR (one click)

Click the link below — it opens GitHub's compare page with the branch already
selected. Click **"Create pull request"**.

```
https://github.com/obsidianmd/obsidian-releases/compare/master...ledokter:obsidian-releases:add-mega-sync-plugin
```

Suggested PR title:

```
Add MEGA Sync plugin
```

Suggested PR body:

```
## New community plugin submission

- **Plugin ID:** `mega-sync`
- **Name:** MEGA Sync
- **Author:** ledokter
- **Repo:** https://github.com/ledokter/obsidian-mega-sync
- **Release:** https://github.com/ledokter/obsidian-mega-sync/releases/tag/v1.1.0

## Description
Two-way synchronisation between an Obsidian vault and a folder on the user's
MEGA.nz account. Inspired by Remotely Save, restricted to MEGA.nz only.
Three-way snapshot merge (local / remote / last-sync) with conflict copies,
include/exclude glob filters, sync on startup/interval/after-changes, status
bar + ribbon icon, optional settings-password lock. Uses the bundled `megajs`
library.

## Checklist
- [x] `manifest.json` has id, name, version, minAppVersion, description, author,
      authorUrl, isDesktopOnly
- [x] GitHub release v1.0.0 attaches main.js, manifest.json, styles.css
- [x] No remote code loaded; not obfuscated
- [x] Repo is public with source
- [x] minAppVersion = 1.5.0

## Notes
- Desktop-only (Electron / Node APIs used by megajs: Buffer, node crypto).
- MEGA password stored locally in plugin data.json, only sent to MEGA API.
```

## Obsidian requirements verification

Per https://docs.obsidian.md/Plugins/Releasing+your+plugin:

1. **Repo is public** ✅ — `ledokter/obsidian-mega-sync`.
2. **`manifest.json` fields** ✅ — id, name, version, minAppVersion, description,
   author, authorUrl, isDesktopOnly (no funding required).
3. **Release assets** ✅ — `main.js`, `manifest.json`, `styles.css` attached to
   release `v1.0.0`.
4. **`minAppVersion`** ✅ — `1.5.0` (a real Obsidian API version).
5. **No remote code** ✅ — everything is bundled into `main.js`; the plugin makes
   network calls only to the MEGA API.
6. **Not obfuscated** ✅ — full TypeScript source in the repo.
7. **Entry added to `community-plugins.json`** ✅ — on branch
   `add-mega-sync-plugin` of the fork.

## Manual test before review

To install the plugin locally for testing:

```
mkdir -p "<vault>/.obsidian/plugins/mega-sync"
cp main.js manifest.json styles.css "<vault>/.obsidian/plugins/mega-sync/"
```

Then in Obsidian: Settings → Community plugins → enable "MEGA Sync".