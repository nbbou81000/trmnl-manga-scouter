// Constitue le corpus des personnages de jeux vidéo : pour chaque personnage de data/jv/base.json,
// rédige un résumé en français (si MISTRAL_API_KEY est défini) et prépare son image pour l'e-ink.
// Résultat : data/jv/fiches/<id>.json, images/jv/<id>.png, puis le tirage data/jv/tirage/0.json … N.json.
// Reprend là où il s'est arrêté et enregistre régulièrement (commit + push).

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const sharp = require('sharp');

const RACINE = path.join(__dirname, '..');
const BASE = path.join(RACINE, 'data', 'jv', 'base.json');
const FICHES = path.join(RACINE, 'data', 'jv', 'fiches');
const IMAGES = path.join(RACINE, 'images', 'jv');
const TIRAGE = path.join(RACINE, 'data', 'jv', 'tirage');
const MISTRAL_KEY = process.env.MISTRAL_API_KEY;
const BUDGET_MIN = parseInt(process.env.MAX_MINUTES || '300', 10);
const MAX_FICHES = parseInt(process.env.MAX_FICHES || '0', 10);
const ENREGISTRER_TOUS = 150;

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const debut = Date.now();
const tempsEcoule = () => (Date.now() - debut) / 60000;
const milliers = (n) => String(n || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

function couper(txt, max) {
  if (!txt || txt.length <= max) return txt || '';
  const coupe = txt.slice(0, max);
  const fin = Math.max(coupe.lastIndexOf('. '), coupe.lastIndexOf('! '), coupe.lastIndexOf('? '));
  return fin > max * 0.5 ? coupe.slice(0, fin + 1) : coupe.replace(/\s+\S*$/, '') + '…';
}

async function resumer(p) {
  const consigne = `Tu rédiges une fiche de personnage de jeu vidéo pour un petit écran e-ink, en français.
Personnage : ${p.nom}${p.alias ? ` (alias : ${p.alias})` : ''}
Franchise : ${p.franchise || 'inconnue'} — Première apparition : ${p.premiere || 'inconnue'} — Jeux phares : ${p.jeux_phares}
Description d'origine (anglais, peut être vide) : """${p.description.slice(0, 3000)}"""

Réponds uniquement en JSON : {"resume": "...", "role": "...", "premiere": "...", "developpeur": "...", "plateformes": "..."}
- "resume" : 2 ou 3 phrases en français, 330 caractères maximum, sans révéler de rebondissement majeur. Appuie-toi sur la description ; si elle est vide, n'utilise que les informations ci-dessus ou des faits dont tu es certain, sans rien inventer.
- "role" : en 2 à 4 mots, le rôle du personnage dans son univers (ex. "Héros principal", "Antagoniste", "Mentor", "Allié", "Boss", "Personnage jouable"). Chaîne vide si tu n'es pas sûr.
- "premiere" : la toute PREMIÈRE apparition du personnage dans un jeu vidéo, au format "Titre (année)", UNIQUEMENT si tu en es certain et qu'elle diffère de "${p.premiere}" (la base de données est parfois incomplète). Sinon chaîne vide.
- "developpeur" et "plateformes" : le studio et les plateformes d'origine (abréviations, 3 maximum) de CETTE première apparition, uniquement si tu as rempli "premiere" et que tu en es certain. Sinon chaînes vides.`;
  for (let essai = 1; essai <= 3; essai++) {
    const rep = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MISTRAL_KEY}` },
      body: JSON.stringify({
        model: 'mistral-small-latest',
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: consigne }],
      }),
    });
    if (rep.ok) return JSON.parse((await rep.json()).choices[0].message.content);
    if (rep.status !== 429 && rep.status < 500) throw new Error(`Mistral ${rep.status}`);
    await pause(5000 * essai);
  }
  throw new Error('Mistral indisponible');
}

// Image IGDB préparée pour l'e-ink : niveaux de gris, contraste et netteté renforcés, 16 niveaux de gris.
async function preparerImage(url, destination) {
  const UA = { 'User-Agent': 'trmnl-scouter/1.0 (usage personnel; github.com/nbbou81000)' };
  let rep = await fetch(url, { headers: UA });
  if (!rep.ok && url.includes('/t_720p/')) rep = await fetch(url.replace('/t_720p/', '/t_cover_big/'));
  if (!rep.ok) throw new Error(`image ${rep.status}`);
  await sharp(Buffer.from(await rep.arrayBuffer()))
    .flatten({ background: '#ffffff' }) // les rendus Fandom ont souvent un fond transparent
    .grayscale()
    .resize({ height: 800, withoutEnlargement: false, kernel: 'lanczos3' })
    .normalise()
    .linear(1.2, -20)
    .sharpen({ sigma: 1.1 })
    .toColourspace('b-w')
    .png({ palette: true, colors: 16, dither: 0, compressionLevel: 9 })
    .toFile(destination);
}

function lignes(p, role) {
  return [
    p.franchise && { label: 'FRANCHISE', valeur: p.franchise },
    role && { label: 'RÔLE', valeur: role },
    p.premiere && { label: '1RE APPARITION', valeur: p.premiere },
    p.developpeur && { label: 'DÉVELOPPEUR', valeur: p.developpeur },
    p.plateformes && { label: 'PLATEFORMES', valeur: p.plateformes },
    p.genres && { label: 'GENRES', valeur: p.genres },
    p.nb_jeux > 1 && { label: 'JEUX RECENSÉS', valeur: `${p.nb_jeux}` },
    p.espece && { label: 'ESPÈCE', valeur: p.espece },
    p.sexe && { label: 'SEXE', valeur: p.sexe },
    p.pays && { label: 'ORIGINE', valeur: p.pays },
    { label: 'POPULARITÉ', valeur: `n° ${milliers(p.rang)}` },
  ].filter(Boolean);
}

function publierTirage(base) {
  const ids = fs.readdirSync(FICHES).filter((f) => f.endsWith('.json')).map((f) => parseInt(f, 10)).sort((a, b) => a - b);
  if (!ids.length) return;
  const depot = process.env.GITHUB_REPOSITORY || 'nbbou81000/trmnl-manga-scouter';
  const total = milliers(ids.length);
  fs.rmSync(TIRAGE, { recursive: true, force: true });
  fs.mkdirSync(TIRAGE, { recursive: true });
  ids.forEach((id, n) => {
    const f = JSON.parse(fs.readFileSync(path.join(FICHES, `${id}.json`), 'utf8'));
    f.image = `https://raw.githubusercontent.com/${depot}/main/images/jv/${id}.png`;
    f.total_personnages = total;
    fs.writeFileSync(path.join(TIRAGE, `${n}.json`), JSON.stringify(f));
  });
  fs.writeFileSync(path.join(RACINE, 'data', 'jv', 'count.json'), JSON.stringify({ count: ids.length, max: ids.length - 1 }));
  console.log(`Tirage publié : ${ids.length} cases. Dans l'URL de polling de TRMNL, partie jeux vidéo : random_number: 0, ${ids.length - 1}`);
}

function enregistrer(message) {
  const total = fs.readdirSync(FICHES).filter((f) => f.endsWith('.json')).length;
  try {
    execSync('git add -A data/jv images/jv', { stdio: 'inherit' });
    execSync(`git diff --cached --quiet || git commit -q -m "${message} (${total} fiches JV)"`, { stdio: 'inherit', shell: '/bin/bash' });
    execSync('git pull -q --rebase && git push -q', { stdio: 'inherit', shell: '/bin/bash' });
  } catch (e) {
    console.warn(`Enregistrement impossible : ${e.message}`);
  }
}

async function main() {
  const base = JSON.parse(fs.readFileSync(BASE, 'utf8'));
  fs.mkdirSync(FICHES, { recursive: true });
  fs.mkdirSync(IMAGES, { recursive: true });

  let aFaire = base.personnages.filter((p) => !fs.existsSync(path.join(FICHES, `${p.id}.json`)));
  if (MAX_FICHES > 0) {
    aFaire = aFaire.sort(() => Math.random() - 0.5).slice(0, MAX_FICHES);
    console.log(`Mode test : ${MAX_FICHES} fiches seulement.`);
  }
  console.log(`${base.personnages.length} personnages dans la base, ${aFaire.length} restent à traiter.`);
  if (!MISTRAL_KEY) console.log('Pas de clé Mistral : les résumés seront en anglais.');

  let faits = 0;
  let echecs = 0;
  for (let p of aFaire) {
    if (tempsEcoule() > BUDGET_MIN) {
      console.log(`Budget de ${BUDGET_MIN} min atteint : relance l'Action pour continuer.`);
      break;
    }
    try {
      await preparerImage(p.image, path.join(IMAGES, `${p.id}.png`));
    } catch (e) {
      console.warn(`${p.nom} : image impossible (${e.message}), personnage ignoré.`);
      echecs++;
      continue;
    }

    let resume = couper(p.description.replace(/\s+/g, ' ').trim(), 330) || `${p.nom} appears in ${p.premiere || 'video games'}.`;
    let role = '';
    let langue = 'en';
    if (MISTRAL_KEY) {
      try {
        const fr = await resumer(p);
        if (fr.resume) { resume = couper(fr.resume, 360); langue = 'fr'; }
        if (fr.role) role = String(fr.role).slice(0, 30);
        if (fr.premiere && /\(\d{4}\)/.test(fr.premiere)) {
          p = { ...p, premiere: String(fr.premiere).slice(0, 60), developpeur: fr.developpeur || '', plateformes: fr.plateformes || '' };
        }
      } catch (e) {
        console.warn(`${p.nom} : résumé impossible (${e.message}), fiche en anglais.`);
      }
    }

    const fiche = {
      type: 'jv',
      id: p.id,
      nom: p.nom,
      alias: p.alias,
      franchise: p.franchise,
      lignes: lignes(p, role),
      jeux_phares: p.jeux_phares,
      resume,
      langue,
    };
    fs.writeFileSync(path.join(FICHES, `${p.id}.json`), JSON.stringify(fiche));
    faits++;
    if (faits % 25 === 0) console.log(`${faits}/${aFaire.length} — ${Math.round(tempsEcoule())} min`);
    if (faits % ENREGISTRER_TOUS === 0) enregistrer('Corpus JV : enregistrement intermédiaire');
  }

  publierTirage(base);
  enregistrer('Corpus JV mis à jour');
  console.log(`Terminé : ${faits} fiches ajoutées, ${echecs} échecs.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
