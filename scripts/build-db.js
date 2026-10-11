// Construit la base de personnages à partir des mangas les plus populaires (API Jikan / MyAnimeList).
// Lancé chaque semaine par la GitHub Action "Construire la base".
// Réglages (variables d'environnement) : NB_MANGAS (défaut 100), MAX_PAR_MANGA (défaut 40).

const fs = require('fs');
const path = require('path');

const API = 'https://api.jikan.moe/v4';
const NB_MANGAS = parseInt(process.env.NB_MANGAS || '100', 10);
const MAX_PAR_MANGA = parseInt(process.env.MAX_PAR_MANGA || '40', 10);
const SORTIE = path.join(__dirname, '..', 'data', 'base.json');

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// Jikan limite à ~60 requêtes/minute : on attend 1,2 s entre chaque appel et on réessaie en cas d'erreur.
async function get(url) {
  for (let essai = 1; essai <= 5; essai++) {
    await pause(1200);
    try {
      const rep = await fetch(url, { headers: { 'User-Agent': 'trmnl-manga-scouter (perso)' } });
      if (rep.ok) return await rep.json();
      console.warn(`  ${rep.status} sur ${url} (essai ${essai})`);
      if (rep.status === 404) return null;
    } catch (e) {
      console.warn(`  Erreur réseau sur ${url} (essai ${essai}) : ${e.message}`);
    }
    await pause(3000 * essai);
  }
  return null;
}

function imageValide(url) {
  return url && !/questionmark|apple-touch-icon|na_series|na\.gif/i.test(url);
}

async function main() {
  // 1. Les mangas les plus populaires (type "manga" = mangas japonais uniquement)
  const mangas = [];
  for (let page = 1; mangas.length < NB_MANGAS; page++) {
    const res = await get(`${API}/top/manga?type=manga&filter=bypopularity&page=${page}`);
    if (!res || !res.data || res.data.length === 0) break;
    for (const m of res.data) {
      if (mangas.length >= NB_MANGAS) break;
      mangas.push({
        id: m.mal_id,
        titre: m.title_english || m.title,
        titre_original: m.title,
        rang_popularite: m.popularity,
        auteurs: (m.authors || []).map((a) => a.name.split(', ').reverse().join(' ')),
      });
    }
    if (!res.pagination || !res.pagination.has_next_page) break;
  }
  console.log(`${mangas.length} mangas récupérés.`);

  // 2. Les personnages de chaque manga
  const personnages = [];
  const dejaVus = new Set();
  for (let i = 0; i < mangas.length; i++) {
    const m = mangas[i];
    const res = await get(`${API}/manga/${m.id}/characters`);
    if (!res || !res.data) continue;
    const liste = res.data
      .filter((c) => imageValide(c.character?.images?.jpg?.image_url))
      .sort((a, b) => {
        if (a.role !== b.role) return a.role === 'Main' ? -1 : 1;
        return (b.favorites || 0) - (a.favorites || 0);
      })
      .slice(0, MAX_PAR_MANGA);
    let ajoutes = 0;
    for (const c of liste) {
      if (dejaVus.has(c.character.mal_id)) continue; // un personnage présent dans plusieurs séries reste rattaché à la plus populaire
      dejaVus.add(c.character.mal_id);
      personnages.push({ id: c.character.mal_id, nom: c.character.name, role: c.role, m: i });
      ajoutes++;
    }
    console.log(`[${i + 1}/${mangas.length}] ${m.titre} : ${ajoutes} personnages`);
  }

  if (personnages.length < 100) {
    console.error('Base anormalement petite : on garde l\'ancienne base et on s\'arrête en erreur.');
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(SORTIE), { recursive: true });
  fs.writeFileSync(SORTIE, JSON.stringify({ genere: new Date().toISOString(), mangas, personnages }));
  console.log(`Base écrite : ${personnages.length} personnages issus de ${mangas.length} mangas.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
