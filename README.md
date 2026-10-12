# Scouter — plugin TRMNL perso

Une fiche de personnage tirée au hasard, façon « scouter », avec son image préparée pour l'e-ink. Deux univers au choix via une option du plugin : **manga** (AniList) ou **jeux vidéo** (IGDB), ou un mélange des deux.

Aucun cron : tout le corpus est stocké dans le dépôt, et TRMNL tire lui-même un numéro au hasard dans l'URL de polling (`random_number`).

## Les Actions (toutes lancées à la main)

| Action | Ce qu'elle fait |
|---|---|
| **Construire la base** | Manga : les N mangas les plus populaires d'AniList, jusqu'à X personnages chacun, plus des séries complètes au choix (ex. `Dragon Ball`) → `data/base.json` |
| **Constituer le corpus** | Manga : résumé français (Mistral) + image noir et blanc pour chaque nouveau personnage → `data/fiches/`, `images/`, puis publie le tirage `data/tirage/0.json … N.json` |
| **JV — Construire la base** | Jeux vidéo : les N personnages les plus populaires d'IGDB (défaut 5 000) avec leurs jeux → `data/jv/base.json` |
| **JV — Constituer le corpus** | Jeux vidéo : résumé et rôle en français + image → `data/jv/fiches/`, `images/jv/`, puis le tirage `data/jv/tirage/` |

Les deux « Constituer le corpus » ont un champ **Nombre de fiches** : `10` pour un test, `0` pour tout traiter. Ils reprennent où ils se sont arrêtés et enregistrent tous les 150 personnages. À la fin, les logs indiquent le nombre maximum à reporter dans l'URL de polling.

## Secrets nécessaires

| Secret | Usage |
|---|---|
| `MISTRAL_API_KEY` | Résumés en français (sans lui, fiches en anglais) |
| `IGDB_CLIENT_ID`, `IGDB_CLIENT_SECRET` | Accès IGDB (application gratuite sur dev.twitch.tv) |

## Configuration TRMNL

- **Strategy** : Polling
- **Form Fields** : contenu de `markup/form-fields.yml` (menu « Univers » : Manga, Jeux vidéo, Les deux)
- **Polling URL** : les deux lignes de `markup/polling-url.txt` (ligne 1 = manga → `IDX_0`, ligne 2 = jeux vidéo → `IDX_1`). Mettre à jour les deux maximums (`random_number: 0, …`) après chaque nouveau corpus
- **Markup Full** : `markup/full.liquid` (affiche une fiche manga ou jeu vidéo selon le type)

## Fiche jeu vidéo

Franchise, rôle, première apparition (jeu et année), développeur, plateformes d'origine, genres, nombre de jeux, espèce, sexe, origine, rang de popularité, résumé, et les trois jeux phares.

## Taille du dépôt

Environ 80 Ko par image : ~250 Mo pour 3 000 personnages manga, ~400 Mo pour 5 000 personnages de jeux vidéo. GitHub recommande de rester sous 1 Go.

Usage personnel uniquement : les images et descriptions proviennent d'AniList et d'IGDB et appartiennent à leurs ayants droit.
