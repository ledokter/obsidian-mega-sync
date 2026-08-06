# MEGA Sync for Obsidian

> Synchronisation bidirectionnelle entre votre vault Obsidian et un dossier sur votre compte **MEGA.nz**, inspirée de **Remotely Save** mais dédiée exclusivement à MEGA.
>
> Two-way sync between your Obsidian vault and a folder on your **MEGA.nz** account, inspired by **Remotely Save** but restricted to MEGA only.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## 🇫🇷 Français

### Qu'est-ce que c'est ?

MEGA Sync synchronise le contenu de votre vault Obsidian avec un dossier de votre compte MEGA.nz. Le plugin reproduit le fonctionnement de [Remotely Save](https://github.com/remotely-save/remotely-save) (synchronisation bidirectionnelle basée sur un instantané de la dernière synchro) mais **n'utilise que MEGA.nz** comme backend.

### Fonctionnalités

- **Sync bidirectionnelle** par merge à trois voies (local / distant / instantané de la dernière synchro), comme Remotely Save.
- **Déclencheurs** : au démarrage d'Obsidian, à intervalle régulier, après modification du vault (debounce), manuellement (icône du ruban, commande, barre d'état).
- **Compte MEGA** : email + mot de passe + code 2FA optionnel.
- **Dossier distant** configurable (dossier de base + sous-dossier), créé automatiquement.
- **Filtres** : patterns d'exclusion/inclusion (glob `*` / `**`), taille maximale de fichier, inclusion optionnelle du dossier `.obsidian` (config du vault).
- **Gestion des conflits** : copie de conflit locale et distante (`<fichier>.conflict-<date>.<ext>`), jamais de perte de données.
- **Suppression sûre** : corbeille (trash) configurable, suppression distante/local réversible.
- **Instantané partagé** : `_mega_sync_snapshot.json` est stocké sur MEGA afin que plusieurs appareils convergent vers le même état.
- **Barre d'état + icône du ruban + journal** consultable (commande « Show sync log »).
- **Verrouillage des réglages** par mot de passe optionnel.

### Installation

1. Dans Obsidian : **Réglages → Modules complémentaires → Désactiver le mode sans échec**, puis **Parcourir**.
2. Cherchez **MEGA Sync** (une fois publié dans le catalogue communautaire) et installez-le.
3. **Ou via BRAT** (test bêta) : ajoutez le dépôt `ledokter/obsidian-mega-sync`.
4. Activez le plugin, puis ouvrez ses réglages et renseignez votre compte MEGA.

### Utilisation rapide

1. **Réglages → MEGA Sync → Email / Password** : vos identifiants MEGA.
2. **Base folder** : dossier créé à la racine de votre MEGA (défaut `Obsidian-MEGA-Sync`).
3. Cliquez **Test connection** pour valider.
4. Cliquez l'icône du ruban ou **Sync now** pour lancer la première synchro.

### Sécurité & confidentialité

- Votre mot de passe MEGA est stocké **localement** dans `data.json` du plugin (dans le dossier `.obsidian/plugins/mega-sync/` de votre vault). Il n'est jamais envoyé ailleurs qu'à l'API MEGA.
- Vous pouvez verrouiller les réglages par un mot de passe distinct.
- Le plugin ne charge **aucun code distant** et n'est pas obfusqué (conforme aux [exigences Obsidian](https://docs.obsidian.md/Plugins/Releasing+your+plugin)).
- **Important** : ne placez pas `data.json` dans un dépôt public.

### Limitations

- MEGA ne fournit pas de date de modification fiable par fichier ; le plugin s'appuie sur l'instantané de synchro pour suivre les `mtime`. Un fichier créé directement sur MEGA (hors plugin) sera vu comme « nouveau distant » et téléchargé.
- Pas de synchronisation sélective avancée type « règles complexes » au-delà des globs.

### Contributions

PR bienvenues. Voir [CONTRIBUTING](#). Veuillez ouvrir une *issue* avant un changement majeur.

## 🇬🇧 English

MEGA Sync keeps your Obsidian vault in sync with a folder on your MEGA.nz account. It reproduces the behaviour of [Remotely Save](https://github.com/remotely-save/remotely-save) (three-way snapshot-based two-way sync) but **only supports MEGA.nz**.

### Features

- **Two-way sync** via a three-way merge (local / remote / last-sync snapshot).
- **Triggers**: on startup, on an interval, after vault changes (debounced), manually (ribbon / command / status bar).
- **MEGA account**: email + password + optional 2FA code.
- Configurable **remote folder** (base folder + sub-folder), auto-created.
- **Filters**: include/exclude glob patterns, max file size, optional `.obsidian` folder sync.
- **Conflict handling**: local + remote conflict copies (`<file>.conflict-<date>.<ext>`), never any data loss.
- **Safe deletion**: trash-aware, reversible remote/local deletion.
- **Shared snapshot**: `_mega_sync_snapshot.json` stored on MEGA so multiple devices converge.
- **Status bar, ribbon icon, log** view (command "Show sync log").
- Optional **settings lock** with a passphrase.

### Install

1. Obsidian → **Settings → Community plugins → Turn off safe mode**, then **Browse**.
2. Search **MEGA Sync** and install (once accepted in the community catalog).
3. **Or with BRAT**: add the repo `ledokter/obsidian-mega-sync`.
4. Enable the plugin, open its settings, enter your MEGA credentials.

### Quick start

1. Settings → MEGA Sync → Email / Password.
2. Base folder: created at the root of your MEGA drive (default `Obsidian-MEGA-Sync`).
3. Click **Test connection**.
4. Click the ribbon icon or run **Sync now**.

### Security

- Your MEGA password is stored **locally** in the plugin's `data.json` (inside your vault's `.obsidian/plugins/mega-sync/`). It is only ever sent to the MEGA API.
- You can lock the settings panel with a separate passphrase.
- The plugin loads **no remote code** and is **not obfuscated**, per Obsidian's plugin requirements.
- Do not commit `data.json` to a public repository.

### Comparison with Remotely Save

| Feature | Remotely Save | MEGA Sync |
|---|---|---|
| Backends | Dropbox, OneDrive, WebDAV, S3… | **MEGA.nz only** |
| Two-way sync | ✅ | ✅ |
| Snapshot-based merge | ✅ | ✅ |
| Sync on startup / interval / change | ✅ | ✅ |
| Include/exclude globs | ✅ | ✅ |
| `.obsidian` sync toggle | ✅ | ✅ |
| Conflict copies | ✅ | ✅ |
| Settings password lock | ✅ | ✅ |
| Status bar / ribbon / log | ✅ | ✅ |
| Mobile (iOS/Android) | partial | desktop only (Electron) for now |

### License

MIT © ledokter