// Construit la base des personnages de jeux vidéo à partir d'IGDB (base de données de jeux de Twitch).
// Lancé à la main par l'Action "JV — Construire la base".
// Nécessite les secrets IGDB_CLIENT_ID et IGDB_CLIENT_SECRET (application gratuite sur dev.twitch.tv).
// Réglage : NB_PERSONNAGES (défaut 5000) = nombre de personnages les plus populaires à garder.

const fs = require('fs');
const path = require('path');

const CLIENT_ID = process.env.IGDB_CLIENT_ID;
const CLIENT_SECRET = process.env.IGDB_CLIENT_SECRET;
const NB_PERSONNAGES = parseInt(process.env.NB_PERSONNAGES || '5000', 10);
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
    image: `https://images.igdb.com/igdb/image/upload/t_720p/${c.mug_shot.image_id}.jpg`,
    description: c.description || '',
    score,
    nb_jeux: jeux.length,
    franchise: franchises[0] || '',
    premiere: premier ? `${premier.name}${annee(premier.first_release_date) ? ` (${annee(premier.first_release_date)})` : ''}` : '',
    annee_debut: premier ? annee(premier.first_release_date) : null,
    developpeur: dev ? dev.company.name : '',
    plateformes: premier ? (premier.platforms || []).map((p) => p.abbreviation).filter(Boolean).slice(0, 4).join(', ') : '',
    genres: genres.map((g) => GENRES_FR[g] || g).join(', '),
    jeux_phares: phares.map((g) => `${g.name}${annee(g.first_release_date) ? ` (${annee(g.first_release_date)})` : ''}`).join(' · '),
  };
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
    const test = await igdb(token, `fields ${v.join(',')}; where mug_shot != null; limit 1;`);
    if (test.ok) { champs = v; break; }
    console.warn(`  Champs refusés, essai suivant : ${test.erreur.slice(0, 200)}`);
  }
  if (!champs) throw new Error('Aucune combinaison de champs acceptée par IGDB.');

  // Comptage officiel IGDB, pour vérifier que la collecte est complète.
  const total = await igdb(token, 'where id > 0;', 'characters/count');
  const avecPortrait = await igdb(token, 'where mug_shot != null;', 'characters/count');
  console.log(`IGDB : ${total.ok ? total.data.count : '?'} personnages au total, dont ${avecPortrait.ok ? avecPortrait.data.count : '?'} avec un portrait.`);

  // Tous les personnages illustrés, page par page (pagination par identifiant croissant).
  const tous = [];
  let dernier = 0;
  for (;;) {
    const rep = await igdb(token, `fields ${champs.join(',')}; where mug_shot != null & id > ${dernier}; sort id asc; limit ${PAR_PAGE};`);
    if (!rep.ok) throw new Error(rep.erreur);
    if (!rep.data.length) break;
    for (const c of rep.data) {
      if (c.mug_shot && c.mug_shot.image_id) tous.push(analyser(c));
    }
    dernier = rep.data[rep.data.length - 1].id;
    console.log(`${tous.length} personnages illustrés récupérés (page de ${rep.data.length}, dernier id ${dernier})…`);
  }

  // On garde les plus populaires.
  const garde = tous.filter((p) => p.score > 0).sort((a, b) => b.score - a.score).slice(0, NB_PERSONNAGES);
  garde.forEach((p, i) => { p.rang = i + 1; });
  console.log(`${tous.length} personnages illustrés au total, ${garde.length} gardés (les plus populaires).`);

  if (garde.length < 100) {
    console.error('Base anormalement petite : on garde l\'ancienne base et on s\'arrête en erreur.');
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(SORTIE), { recursive: true });
  fs.writeFileSync(SORTIE, JSON.stringify({ genere: new Date().toISOString(), source: 'IGDB', personnages: garde }));
  console.log(`Base écrite : ${garde.length} personnages. Exemples : ${garde.slice(0, 10).map((p) => p.nom).join(', ')}`);
}

module.exports = { analyser };
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
