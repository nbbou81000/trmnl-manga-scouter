// Constitue le corpus complet : pour chaque personnage de data/base.json, récupère sa fiche détaillée,
// la traduit en français (si MISTRAL_API_KEY est défini) et prépare son image pour l'e-ink.
// Résultat : data/fiches/<id>.json, images/<id>.png et data/index.json.
// Reprend là où il s'est arrêté : les personnages déjà traités sont ignorés.
// Enregistre (commit + push) régulièrement pour ne rien perdre si l'Action s'arrête.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const sharp = require('sharp');

const RACINE = path.join(__dirname, '..');
const BASE = path.join(RACINE, 'data', 'base.json');
const FICHES = path.join(RACINE, 'data', 'fiches');
const IMAGES = path.join(RACINE, 'images');
const INDEX = path.join(RACINE, 'data', 'index.json');
const MISTRAL_KEY = process.env.MISTRAL_API_KEY;
const BUDGET_MIN = parseInt(process.env.MAX_MINUTES || '300', 10); // l'Action s'arrête proprement avant la limite de 6 h
const ENREGISTRER_TOUS = 250;

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const debut = Date.now();
const tempsEcoule = () => (Date.now() - debut) / 60000;

function analyserBio(description) {
  // Descriptions AniList : "__Taille :__ 172 cm", spoilers entre ~! et !~, liens markdown, balises HTML.
  const propre = (description || '')
    .replace(/~!(.|\n)*?!~/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\r/g, '');
  const stats = [];
  const texte = [];
  for (const brute of propre.split('\n')) {
    const l = brute.trim();
    if (!l) continue;
    if (/^\(?sources?\s*:/i.test(l)) continue;
    const m = l.match(/^(?:__|\*\*)?([A-Z][A-Za-z' ()/-]{1,24}):?(?:__|\*\*)?:?\s*(.{1,60})$/);
    if (m && /^(__|\*\*)/.test(l) && texte.length === 0 && stats.length < 8) {
      stats.push({ label: m[1].trim(), valeur: m[2].replace(/[_*]/g, '').trim() });
    } else {
      texte.push(l.replace(/__|\*\*/g, '').replace(/(^|\s)_([^_]+)_/g, '$1$2'));
    }
  }
  return { stats, texte: texte.join(' ').replace(/\s+/g, ' ').trim() };
}

function couper(txt, max) {
  if (!txt || txt.length <= max) return txt || '';
  const coupe = txt.slice(0, max);
  const fin = Math.max(coupe.lastIndexOf('. '), coupe.lastIndexOf('! '), coupe.lastIndexOf('? '));
  return fin > max * 0.5 ? coupe.slice(0, fin + 1) : coupe.replace(/\s+\S*$/, '') + '…';
}

async function traduire(nom, manga, bio, stats) {
  const consigne = `Tu rédiges une fiche de personnage de manga pour un petit écran e-ink, en français.
Personnage : ${nom} (manga : ${manga}).
Biographie d'origine (anglais) : """${bio.slice(0, 3000)}"""
Caractéristiques d'origine : ${JSON.stringify(stats)}

Réponds uniquement en JSON : {"resume": "...", "stats": [{"label": "...", "valeur": "..."}]}
- "resume" : 2 ou 3 phrases en français, 330 caractères maximum, sans révéler de rebondissement majeur. Si la biographie est vide, présente le personnage en une phrase à partir de son nom et de son manga.
- "stats" : traduis en français les caractéristiques fournies (labels courts, 14 caractères max), garde au plus 6 lignes, n'en invente aucune. Liste vide si aucune.`;
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

// Image officielle AniList préparée pour l'e-ink : niveaux de gris, agrandie, contraste et netteté
// renforcés, réduite à 16 niveaux de gris pour garder des fichiers légers (environ 50 à 100 Ko).
async function preparerImage(url, destination) {
  const rep = await fetch(url);
  if (!rep.ok) throw new Error(`image ${rep.status}`);
  await sharp(Buffer.from(await rep.arrayBuffer()))
    .grayscale()
    .resize({ height: 900, kernel: 'lanczos3' })
    .normalise()
    .linear(1.25, -25)
    .sharpen({ sigma: 1.2 })
    .toColourspace('b-w')
    .png({ palette: true, colors: 16, dither: 0, compressionLevel: 9 })
    .toFile(destination);
}

function ecrireIndex() {
  const ids = fs.readdirSync(FICHES).filter((f) => f.endsWith('.json')).map((f) => parseInt(f, 10));
  fs.writeFileSync(INDEX, JSON.stringify(ids));
  return ids.length;
}

function enregistrer(message) {
  const total = ecrireIndex();
  try {
    execSync('git add data images', { stdio: 'inherit' });
    execSync(`git diff --cached --quiet || git commit -q -m "${message} (${total} fiches)"`, { stdio: 'inherit', shell: '/bin/bash' });
    execSync('git pull -q --rebase && git push -q', { stdio: 'inherit', shell: '/bin/bash' });
  } catch (e) {
    console.warn(`Enregistrement intermédiaire impossible : ${e.message}`);
  }
}

async function main() {
  const base = JSON.parse(fs.readFileSync(BASE, 'utf8'));
  fs.mkdirSync(FICHES, { recursive: true });
  fs.mkdirSync(IMAGES, { recursive: true });

  let aFaire = base.personnages.filter((p) => !fs.existsSync(path.join(FICHES, `${p.id}.json`)));
  // Mode test : on ne traite que quelques personnages, pris au hasard dans des mangas variés.
  const MAX_FICHES = parseInt(process.env.MAX_FICHES || '0', 10);
  if (MAX_FICHES > 0) {
    aFaire = aFaire.sort(() => Math.random() - 0.5).slice(0, MAX_FICHES);
    console.log(`Mode test : ${MAX_FICHES} fiches seulement.`);
  }
  console.log(`${base.personnages.length} personnages dans la base, ${aFaire.length} restent à traiter.`);
  if (!MISTRAL_KEY) console.log('Pas de clé Mistral : les fiches seront en anglais.');

  let faits = 0;
  let echecs = 0;
  for (const p of aFaire) {
    if (tempsEcoule() > BUDGET_MIN) {
      console.log(`Budget de ${BUDGET_MIN} min atteint : relance l'Action pour continuer.`);
      break;
    }
    const manga = base.mangas[p.m];
    try {
      await preparerImage(p.image, path.join(IMAGES, `${p.id}.png`));
    } catch (e) {
      console.warn(`${p.nom} : image impossible (${e.message}${e.cause ? ' — ' + e.cause.message : ''}), personnage ignoré.`);
      echecs++;
      continue;
    }

    const bio = analyserBio(p.description);
    // Caractéristiques structurées d'AniList d'abord, puis celles trouvées en tête de biographie.
    const stats = [
      p.genre && { label: 'Gender', valeur: p.genre },
      p.age && { label: 'Age', valeur: String(p.age) },
      p.anniversaire && { label: 'Birthday', valeur: p.anniversaire },
      p.groupe_sanguin && { label: 'Blood type', valeur: p.groupe_sanguin },
    ].filter(Boolean);
    for (const s of bio.stats) {
      if (!stats.some((x) => x.label.toLowerCase() === s.label.toLowerCase())) stats.push(s);
    }
    const texte = bio.texte;
    const fiche = {
      id: p.id,
      nom: p.nom,
      nom_natif: p.nom_natif,
      surnom: p.surnom,
      manga: manga.titre,
      auteurs: manga.auteurs.join(', '),
      rang_manga: manga.rang,
      role: p.role === 'MAIN' ? 'Principal' : 'Secondaire',
      fans: p.fans,
      stats: stats.slice(0, 6),
      resume: couper(texte, 330) || `${p.nom} appears in ${manga.titre}.`,
      langue: 'en',
    };

    if (MISTRAL_KEY) {
      try {
        const fr = await traduire(fiche.nom, fiche.manga, texte, stats);
        if (fr.resume) { fiche.resume = couper(fr.resume, 360); fiche.langue = 'fr'; }
        if (Array.isArray(fr.stats)) fiche.stats = fr.stats.slice(0, 6);
      } catch (e) {
        console.warn(`${p.nom} : traduction impossible (${e.message}), fiche en anglais.`);
      }
    }

    fs.writeFileSync(path.join(FICHES, `${p.id}.json`), JSON.stringify(fiche));
    faits++;
    if (faits % 25 === 0) console.log(`${faits}/${aFaire.length} — ${Math.round(tempsEcoule())} min`);
    if (faits % ENREGISTRER_TOUS === 0) enregistrer('Corpus : enregistrement intermédiaire');
  }

  enregistrer('Corpus mis à jour');
  console.log(`Terminé : ${faits} fiches ajoutées, ${echecs} échecs, ${ecrireIndex()} fiches au total.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
                  
