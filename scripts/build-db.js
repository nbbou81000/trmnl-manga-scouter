// Construit la base de personnages à partir des mangas japonais les plus populaires (API AniList).
// Lancé chaque semaine par la GitHub Action "Construire la base".
// Réglages (variables d'environnement) : NB_MANGAS (défaut 100), MAX_PAR_MANGA (défaut 40).

const fs = require('fs');
const path = require('path');

const API = 'https://graphql.anilist.co';
const NB_MANGAS = parseInt(process.env.NB_MANGAS || '100', 10);
const MAX_PAR_MANGA = parseInt(process.env.MAX_PAR_MANGA || '40', 10);
const SORTIE = path.join(__dirname, '..', 'data', 'base.json');
// Séries à inclure en entier (tous les personnages), séparées par des virgules, ex. "Dragon Ball, One Piece".
const SERIES_COMPLETES = (process.env.SERIES_COMPLETES || '').split(',').map((x) => x.trim()).filter(Boolean);
const MAX_SERIE_COMPLETE = 1000;

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// AniList limite le nombre de requêtes par minute : on espace les appels et on respecte "Retry-After".
async function requete(query, variables) {
  for (let essai = 1; essai <= 6; essai++) {
    await pause(2200);
    try {
      const rep = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query, variables }),
      });
      if (rep.status === 429) {
        const attente = parseInt(rep.headers.get('retry-after') || '60', 10);
        console.warn(`  Limite AniList atteinte, pause de ${attente} s`);
        await pause(attente * 1000);
        continue;
      }
      const json = await rep.json();
      if (rep.ok && json.data) return json.data;
      console.warn(`  Réponse ${rep.status} (essai ${essai}) : ${JSON.stringify(json.errors || '').slice(0, 200)}`);
    } catch (e) {
      console.warn(`  Erreur réseau (essai ${essai}) : ${e.message}${e.cause ? ' — ' + e.cause.message : ''}`);
    }
    await pause(3000 * essai);
  }
  return null;
}

const Q_TOP = `query ($page: Int) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    media(type: MANGA, sort: POPULARITY_DESC, countryOfOrigin: "JP", isAdult: false) {
      id
      title { romaji english }
      staff(perPage: 6, sort: RELEVANCE) { edges { role node { name { full } } } }
    }
  }
}`;

const Q_PERSOS = `query ($id: Int, $page: Int) {
  Media(id: $id) {
    characters(page: $page, perPage: 25, sort: [ROLE, FAVOURITES_DESC]) {
      pageInfo { hasNextPage }
      edges {
        role
        node {
          id
          name { full native alternative }
          image { large }
          description(asHtml: false)
          favourites
          gender
          age
          bloodType
          dateOfBirth { month day }
        }
      }
    }
  }
}`;

const Q_RECHERCHE = `query ($search: String) {
  Page(page: 1, perPage: 15) {
    media(search: $search, type: MANGA, sort: SEARCH_MATCH) {
      id
      countryOfOrigin
      title { romaji english }
      staff(perPage: 6, sort: RELEVANCE) { edges { role node { name { full } } } }
    }
  }
}`;

function imageValide(url) {
  return url && !/\/default\.(jpg|png)/i.test(url);
}

async function main() {
  // 1. Les mangas japonais les plus populaires
  const mangas = [];
  for (let page = 1; mangas.length < NB_MANGAS; page++) {
    const data = await requete(Q_TOP, { page });
    if (!data) break;
    for (const m of data.Page.media) {
      if (mangas.length >= NB_MANGAS) break;
      const auteurs = [...new Set(m.staff.edges
        .filter((e) => /story|art|original creator/i.test(e.role))
        .map((e) => e.node.name.full))].slice(0, 2);
      mangas.push({ id: m.id, titre: m.title.english || m.title.romaji, titre_original: m.title.romaji, rang: mangas.length + 1, auteurs });
    }
    if (!data.Page.pageInfo.hasNextPage) break;
  }
  // 1 bis. Les séries demandées en entier : tous les mangas dont le titre contient le nom cherché.
  for (const nom of SERIES_COMPLETES) {
    const data = await requete(Q_RECHERCHE, { search: nom });
    if (!data) continue;
    const cle = nom.toLowerCase();
    for (const m of data.Page.media) {
      const titres = [m.title.romaji, m.title.english].filter(Boolean).join(' | ').toLowerCase();
      if (m.countryOfOrigin !== 'JP' || !titres.includes(cle)) continue;
      const existant = mangas.find((x) => x.id === m.id);
      if (existant) { existant.complet = true; continue; }
      const auteurs = [...new Set(m.staff.edges
        .filter((e) => /story|art|original creator/i.test(e.role))
        .map((e) => e.node.name.full))].slice(0, 2);
      mangas.push({ id: m.id, titre: m.title.english || m.title.romaji, titre_original: m.title.romaji, rang: 0, auteurs, complet: true });
      console.log(`Série complète ajoutée : ${m.title.english || m.title.romaji}`);
    }
  }
  // Les séries complètes passent en premier, pour que leurs personnages leur soient rattachés.
  mangas.sort((a, b) => (b.complet ? 1 : 0) - (a.complet ? 1 : 0));
  console.log(`${mangas.length} mangas récupérés.`);
  if (mangas.length === 0) { console.error('Impossible de joindre AniList.'); process.exit(1); }

  // 2. Les personnages de chaque manga (principaux d'abord, puis les plus appréciés)
  const personnages = [];
  const dejaVus = new Set();
  for (let i = 0; i < mangas.length; i++) {
    const m = mangas[i];
    let ajoutes = 0;
    const limite = m.complet ? MAX_SERIE_COMPLETE : MAX_PAR_MANGA;
    for (let page = 1; ajoutes < limite; page++) {
      const data = await requete(Q_PERSOS, { id: m.id, page });
      if (!data || !data.Media) break;
      for (const e of data.Media.characters.edges) {
        const c = e.node;
        if (ajoutes >= limite) break;
        if (dejaVus.has(c.id) || !imageValide(c.image?.large) || (e.role === 'BACKGROUND' && !m.complet)) continue;
        dejaVus.add(c.id); // un personnage présent dans plusieurs séries reste rattaché à la plus populaire
        personnages.push({
          id: c.id,
          m: i,
          role: e.role,
          nom: c.name.full,
          nom_natif: c.name.native || '',
          surnom: (c.name.alternative || []).filter(Boolean)[0] || '',
          image: c.image.large,
          fans: c.favourites || 0,
          genre: c.gender || '',
          age: c.age || '',
          groupe_sanguin: c.bloodType || '',
          anniversaire: c.dateOfBirth && c.dateOfBirth.month ? `${c.dateOfBirth.day || '?'}/${c.dateOfBirth.month}` : '',
          description: c.description || '',
        });
        ajoutes++;
      }
      if (!data.Media.characters.pageInfo.hasNextPage) break;
    }
    console.log(`[${i + 1}/${mangas.length}] ${m.titre} : ${ajoutes} personnages`);
  }

  if (personnages.length < 100) {
    console.error('Base anormalement petite : on garde l\'ancienne base et on s\'arrête en erreur.');
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(SORTIE), { recursive: true });
  fs.writeFileSync(SORTIE, JSON.stringify({ genere: new Date().toISOString(), source: 'AniList', mangas, personnages }));
  console.log(`Base écrite : ${personnages.length} personnages issus de ${mangas.length} mangas.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
