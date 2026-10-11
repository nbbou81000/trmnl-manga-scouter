# Scouter manga — plugin TRMNL perso

Une fiche de personnage tirée au hasard parmi les mangas les plus populaires de MyAnimeList, avec son image officielle préparée pour l'e-ink, renouvelée toutes les heures. Tout le corpus est stocké dans le dépôt.

## Les trois Actions

| Action | Quand | Ce qu'elle fait |
|---|---|---|
| **Construire la base** | lundi, ou à la main | Liste les 100 mangas les plus populaires et jusqu'à 40 personnages par manga → `data/base.json` |
| **Constituer le corpus** | lundi après la base, ou à la main | Pour chaque personnage : fiche détaillée, traduction française (si clé Mistral), image noir et blanc → `data/fiches/<id>.json` et `images/<id>.png`. Reprend où elle s'était arrêtée et enregistre tous les 250 personnages. |
| **Personnage au hasard** | toutes les heures | Tire une fiche du corpus (sans répéter les 1 000 dernières) → `data/personnage.json`. Aucun appel réseau. |

## Installation (sans terminal)

1. Sur github.com, crée un dépôt **public** nommé `trmnl-manga-scouter`.
2. Dépose-y tout le contenu de ce dossier avec **GitHub Desktop** (le dossier `.github` doit bien être inclus).
3. *(Facultatif, pour les fiches en français)* **Settings → Secrets and variables → Actions → New repository secret** : nom `MISTRAL_API_KEY`, valeur = ta clé Mistral. À faire **avant** de constituer le corpus, sinon les fiches resteront en anglais.
4. **Actions → Construire la base → Run workflow** (3 à 5 minutes).
5. **Actions → Constituer le corpus → Run workflow**. C'est la grosse étape : environ 2 à 3 heures pour 3 500 personnages. Si elle s'arrête avant la fin (message « Budget atteint » dans les logs), relance-la : elle reprend où elle en était.
6. **Actions → Personnage au hasard → Run workflow**.
7. Sur trmnl.com → **Plugins → Private Plugin** :
   - Strategy : **Polling**
   - Polling URL : `https://raw.githubusercontent.com/nbbou81000/trmnl-manga-scouter/main/data/personnage.json`
   - Refresh rate : toutes les heures
   - Colle `markup/full.liquid`, `half_horizontal.liquid`, `half_vertical.liquid` et `quadrant.liquid` dans les onglets correspondants de **Edit Markup**.

## Taille du dépôt

Chaque image pèse environ 80 Ko : compte 250 à 350 Mo pour le corpus complet, sous la limite recommandée de GitHub (1 Go).

## Réglages

- Plus de mangas ou de personnages : lance **Construire la base** à la main en changeant les deux champs, puis **Constituer le corpus** (seuls les nouveaux personnages sont traités).
- Rythme des tirages : ligne `cron` de `.github/workflows/personnage-au-hasard.yml`.

Usage personnel uniquement : les images et biographies proviennent de MyAnimeList et appartiennent à leurs ayants droit.
