// Tire un personnage au hasard dans le corpus déjà constitué et écrit data/personnage.json (lu par TRMNL).
// Aucun appel réseau : tout est déjà dans le dépôt (data/fiches et images).

const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');
const INDEX = path.join(DATA, 'index.json');
const BASE = path.join(DATA, 'base.json');
const HISTO = path.join(DATA, 'historique.json');
const SORTIE = path.join(DATA, 'personnage.json');
const MEMOIRE_HISTO = 1000; // nombre de tirages récents à ne pas répéter
const DEPOT = process.env.GITHUB_REPOSITORY || 'nbbou81000/trmnl-manga-scouter';

const lire = (f, defaut) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return defaut; } };
const milliers = (n) => String(n || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

const ids = lire(INDEX, []);
if (!ids.length) {
  console.error('Corpus vide : lance d\'abord "Construire la base" puis "Constituer le corpus".');
  process.exit(1);
}
const base = lire(BASE, { mangas: [] });
const histo = lire(HISTO, []);
const recents = new Set(histo);
let candidats = ids.filter((id) => !recents.has(id));
if (!candidats.length) candidats = ids;

const id = candidats[Math.floor(Math.random() * candidats.length)];
const fiche = lire(path.join(DATA, 'fiches', `${id}.json`), null);
if (!fiche) { console.error(`Fiche ${id} illisible.`); process.exit(1); }

fiche.fans = milliers(fiche.fans);
fiche.image = `https://raw.githubusercontent.com/${DEPOT}/main/images/${id}.png`;
fiche.total_personnages = milliers(ids.length);
fiche.total_mangas = base.mangas.length;
fiche.maj = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' });

fs.writeFileSync(SORTIE, JSON.stringify(fiche, null, 2));
fs.writeFileSync(HISTO, JSON.stringify([id, ...histo].slice(0, MEMOIRE_HISTO)));
console.log(`Tiré : ${fiche.nom} (${fiche.manga})`);
