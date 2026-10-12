// Construit la base des personnages de jeux vidéo : liste et infos de jeux depuis IGDB (base de données de Twitch),
// images depuis les wikis Fandom de chaque franchise (IGDB n'a de portrait que pour quelques centaines de personnages).
// Lancé à la main par l'Action "JV — Construire la base".
// Nécessite les secrets IGDB_CLIENT_ID et IGDB_CLIENT_SECRET (application gratuite sur dev.twitch.tv).
// Réglage : NB_PERSONNAGES (défaut 5000) = nombre de personnages les plus populaires à garder.

const fs = require('fs');
const path = require('path');

const CLIENT_ID = process.env.IGDB_CLIENT_ID;
const CLIENT_SECRET = process.env.IGDB_CLIENT_SECRET;
const NB_PERSONNAGES = parseInt(process.env.NB_PERSONNAGES || '5000', 10);
const MAX_PAR_FRANCHISE = parseInt(process.env.MAX_PAR_FRANCHISE || '150', 10);
const SORTIE = path.join(__dirname, '..', 'data', 'jv', 'base.json');
const PAR_PAGE = 500;

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const CHAMPS_JEUX = [
  'games.name', 'games.first_release_date', 'games.total_rating_count',
  'games.platforms.abbreviation', 'games.genres.name', 'games.franchises.name',
  'games.involved_companies.developer', 'games.involved_companies.company.name',
];
// IGDB a fait évoluer ses champs genre/espèce : on essaie la version récente, puis l'ancienne.
const VARIANTES_CHAMPS = [
  ['name', 'description', 'akas', 'country_name', 'gender', 'species', 'character_gender.name', 'character_species.name', 'mug_shot.image_id', ...CHAMPS_JEUX],
  ['name', 'description', 'akas', 'country_name', 'gender', 'species', 'mug_shot.image_id', ...CHAMPS_JEUX],
  ['name', 'description', 'mug_shot.image_id', ...CHAMPS_JEUX],
];

async function jeton() {
  const url = `https://id.twitch.tv/oauth2/token?client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&grant_type=client_credentials`;
  const rep = await fetch(url, { method: 'POST' });
  if (!rep.ok) throw new Error(`Connexion Twitch refusée (${rep.status}) : vérifie IGDB_CLIENT_ID et IGDB_CLIENT_SECRET.`);
  return (await rep.json()).access_token;
}

async function igdb(token, corps, endpoint = 'characters') {
  for (let essai = 1; essai <= 5; essai++) {
    await pause(300); // IGDB autorise 4 requêtes par seconde
    try {
      const rep = await fetch(`https://api.igdb.com/v4/${endpoint}`, {
        method: 'POST',
        headers: { 'Client-ID': CLIENT_ID, Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' },
        body: corps,
      });
      if (rep.ok) return { ok: true, data: await rep.json() };
      if (rep.status === 400) return { ok: false, erreur: await rep.text() };
      console.warn(`  IGDB ${rep.status} (essai ${essai})`);
    } catch (e) {
      console.warn(`  Erreur réseau (essai ${essai}) : ${e.message}`);
    }
    await pause(2000 * essai);
  }
  throw new Error('IGDB injoignable.');
}

const GENRES_FR = {
  'Point-and-click': 'Point & click', Fighting: 'Combat', Shooter: 'Tir', Music: 'Musique', Platform: 'Plateforme',
  Puzzle: 'Réflexion', Racing: 'Course', 'Real Time Strategy (RTS)': 'Stratégie temps réel', 'Role-playing (RPG)': 'RPG',
  Simulator: 'Simulation', Sport: 'Sport', Strategy: 'Stratégie', 'Turn-based strategy (TBS)': 'Stratégie tour par tour',
  Tactical: 'Tactique', "Hack and slash/Beat 'em up": "Beat 'em all", 'Quiz/Trivia': 'Quiz', Pinball: 'Flipper',
  Adventure: 'Aventure', Indie: 'Indépendant', Arcade: 'Arcade', 'Visual Novel': 'Visual novel',
  'Card & Board Game': 'Cartes et plateau', MOBA: 'MOBA',
};
const SEXE = { 0: 'Masculin', 1: 'Féminin', 2: 'Autre', Male: 'Masculin', Female: 'Féminin', Other: 'Autre' };
const ESPECE = {
  1: 'Humain', 2: 'Extraterrestre', 3: 'Animal', 4: 'Androïde', 5: 'Inconnue',
  Human: 'Humain', Alien: 'Extraterrestre', Animal: 'Animal', Android: 'Androïde', Unknown: 'Inconnue',
};

const annee = (ts) => (ts ? new Date(ts * 1000).getUTCFullYear() : null);
const plusFrequent = (liste, n) => {
  const compte = {};
  for (const x of liste) compte[x] = (compte[x] || 0) + 1;
  return Object.entries(compte).sort((a, b) => b[1] - a[1]).slice(0, n).map((e) => e[0]);
};

function analyser(c) {
  const jeux = (c.games || []).filter((g) => g && g.name);
  // Popularité : somme des votes des joueurs sur tous les jeux où le personnage apparaît.
  const score = jeux.reduce((s, g) => s + (g.total_rating_count || 0), 0);
  const dates = jeux.filter((g) => g.first_release_date).sort((a, b) => a.first_release_date - b.first_release_date);
  const premier = dates[0] || jeux[0];
  const phares = [...jeux].sort((a, b) => (b.total_rating_count || 0) - (a.total_rating_count || 0)).slice(0, 3);
  const dev = premier && (premier.involved_companies || []).find((ic) => ic.developer && ic.company);
  const franchises = plusFrequent(jeux.flatMap((g) => (g.franchises || []).map((f) => f.name)), 1);
  const genres = plusFrequent(jeux.flatMap((g) => (g.genres || []).map((x) => x.name)), 3);
  const sexe = (c.character_gender && c.character_gender.name) || c.gender;
  const espece = (c.character_species && c.character_species.name) || c.species;
  return {
    id: c.id,
    nom: c.name,
    alias: (c.akas || []).filter((a) => a && a !== c.name).slice(0, 2).join(', '),
    pays: c.country_name || '',
    sexe: SEXE[sexe] || (typeof sexe === 'string' ? sexe : ''),
    espece: ESPECE[espece] || (typeof espece === 'string' ? espece : ''),
    image: '',
    image_igdb: c.mug_shot && c.mug_shot.image_id ? `https://images.igdb.com/igdb/image/upload/t_720p/${c.mug_shot.image_id}.jpg` : '',
    premier_jeu: premier ? premier.name : '',
    description: c.description || '',
    score,
    nb_jeux: jeux.length,
    franchise: franchises[0] || '',
    premiere: premier ? `${premier.name}${annee(premier.first_release_date) ? ` (${annee(premier.first_release_date)})` : ''}` : '',
    annee_debut: premier ? annee(premier.first_release_date) : null,
    developpeur: dev ? dev.company.name : '',
    plateformes: premier ? (premier.platforms || []).map((p) => p.abbreviation).filter(Boolean).slice(0, 4).join(', ') : '',
    genres: genres.map((g) => GENRES_FR[g] || g).join(', '),
    titres_jeux: jeux.map((g) => g.name),
    jeux_phares: phares.map((g) => `${g.name}${annee(g.first_release_date) ? ` (${annee(g.first_release_date)})` : ''}`).join(' · '),
  };
}

// ---------- Images Fandom ----------
// Pour chaque franchise, on devine l'adresse de son wiki (ex. "The Legend of Zelda" → zelda.fandom.com),
// on vérifie que le wiki existe et correspond, puis on demande l'image principale de la page du personnage.
const UA = { 'User-Agent': 'trmnl-scouter/1.0 (usage personnel; github.com/nbbou81000)' };
const MOTS_VIDES = new Set(['the', 'of', 'and', 'a', 'an', 'de', 'la', 'le', 'les', 'du', 'des', 'series', 'game', 'games']);
const cacheWikis = {};

const simplifier = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function slugsPossibles(nom) {
  const mots = simplifier(nom).replace(/['’]/g, '').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const utiles = mots.filter((m) => !MOTS_VIDES.has(m));
  const liste = [
    mots.join(''),
    utiles.join(''),
    utiles.length > 1 ? utiles.map((m) => m[0]).join('') : '',
    utiles[utiles.length - 1],
    utiles[0],
    utiles.slice(0, 2).join(''),
  ];
  return [...new Set(liste.filter((x) => x && x.length >= 3))];
}

async function wikiExiste(slug) {
  try {
    await pause(150);
    const rep = await fetch(`https://${slug}.fandom.com/api.php?action=query&meta=siteinfo&format=json`, { headers: UA });
    if (!rep.ok || !new URL(rep.url).hostname.startsWith(`${slug}.`)) return null;
    const json = await rep.json();
    return (json.query && json.query.general && json.query.general.sitename) || null;
  } catch { return null; }
}

async function trouverWiki(p) {
  const cle = p.franchise || p.premier_jeu;
  if (!cle) return null;
  if (cle in cacheWikis) return cacheWikis[cle];
  let trouve = null;
  for (const slug of slugsPossibles(cle).slice(0, 6)) {
    const nomSite = await wikiExiste(slug);
    // Le nom du wiki doit rappeler la franchise (évite de tomber sur un wiki sans rapport).
    if (nomSite && simplifier(nomSite).replace(/[^a-z0-9]/g, '').includes(slug.slice(0, 4))) { trouve = slug; break; }
  }
  cacheWikis[cle] = trouve;
  return trouve;
}

// Texte brut de l'introduction d'une page (wikitexte de la section 0), sans modèles ni liens.
function texteIntro(wikitexte) {
  let t = wikitexte || '';
  for (let i = 0; i < 6; i++) t = t.replace(/\{\{[^{}]*\}\}/g, '');
  return t
    .replace(/<ref[^>]*\/>/gi, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/\[\[(?:File|Image|Fichier|Category|Catégorie):[^\]]*\]\]/gi, '')
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1').replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/\[https?:\S+ ([^\]]*)\]/g, '$1')
    .replace(/'{2,}/g, '').replace(/<[^>]+>/g, '').replace(/__\w+__/g, '')
    .replace(/\s+/g, ' ').trim().slice(0, 1500);
}

// La page doit citer l'un des jeux où IGDB situe le personnage, sinon c'est probablement un homonyme.
function citeUnJeu(wikitexte, titres) {
  const page = ` ${simplifier(wikitexte || '').replace(/[^a-z0-9]+/g, ' ')} `;
  return titres.some((t) => {
    const complet = simplifier(t).replace(/[^a-z0-9]+/g, ' ').trim();
    const court = simplifier(t.split(/[:–—-]/)[0]).replace(/[^a-z0-9]+/g, ' ').trim();
    return (complet.length >= 4 && page.includes(` ${complet} `)) || (court.length >= 6 && page.includes(` ${court} `));
  });
}

async function pagesDuWiki(slug, noms) {
  const resultat = {};
  for (let i = 0; i < noms.length; i += 50) {
    const lot = noms.slice(i, i + 50);
    const base = `https://${slug}.fandom.com/api.php?action=query&prop=pageimages|revisions&piprop=thumbnail&pithumbsize=1000&rvprop=content&rvslots=main&redirects=1&format=json&formatversion=2&titles=${encodeURIComponent(lot.join('|'))}`;
    try {
      await pause(250);
      let rep = await fetch(`${base}&rvsection=0`, { headers: UA });
      let json = rep.ok ? await rep.json() : null;
      if (!json || json.error) { // certains wikis refusent rvsection en lot
        await pause(250);
        rep = await fetch(base, { headers: UA });
        json = rep.ok ? await rep.json() : null;
      }
      const q = (json && json.query) || {};
      const vers = {};
      for (const n of q.normalized || []) vers[n.from] = n.to;
      for (const r of q.redirects || []) vers[r.from] = r.to;
      const pages = {};
      for (const pg of q.pages || []) {
        const rev = pg.revisions && pg.revisions[0];
        const texte = rev ? ((rev.slots && rev.slots.main && rev.slots.main.content) || rev.content || '') : '';
        pages[pg.title] = { image: pg.thumbnail && pg.thumbnail.source, texte: texte.split(/\n==[^=]/)[0] };
      }
      for (const nom of lot) {
        let t = vers[nom] || nom;
        t = vers[t] || t;
        if (pages[t]) resultat[nom] = pages[t];
      }
    } catch { /* wiki momentanément indisponible : on passe */ }
  }
  return resultat;
}

async function chercherImages(lot) {
  const parWiki = {};
  for (const p of lot) {
    const slug = await trouverWiki(p);
    if (slug) (parWiki[slug] = parWiki[slug] || []).push(p);
  }
  for (const [slug, persos] of Object.entries(parWiki)) {
    const pages = await pagesDuWiki(slug, [...new Set(persos.map((p) => p.nom))]);
    for (const p of persos) {
      const pg = pages[p.nom];
      if (!pg) continue;
      // Un nom complet (« Cloud Strife ») a peu d'homonymes ; un prénom seul (« Eustace ») doit être confirmé par un jeu cité.
      const nomComplet = p.nom.trim().split(/\s+/).filter((m) => m.length > 2).length >= 2;
      if (!nomComplet && !citeUnJeu(pg.texte, p.titres_jeux)) continue;
      const intro = texteIntro(pg.texte);
      if (intro.length > p.description.length) p.description = intro;
      if (pg.image && /\.(png|jpe?g|webp)/i.test(pg.image)) { p.image = pg.image; p.wiki = slug; p.source_image = 'Fandom'; }
    }
  }
}

async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('Secrets IGDB_CLIENT_ID et IGDB_CLIENT_SECRET manquants (voir le README).');
    process.exit(1);
  }
  const token = await jeton();

  // On choisit la liste de champs la plus riche acceptée par IGDB.
  let champs = null;
  for (const v of VARIANTES_CHAMPS) {
    const test = await igdb(token, `fields ${v.join(',')}; limit 1;`);
    if (test.ok) { champs = v; break; }
    console.warn(`  Champs refusés, essai suivant : ${test.erreur.slice(0, 200)}`);
  }
  if (!champs) throw new Error('Aucune combinaison de champs acceptée par IGDB.');

  // Comptage officiel IGDB, pour vérifier que la collecte est complète.
  const total = await igdb(token, 'where id > 0;', 'characters/count');
  const avecPortrait = await igdb(token, 'where mug_shot != null;', 'characters/count');
  console.log(`IGDB : ${total.ok ? total.data.count : '?'} personnages au total, dont ${avecPortrait.ok ? avecPortrait.data.count : '?'} avec un portrait.`);

  // Tous les personnages, page par page (pagination par identifiant croissant).
  const tous = [];
  let dernier = 0;
  for (;;) {
    const rep = await igdb(token, `fields ${champs.join(',')}; where id > ${dernier}; sort id asc; limit ${PAR_PAGE};`);
    if (!rep.ok) throw new Error(rep.erreur);
    if (!rep.data.length) break;
    for (const c of rep.data) {
      if (c.name) tous.push(analyser(c));
    }
    dernier = rep.data[rep.data.length - 1].id;
    console.log(`${tous.length} personnages récupérés…`);
  }

  // Les plus populaires d'abord ; on cherche une image pour chacun jusqu'à en avoir assez.
  const candidats = tous.filter((p) => p.score > 0).sort((a, b) => b.score - a.score);
  console.log(`${tous.length} personnages au total, ${candidats.length} apparaissent dans des jeux notés. Recherche des images sur Fandom…`);
  const garde = [];
  const parFranchise = {};
  const LOT = 300;
  for (let i = 0; i < candidats.length && garde.length < NB_PERSONNAGES; i += LOT) {
    const lot = candidats.slice(i, i + LOT);
    await chercherImages(lot);
    for (const p of lot) {
      if (garde.length >= NB_PERSONNAGES) break;
      if (!p.image && p.image_igdb) { p.image = p.image_igdb; p.source_image = 'IGDB'; }
      const cle = p.franchise || p.premier_jeu;
      if (p.image && (parFranchise[cle] || 0) < MAX_PAR_FRANCHISE) {
        parFranchise[cle] = (parFranchise[cle] || 0) + 1;
        garde.push(p);
      }
    }
    console.log(`${Math.min(i + LOT, candidats.length)} candidats examinés, ${garde.length} avec image (${Object.values(cacheWikis).filter(Boolean).length} wikis trouvés).`);
  }
  garde.forEach((p, i) => { p.rang = i + 1; delete p.image_igdb; delete p.titres_jeux; });

  if (garde.length < 100) {
    console.error('Base anormalement petite : on garde l\'ancienne base et on s\'arrête en erreur.');
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(SORTIE), { recursive: true });
  fs.writeFileSync(SORTIE, JSON.stringify({ genere: new Date().toISOString(), source: 'IGDB', personnages: garde }));
  console.log(`Base écrite : ${garde.length} personnages. Les 15 premiers : ${garde.slice(0, 15).map((p) => `${p.nom} [${p.wiki || 'IGDB'}]`).join(', ')}`);
}

module.exports = { analyser, slugsPossibles, texteIntro, citeUnJeu };
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
