'use strict';
/* Page de pilotage Clip & Croc.
   - Elle lit un seul fichier du dépôt : etat/tableau.json.
   - Elle n'écrit qu'à un seul endroit : boite/demandes/<id>.json. L'automate GitHub fait le reste.
   - Elle n'envoie jamais de message : elle copie le texte et ouvre le profil, Mathis envoie.
   - Aucune clé de modèle ou de génération ne passe par ici : elles sont dans les secrets de GitHub. */

const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
const COFFRE = 'cc-coffre';
const S = { jeton: null, depot: null, T: null, vue: 'accueil', agent: null, fils: {}, occupe: false, chargeLe: 0, veille: null };
const $ = id => document.getElementById(id);
const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = n => Number(n || 0).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
const vide = t => `<div class="vide">${t}</div>`;
const lienSur = u => /^https:\/\/(www\.)?(instagram\.com|tiktok\.com)\//.test(u || '') ? u : '';

/* ---------- Coffre : le jeton GitHub est chiffré avec le mot de passe, dans ce navigateur ---------- */
const b64 = { vers: buf => btoa(String.fromCharCode(...new Uint8Array(buf))), de: s => Uint8Array.from(atob(s), c => c.charCodeAt(0)) };
async function cle(motDePasse, sel) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(motDePasse), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: sel, iterations: 600000, hash: 'SHA-256' }, base,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function fermerCoffre(motDePasse, depot, jeton) {
  const sel = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const donnees = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await cle(motDePasse, sel), new TextEncoder().encode(jeton));
  localStorage.setItem(COFFRE, JSON.stringify({ depot, sel: b64.vers(sel), iv: b64.vers(iv), donnees: b64.vers(donnees) }));
}
async function ouvrirCoffre(motDePasse) {
  const c = JSON.parse(localStorage.getItem(COFFRE));
  const clair = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64.de(c.iv) }, await cle(motDePasse, b64.de(c.sel)), b64.de(c.donnees));
  return { depot: c.depot, jeton: new TextDecoder().decode(clair) };
}

/* ---------- Accès aux fichiers ---------- */
const adresse = chemin => LOCAL ? `/api/contents/${chemin}` : `https://api.github.com/repos/${S.depot}/contents/${chemin}`;
const entetes = () => LOCAL ? { 'Content-Type': 'application/json' }
  : { 'Authorization': `Bearer ${S.jeton}`, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
const texteDe = contenu => new TextDecoder().decode(b64.de(contenu.replace(/\s/g, '')));
const versB64 = texte => { const o = new TextEncoder().encode(texte); let s = ''; o.forEach(x => s += String.fromCharCode(x)); return btoa(s); };

/* Diagnostic du jeton à l'installation : dit précisément ce qui ne va pas. */
async function diagnostiquer() {
  const appel = async chemin => { try { return await fetch('https://api.github.com' + chemin, { headers: entetes(), cache: 'no-store' }); } catch { throw new Error('Pas de réponse de GitHub : vérifiez la connexion internet de cet appareil.'); } };
  const u = await appel('/user');
  if (u.status === 401) throw new Error('1/3 Le jeton n\'est pas reconnu par GitHub (code 401) : il est mal copié, supprimé, régénéré ou expiré. Créez-en un nouveau et collez-le en entier.');
  const r = await appel('/repos/' + S.depot);
  if (r.status === 404) throw new Error('2/3 Ce jeton ne donne pas accès au dépôt « ' + S.depot + ' » (code 404). Soit le nom du dépôt est mal écrit (attendu : votre-compte/nom-du-dépôt-privé), soit le jeton n\'a pas été limité à ce dépôt : sur GitHub, « Repository access » doit contenir clipandcroc-os.');
  if (!r.ok) throw new Error('2/3 GitHub répond avec le code ' + r.status + ' pour ce dépôt.');
  const f = await appel('/repos/' + S.depot + '/contents/etat/tableau.json?ref=main');
  if (f.status === 403) throw new Error('3/3 Le jeton voit le dépôt mais n\'a pas le droit « Contents » (en français « Sommaire » ou « Code ») : ouvrez le jeton sur GitHub, ajoutez « Contents » en « Lecture et écriture ».');
  if (f.status === 404) throw new Error('3/3 Le dépôt est accessible, mais etat/tableau.json est introuvable : le droit « Contents » est probablement absent du jeton.');
  if (!f.ok) throw new Error('3/3 Lecture impossible (code ' + f.status + ').');
}

async function lire(chemin) {
  const r = await fetch(adresse(chemin) + (LOCAL ? '' : '?ref=main'), { headers: entetes(), cache: 'no-store' });
  if (r.status === 404) return null;
  if (r.status === 401 || r.status === 403) throw new Error('GitHub refuse l\'accès : le jeton est expiré, ou il n\'a pas le droit de lire ce dépôt.');
  if (!r.ok) throw new Error(`Lecture impossible (code ${r.status}).`);
  return texteDe((await r.json()).content);
}

async function deposer(demande, patience) {
  if (S.occupe) throw new Error('Une demande est déjà en cours. Attendez sa réponse.');
  S.occupe = true;
  const id = Array.from(crypto.getRandomValues(new Uint8Array(9)), x => 'abcdefghijklmnopqrstuvwxyz0123456789'[x % 36]).join('');
  try {
    bandeau(patience || (LOCAL ? 'L\'équipe travaille…' : 'L\'équipe travaille. En ligne, comptez 30 à 60 secondes.'));
    const r = await fetch(adresse(`boite/demandes/${id}.json`), { method: 'PUT', headers: entetes(),
      body: JSON.stringify({ message: `Demande : ${demande.action}`, content: versB64(JSON.stringify(demande)), branch: 'main' }) });
    if (!r.ok) throw new Error(r.status === 403 || r.status === 401 ? 'GitHub refuse l\'écriture : vérifiez les droits du jeton.' : `Dépôt de la demande impossible (code ${r.status}).`);
    for (let essai = 0; essai < 75; essai++) {
      await new Promise(f => setTimeout(f, LOCAL ? 300 : 4000));
      const brut = await lire(`boite/reponses/${id}.json`);
      if (brut) {
        const rep = JSON.parse(brut);
        await charger();
        if (!rep.ok) throw new Error(rep.erreur || 'La demande a échoué.');
        bandeau('');
        return rep.resultat;
      }
    }
    throw new Error('Pas de réponse après 5 minutes. Regardez l\'onglet Actions du dépôt GitHub.');
  } finally { S.occupe = false; }
}

/* Visionneuse : la vidéo ou l'image est lue dans le dépôt privé avec le jeton, puis jouée depuis la mémoire du navigateur. */
const TYPES_MEDIA = { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
function fermerMedia() { if (S.media) URL.revokeObjectURL(S.media.url); S.media = null; }
async function voirMedia(d) {
  if (!/^medias\/[A-Za-z0-9_.\/-]+$/.test(d.chemin) || d.chemin.includes('..')) throw new Error('Chemin de média refusé.');
  bandeau('Chargement du fichier…');
  const r = await fetch(adresse(d.chemin) + (LOCAL ? '' : '?ref=main'), { headers: { ...entetes(), 'Accept': 'application/vnd.github.raw+json' }, cache: 'no-store' });
  if (!r.ok) throw new Error(`Fichier introuvable dans le dépôt (code ${r.status}). Lancez « python -m moteur.projets synchroniser » sur le PC puis envoyez les fichiers.`);
  const type = TYPES_MEDIA[d.chemin.split('.').pop().toLowerCase()] || 'application/octet-stream';
  const blob = new Blob([await r.arrayBuffer()], { type });
  fermerMedia();
  S.media = { titre: d.titre, type: d.type === 'video' ? 'video' : 'image', url: URL.createObjectURL(blob) };
  bandeau('');
  afficher();
  const v = $('vue').querySelector('.visionneuse'); if (v) v.scrollIntoView({ block: 'start' });
}

async function charger() {
  const brut = await lire('etat/tableau.json');
  if (!brut) throw new Error('Le fichier etat/tableau.json est introuvable dans le dépôt.');
  S.T = JSON.parse(brut);
  S.chargeLe = Date.now();
  afficher();
}

/* ---------- Petits éléments ---------- */
function bandeau(texte, genre) {
  const b = $('bandeau');
  b.hidden = !texte; b.textContent = texte || ''; b.className = 'bandeau' + (genre ? ' ' + genre : '');
}
const barre = (valeur, max) => `<div class="barre"><i data-largeur="${Math.min(100, max ? valeur / max * 100 : 0)}"></i></div>`;
const avatar = a => `<div class="avatar" data-couleur="${h(a.couleur)}" aria-hidden="true">${h(a.prenom[0])}</div>`;
const prospect = lien => S.T.prospects.find(p => p.lien_du_compte === lien) || {};
const fiche = lien => S.T.fiches[lien] || { conversation: [], relances: [] };
const quotaJour = () => { const j = S.T.quota.jours[new Date().toLocaleDateString('sv-SE')] || {}; return { total: j.total || 0, echecs: j.echecs || 0, par: j.par_modele || {} }; };
const court = m => String(m).replace(':free', '').split('/').pop();
function boutonsEnvoi(lien, zone, apres, libelle) {
  return `<div class="rang">
    <button class="btn primaire" data-a="copier-ouvrir" data-lien="${h(lien)}" data-zone="${zone}">Copier et ouvrir Instagram</button>
    <button class="btn" data-a="${apres}" data-lien="${h(lien)}">${libelle}</button></div>`;
}

/* ---------- Vues ---------- */
const VUES = {
  accueil() {
    const T = S.T, p = T.plan, q = quotaJour();
    const jours = Math.max(0, Math.ceil((new Date(T.objectif.echeance + 'T23:59:59') - new Date()) / 864e5));
    const brouillons = Object.values(T.fiches).filter(f => f.brouillon).length;
    const propositions = T.equipe.agents.filter(a => a.propositions).length;
    const taches = [
      [p.premiers_a_envoyer.length, 'premier(s) message(s) à envoyer', 'prospection'],
      [p.nouveaux_sans_message, 'prospect(s) sans message écrit', 'prospection'],
      [p.relances_dues.length, 'relance(s) à faire', 'prospection'],
      [brouillons, 'réponse(s) prête(s) à envoyer', 'prospection'],
      [T.kie.devis.filter(d => d.statut === 'en attente').length, 'devis Kie à accepter', 'commandes'],
      [propositions, 'agent(s) proposent des leçons à valider', 'equipe'],
    ].filter(t => t[0] > 0);
    return `
      <div class="bloc"><div class="rang espace"><h2>Objectif : ${nf(T.objectif.encaisse_eur)} € sur ${T.objectif.cible_eur} €</h2><span class="pastille">J-${jours}</span></div>
        ${barre(T.objectif.encaisse_eur, T.objectif.cible_eur)}</div>
      <div class="bloc"><h2>À faire par vous maintenant</h2>
        ${taches.length ? `<div class="carte"><ul class="liste">${taches.map(t => `<li><b>${t[0]}</b> ${t[1]} <button class="lien" data-a="aller" data-vue="${t[2]}">ouvrir</button></li>`).join('')}</ul></div>`
          : vide('Rien n\'attend votre décision. Ajoutez des prospects dans l\'onglet Prospection pour lancer la journée.')}</div>
      ${propositions ? `<div class="bloc"><h2>Auto-amélioration : leçons à valider</h2>
        <p class="muted">Chaque jour, les agents relisent leurs résultats et proposent des leçons. Rien n'est appliqué sans votre accord.</p>
        ${T.equipe.agents.filter(a => a.propositions).map(a => `<div class="carte"><h3>${h(nomAgent(a.id))}</h3>
          <p class="texte-message">${h(a.propositions)}</p>
          <div class="rang"><button class="btn primaire" data-a="adopter" data-agent="${h(a.id)}">Accepter</button><button class="btn" data-a="refuser" data-agent="${h(a.id)}">Refuser</button></div></div>`).join('')}</div>` : ''}
      ${(T.chef || []).length ? (() => { const c = T.chef[T.chef.length - 1]; const pm = Array.isArray(c.pour_mathis) ? c.pour_mathis : (c.pour_mathis ? [c.pour_mathis] : []);
        return `<div class="bloc"><h2>Max, chef de projet</h2><div class="carte"><p class="muted">Dernier passage : ${h((c.date || '').replace('T', ' '))} · actions : ${h((c.faites || []).join(', ') || 'aucune')}</p>
        <p>${h(c.rapport || '')}</p>${pm.length ? `<h3>Pour vous</h3><ul class="liste">${pm.map(x => `<li>${h(x)}</li>`).join('')}</ul>` : ''}</div></div>`; })() : ''}
      <div class="chiffres">
        ${[['Prospects', T.prospects.length], ['Envoyés aujourd\'hui', p.envoyes_aujourdhui.premiers + p.envoyes_aujourdhui.relances],
           ['En discussion', T.prospects.filter(x => x.statut === 'en discussion').length], ['Clients', T.prospects.filter(x => x.statut === 'client').length],
           ['Requêtes du jour', `${q.total} / ${T.quota.limite}`]].map(c => `<div class="chiffre"><span class="etiquette">${c[0]}</span><b>${c[1]}</b></div>`).join('')}
      </div>
      <div class="bloc"><h2>Activité récente de l'équipe</h2>
        ${T.journal_agents.length ? `<div class="defile"><table><thead><tr><th>Quand</th><th>Agent</th><th>Résultat</th><th>Modèle</th><th>Durée</th></tr></thead><tbody>
          ${T.journal_agents.slice(-10).reverse().map(j => `<tr><td class="n">${h((j.date || '').replace('T', ' ').slice(5, 16))}</td><td>${h(nomAgent(j.agent))}</td>
          <td><span class="pastille ${j.ok ? 'ok' : 'danger'}">${j.ok ? (j.discussion ? 'discussion' : 'tâche faite') : 'échec'}</span></td>
          <td class="n">${h(court(j.modele || ''))}</td><td class="n">${j.duree ? h(j.duree) + ' s' : ''}</td></tr>`).join('')}</tbody></table></div>`
          : vide('Le travail des agents apparaîtra ici.')}</div>`;
  },

  prospection() {
    const T = S.T, p = T.plan, lim = T.limites;
    const attente = Math.max(0, p.attente_avant_prochain_envoi_s - Math.round((Date.now() - S.chargeLe) / 1000));
    const enCours = T.prospects.filter(x => ['envoyé', 'en discussion'].includes(x.statut));
    return `
      <div class="chiffres">
        <div class="chiffre"><span class="etiquette">Premiers messages</span><b>${p.envoyes_aujourdhui.premiers} / ${p.quota_premiers_du_jour}</b></div>
        <div class="chiffre"><span class="etiquette">Relances du jour</span><b>${p.envoyes_aujourdhui.relances}</b></div>
        <div class="chiffre"><span class="etiquette">Contacts restants</span><b>${p.reste_total}</b></div>
        <div class="chiffre"><span class="etiquette">Prochain envoi</span><b id="minuteur" data-fin="${Date.now() + attente * 1000}">${attente ? '' : 'possible'}</b></div>
      </div>
      <p class="muted">Protection du compte : ${p.quota_premiers_du_jour} premiers messages par jour pour l'instant (${lim.plafond_premiers_messages} au plus), ${Math.round(lim.delai_minimum_entre_envois_s / 60)} minutes entre deux envois, de ${lim.heures_autorisees[0]} h à ${lim.heures_autorisees[1]} h. Deux relances au plus, plus rien après un refus. C'est vous qui envoyez chaque message.</p>

      <div class="bloc"><div class="rang espace"><h2>Premiers messages à envoyer</h2>
        ${p.nouveaux_sans_message ? `<button class="btn" data-a="ecrire-premiers">Faire écrire ${Math.min(p.nouveaux_sans_message, p.reste_premiers)} message(s) par Sacha</button>` : ''}</div>
        ${p.premiers_a_envoyer.length ? `<div class="grille">${p.premiers_a_envoyer.map((lien, i) => { const x = prospect(lien), f = fiche(lien); return `
          <article class="carte bon"><div class="rang espace"><h3>${h(x.nom)}</h3><span class="pastille">${h(x.ville)}</span></div>
            <a href="${h(lienSur(lien))}" target="_blank" rel="noopener noreferrer">${h(lien)}</a>
            <textarea id="premier-${i}" aria-label="Message pour ${h(x.nom)}">${h(f.premier_message ? f.premier_message.texte : '')}</textarea>
            <div class="rang"><span class="pastille">angle : ${h(x.angle)}</span><button class="lien" data-a="garder" data-quoi="premier" data-lien="${h(lien)}" data-zone="premier-${i}">Enregistrer ma version</button></div>
            ${boutonsEnvoi(lien, `premier-${i}`, 'envoye', 'J\'ai envoyé')}</article>`; }).join('')}</div>`
          : vide(p.nouveaux_sans_message ? 'Des prospects attendent leur message : lancez Sacha avec le bouton ci-dessus (une requête par message).' : 'Aucun message à envoyer. Ajoutez des prospects plus bas.')}</div>

      <div class="bloc"><h2>Relances</h2>
        ${p.relances_dues.length ? `<div class="grille">${p.relances_dues.map((r, i) => { const x = prospect(r.lien), prete = fiche(r.lien).relances.filter(z => !z.envoye_le).pop(); return `
          <article class="carte bon"><div class="rang espace"><h3>${h(x.nom)}</h3><span class="pastille attente">relance ${r.numero} sur 2</span></div>
            <a href="${h(lienSur(r.lien))}" target="_blank" rel="noopener noreferrer">${h(r.lien)}</a>
            ${prete ? `<textarea id="relance-${i}">${h(prete.texte)}</textarea>
              <button class="lien" data-a="garder" data-quoi="relance" data-lien="${h(r.lien)}" data-zone="relance-${i}">Enregistrer ma version</button>
              ${boutonsEnvoi(r.lien, `relance-${i}`, 'relance-envoyee', 'Relance envoyée')}`
              : `<p class="muted">Sans réponse depuis le ${h(x.dernier_contact)}.</p><button class="btn" data-a="ecrire-relance" data-lien="${h(r.lien)}">Faire écrire la relance par Rémi</button>`}
          </article>`; }).join('')}</div>` : vide('Aucune relance due aujourd\'hui. La première relance arrive 4 jours après un message resté sans réponse.')}</div>

      <div class="bloc"><h2>Conversations</h2>
        ${enCours.length ? `<div class="grille">${enCours.map((x, i) => { const f = fiche(x.lien_du_compte), lien = x.lien_du_compte; return `
          <article class="carte"><div class="rang espace"><h3>${h(x.nom)}</h3><span class="pastille ${x.statut === 'en discussion' ? 'ok' : ''}">${h(x.statut)}</span></div>
            <a href="${h(lienSur(lien))}" target="_blank" rel="noopener noreferrer">${h(lien)}</a>
            <div class="fil">${f.conversation.slice(-4).map(m => `<div class="bulle ${m.de === 'nous' ? 'moi' : ''}">${h(m.texte)}</div>`).join('')}</div>
            ${f.brouillon ? `<p class="etiquette">Réponse préparée par Léa · ${h(f.brouillon.intention)} · suite : ${h(String(f.brouillon.prochaine_etape).replace(/_/g, ' '))}</p>
              <textarea id="brouillon-${i}">${h(f.brouillon.texte)}</textarea>
              <button class="lien" data-a="garder" data-quoi="brouillon" data-lien="${h(lien)}" data-zone="brouillon-${i}">Enregistrer ma version</button>
              ${boutonsEnvoi(lien, `brouillon-${i}`, 'reponse-envoyee', 'Réponse envoyée')}`
              : `<label for="recu-${i}">Il a répondu ? Collez son message ici</label><textarea id="recu-${i}"></textarea>
                 <button class="btn" data-a="repondre" data-lien="${h(lien)}" data-zone="recu-${i}">Faire préparer la réponse par Léa</button>`}
            <div class="rang"><button class="btn discret" data-a="client" data-lien="${h(lien)}">Devenu client</button>
              <button class="btn discret" data-a="clore" data-lien="${h(lien)}">Il a refusé</button>
              <button class="btn discret" data-a="stop" data-lien="${h(lien)}">Ne plus contacter</button></div>
          </article>`; }).join('')}</div>` : vide('Les prospects contactés apparaîtront ici. Quand l\'un répond, collez son message : Léa prépare la réponse.')}</div>

      <div class="deux">
        <form class="carte" id="form-prospect"><h2>Ajouter un prospect</h2>
          <label for="np-nom">Nom de la marque</label><input id="np-nom" required maxlength="80">
          <label for="np-ville">Ville de l'atelier (ou « en ligne »)</label><input id="np-ville" maxlength="60">
          <label for="np-lien">Lien du profil Instagram ou TikTok</label><input id="np-lien" required placeholder="https://www.instagram.com/…">
          <label for="np-vu">Ce que vous avez vu sur son compte (une bougie précise, ce qui manque en vidéo)</label><textarea id="np-vu" maxlength="300"></textarea>
          <button class="btn primaire" type="submit">Ajouter</button></form>
        <div class="bloc"><h2>Tous les prospects</h2>
          ${T.prospects.length ? `<div class="defile"><table><thead><tr><th>Marque</th><th>Ville</th><th>Statut</th><th>Relances</th></tr></thead><tbody>
            ${T.prospects.slice().reverse().map(x => `<tr><td>${h(x.nom)}</td><td>${h(x.ville)}</td><td><span class="pastille ${x.statut === 'client' ? 'ok' : ['refus', 'ne plus contacter'].includes(x.statut) ? 'danger' : ''}">${h(x.statut)}</span></td><td class="n">${h(x.relances || 0)}</td></tr>`).join('')}
          </tbody></table></div>` : vide('La liste est vide.')}</div>
      </div>`;
  },

  equipe() {
    const T = S.T, ouvert = T.equipe.agents.find(a => a.id === S.agent);
    const carte = a => `<article class="carte"><div class="agent-tete">${avatar(a)}<div><h3>${h(a.prenom)}</h3><p class="muted">${h(a.metier)}</p></div></div>
      <div class="rang"><span class="pastille">${['libre', 'groq', 'openrouter'].includes(a.execution) ? ({ groq: 'Groq', nvidia: 'NVIDIA', gemini: 'Gemini' }[String(a.modeles[0]).split(':')[0]] || 'gratuit') + ' · ' + h(court(String(a.modeles[0]).replace(/^(groq|nvidia|gemini):/, ''))) : 'dans Claude Code'}</span>
        ${a.resultats.reussi ? `<span class="pastille ok">${a.resultats.reussi} réussi(s)</span>` : ''}${a.resultats.corrige ? `<span class="pastille attente">${a.resultats.corrige} corrigé(s)</span>` : ''}
        ${a.resultats.rate ? `<span class="pastille danger">${a.resultats.rate} raté(s)</span>` : ''}${a.propositions ? '<span class="pastille attente">leçons à valider</span>' : ''}</div>
      <button class="btn" data-a="ouvrir-agent" data-agent="${h(a.id)}">${a.execution === 'openrouter' ? 'Lui parler' : 'Voir sa fiche'}</button></article>`;
    const panneau = a => { const fil = S.fils[a.id] || []; return `
      <div class="carte" id="panneau-agent"><div class="rang espace"><div class="agent-tete">${avatar(a)}<div><h2>${h(a.prenom)}</h2><p class="muted">${h(a.metier)} · pôle ${h(a.pole)}</p></div></div>
          <button class="btn discret" data-a="fermer-agent">Fermer</button></div>
        ${a.execution === 'openrouter' ? `
          <div class="fil" id="fil">${fil.length ? fil.map(m => `<div class="bulle ${m.de === 'mathis' ? 'moi' : ''}">${h(m.texte)}</div>`).join('') : `<p class="muted">Posez une question à ${h(a.prenom)} sur son travail. Chaque message consomme une requête gratuite.</p>`}</div>
          <form id="form-parler" class="rang"><input id="dire" aria-label="Votre message" maxlength="1500" required><button class="btn primaire" type="submit">Envoyer</button></form>`
          : `<p class="muted">${h(a.prenom)} travaille dans Claude Code, avec votre abonnement. Pour lui parler, ouvrez Claude Code dans le dossier du projet.</p>`}
        <div class="deux">
          <div class="bloc"><h3>Leçons retenues</h3>${a.lecons.length ? `<ul class="liste">${a.lecons.map(l => `<li>${h(l)}</li>`).join('')}</ul>` : '<p class="muted">Aucune pour l\'instant.</p>'}
            ${a.propositions ? `<h3>Leçons proposées, à valider</h3><p class="texte-message">${h(a.propositions)}</p>
              <div class="rang"><button class="btn primaire" data-a="adopter" data-agent="${h(a.id)}">Adopter</button><button class="btn" data-a="refuser" data-agent="${h(a.id)}">Refuser</button></div>`
              : (a.execution === 'openrouter' ? `<button class="btn" data-a="proposer" data-agent="${h(a.id)}">Lui demander de proposer des leçons</button>` : '')}</div>
          <div class="bloc"><h3>Derniers résultats</h3>${a.derniers_resultats.length ? `<ul class="liste">${a.derniers_resultats.slice().reverse().map(r => `<li><span class="pastille ${r.resultat === 'reussi' ? 'ok' : r.resultat === 'rate' ? 'danger' : 'attente'}">${h(r.resultat)}</span> ${h(r.detail)}</li>`).join('')}</ul>` : '<p class="muted">Aucun résultat noté.</p>'}
            <form id="form-noter" class="bloc"><label for="note-detail">Noter son travail</label><input id="note-detail" maxlength="400" placeholder="Ce qui était bien, ou ce qu'il faut corriger" required>
              <div class="rang"><button class="btn" name="r" value="reussi">Réussi</button><button class="btn" name="r" value="corrige">À corriger</button><button class="btn" name="r" value="rate">Raté</button></div></form></div>
        </div></div>`; };
    return `${ouvert ? panneau(ouvert) : ''}
      ${Object.keys(T.equipe.poles).map(pole => { const liste = T.equipe.agents.filter(a => a.pole === pole); return liste.length ? `
        <div class="bloc"><div class="pole-titre"><span class="etiquette">Pôle ${h(pole)}</span></div><div class="grille">${liste.map(carte).join('')}</div></div>` : ''; }).join('')}`;
  },

  commandes() {
    const K = S.T.kie;
    return `
      <p class="muted">Marius tient les commandes et prépare les devis Kie. Aucun crédit n'est dépensé sans votre accord. L'accord et la génération se font pour l'instant dans Claude Code ; ils arriveront dans cette page.</p>
      <div class="bloc"><h2>Devis Kie</h2>
        ${K.devis.length ? `<div class="defile"><table><thead><tr><th>Commande</th><th>Type</th><th>Détail</th><th>Dépensé / devis</th><th>État</th></tr></thead><tbody>
          ${K.devis.map(d => `<tr><td>${h(d.brief)}</td><td>${h(d.type)}</td><td>${d.lignes.map(l => `${h(l.modele)} × ${nf(l.quantite)}`).join('<br>')}</td>
          <td class="n">${nf(d.depense)} / ${nf(d.total)} crédits</td><td><span class="pastille ${d.statut === 'approuvé' ? 'ok' : 'attente'}">${h(d.statut)}</span></td></tr>`).join('')}</tbody></table></div>` : vide('Aucun devis.')}</div>
      <div class="deux">
        <div class="bloc"><h2>Générations</h2>
          ${K.journal.length ? `<div class="defile"><table><thead><tr><th>Date</th><th>Commande</th><th>Modèle</th><th>Estimé</th><th>Réel</th></tr></thead><tbody>
            ${K.journal.slice().reverse().map(j => `<tr><td class="n">${h((j.date || '').slice(0, 10))}</td><td>${h(j.brief)}</td><td class="n">${h(j.modele)}</td><td class="n">${h(j.credits_estimes)}</td><td class="n">${h(j.credits_reels)}</td></tr>`).join('')}</tbody></table></div>` : vide('Aucune génération.')}</div>
        <div class="bloc"><h2>Modèles Kie autorisés</h2>
          <div class="defile"><table><thead><tr><th>Modèle</th><th>Type</th><th>Prix</th><th>Vérifié</th></tr></thead><tbody>
            ${K.modeles.map(m => `<tr><td class="n">${h(m.nom)}${m.nom === K.modele_image ? ' <span class="pastille ok">par défaut</span>' : ''}</td><td>${h(m.type)}</td><td class="n">${nf(m.prix)} cr. / ${h(m.unite)}</td><td>${m.verifie ? 'oui' : 'non'}</td></tr>`).join('')}</tbody></table></div>
          <p class="muted">Plafond du mois : ${nf(K.plafond_mensuel)} crédits. Par commande : ${Object.entries(K.plafonds).map(e => `${h(e[0])} ${e[1]}`).join(', ')}.</p></div>
      </div>`;
  },

  projets() {
    const R = S.T.projets || { projets: [], etapes: [], alertes: [] }, F = S.filtre || 'tous';
    const NOM = { brief: 'Brief', images: 'Images', clips: 'Clips', montage: 'Montage', controle: 'Contrôle', valide: 'Validée', livre: 'Livrée' };
    const CAT = { client: 'Client', portfolio: 'Portfolio', vitrine: 'Vitrine' };
    const actifs = R.projets.filter(p => p.statut !== 'archivé'), archives = R.projets.filter(p => p.statut === 'archivé');
    const garde = p => F === 'tous' ? p.statut !== 'archivé' : F === 'archives' ? p.statut === 'archivé' : p.categorie === F && p.statut !== 'archivé';
    const carte = p => {
      const i = R.etapes.indexOf(p.etape), c = p.constat || {}, k = p.kie || {};
      const al = R.alertes.filter(x => x.projet === p.id);
      return `<article class="carte projet ${al.length ? 'alerte' : ''}">
        <div class="rang espace"><h3>${h(p.titre)}</h3><span class="pastille ${p.categorie === 'client' ? 'ok' : ''}">${h(CAT[p.categorie] || p.categorie)}</span></div>
        <p class="muted">${p.categorie === 'client' ? 'Client : <b>' + h(p.client || 'à renseigner') + '</b>' : p.categorie === 'portfolio' ? 'Exemple fictif, jamais envoyé comme travail réel' : 'Compte @clipandcroc.fr'}</p>
        <ol class="etapes">${R.etapes.map((e, n) => `<li class="${n < i ? 'fait' : n === i ? 'actuel' : ''}">${h(NOM[e] || e)}</li>`).join('')}</ol>
        <div class="faits">
          <span>Images <b>${nf(c.images)}</b></span><span>Clips <b>${nf(c.clips)}</b></span>
          <span>Vidéo finale <b>${c.livrable_present ? 'oui' : 'non'}</b></span>
          <span>Kie <b>${nf(k.depense)} / ${nf(k.devis)}</b> cr.</span>
          <span>Validée par vous <b class="${p.validee_par_mathis === 'oui' ? 'vert' : ''}">${p.validee_par_mathis === 'oui' ? 'oui' : 'non'}</b></span>
          <span>Envoyée <b>${h(p.envoye_le || 'non')}</b></span></div>
        ${(p.medias || []).length ? `<div class="medias"><span class="etiquette">Voir</span>${p.medias.map(m => `<button class="btn ${m.type === 'video' ? 'primaire' : ''}" data-a="voir-media" data-chemin="${h(m.chemin)}" data-titre="${h(p.titre + ' : ' + m.titre)}" data-type="${h(m.type)}">${m.type === 'video' ? '&#9654; ' : ''}${h(m.titre)}</button>`).join('')}</div>` : ''}
        <p class="mono chemin">${h(p.dossier)}<br>${h(p.brief)}${p.livrable ? '<br>' + h(p.livrable) : ''}</p>
        ${p.notes ? `<p class="muted">${h(p.notes)}</p>` : ''}
        ${al.map(x => `<p class="erreur">${h(x.texte)}</p>`).join('')}</article>`;
    };
    const clients = [...new Set(actifs.filter(p => p.categorie === 'client').map(p => p.client || '—'))].sort();
    const groupe = (titre, liste) => liste.length ? `<div class="bloc"><h2>${h(titre)} <span class="muted">(${liste.length})</span></h2><div class="grille">${liste.map(carte).join('')}</div></div>` : '';
    const vus = R.projets.filter(garde);
    let corps;
    if (F === 'tous') {
      corps = (clients.length ? clients.map(c => groupe('Client : ' + c, vus.filter(p => p.categorie === 'client' && (p.client || '—') === c))).join('')
              : `<div class="vide">Aucun projet client pour l'instant. Chaque client aura son propre dossier <span class="mono">livrables/&lt;client&gt;/</span> : ses vidéos ne seront jamais mélangées avec celles d'un autre.</div>`)
        + groupe('Portfolio', vus.filter(p => p.categorie === 'portfolio')) + groupe('Vitrine du compte', vus.filter(p => p.categorie === 'vitrine'));
    } else corps = vus.length ? `<div class="grille">${vus.map(carte).join('')}</div>` : vide('Aucun projet dans cette catégorie.');
    const bouton = (f, nom, n) => `<button class="btn ${F === f ? 'primaire' : ''}" data-a="filtre-projets" data-f="${f}">${nom} (${n})</button>`;
    const visionneuse = S.media ? `<div class="carte visionneuse"><div class="rang espace"><h3>${h(S.media.titre)}</h3><button class="btn" data-a="fermer-media">Fermer</button></div>
        ${S.media.type === 'video' ? `<video controls playsinline autoplay src="${h(S.media.url)}"></video>` : `<img alt="${h(S.media.titre)}" src="${h(S.media.url)}">`}</div>` : '';
    return `
      ${visionneuse}
      <div class="chiffres">
        ${[['Projets actifs', actifs.length], ['Clients', actifs.filter(p => p.categorie === 'client').length], ['Portfolio', actifs.filter(p => p.categorie === 'portfolio').length],
           ['Vitrine', actifs.filter(p => p.categorie === 'vitrine').length], ['Alertes', R.alertes.length]].map(c => `<div class="chiffre"><span class="etiquette">${c[0]}</span><b>${c[1]}</b></div>`).join('')}
      </div>
      ${R.alertes.length ? `<div class="bloc"><h2>Alertes</h2><div class="carte alerte">${R.alertes.map(x => `<p class="erreur">${h(x.texte)}</p>`).join('')}</div></div>` : ''}
      <div class="rang">${bouton('tous', 'Tous', actifs.length)}${bouton('client', 'Clients', actifs.filter(p => p.categorie === 'client').length)}${bouton('portfolio', 'Portfolio', actifs.filter(p => p.categorie === 'portfolio').length)}${bouton('vitrine', 'Vitrine', actifs.filter(p => p.categorie === 'vitrine').length)}${bouton('archives', 'Archivés', archives.length)}</div>
      ${corps}
      <div class="carte"><h3>Règles contre les erreurs</h3><ul class="liste">
        <li>Un projet = un dossier, un brief, un client. Deux projets ne partagent jamais un dossier.</li>
        <li>Une vidéo client ne passe en « Validée » qu'après votre accord, et en « Livrée » qu'avec la date d'envoi.</li>
        <li>Le portfolio est fictif : il n'est jamais présenté comme le travail d'une vraie marque.</li>
        <li>Toute incohérence apparaît dans les alertes ci-dessus.</li></ul></div>`;
  },

  compta() {
    const C = S.T.compta, somme = t => C.filter(x => x.type === t).reduce((s, x) => s + Number(x.montant_eur || 0), 0);
    return `
      <div class="chiffres"><div class="chiffre"><span class="etiquette">Recettes</span><b>${nf(somme('recette'))} €</b></div>
        <div class="chiffre"><span class="etiquette">Dépenses</span><b>${nf(somme('depense'))} €</b></div>
        <div class="chiffre"><span class="etiquette">Résultat</span><b>${nf(somme('recette') - somme('depense'))} €</b></div></div>
      <div class="bloc"><h2>Écritures</h2>
        ${C.length ? `<div class="defile"><table><thead><tr><th>Date</th><th>Libellé</th><th>Client</th><th>Type</th><th>Montant</th><th>Pièce</th></tr></thead><tbody>
          ${C.slice().reverse().map(x => `<tr><td class="n">${h(x.date)}</td><td>${h(x.libelle)}</td><td>${h(x.client)}</td><td>${h(x.type)}</td><td class="n">${nf(x.montant_eur)} €</td><td class="n">${h(x.piece)}</td></tr>`).join('')}</tbody></table></div>`
          : vide('Aucune écriture. Colette enregistrera chaque paiement reçu et chaque dépense, avec sa pièce.')}</div>
      <div class="carte"><h3>À vérifier avec un adulte</h3><ul class="liste">
        <li>L'encaissement se fait au nom d'un parent.</li><li>Une facture demande un statut légal, par exemple une micro-entreprise.</li>
        <li>Les revenus se déclarent. Colette classe et alerte ; elle ne remplace pas un comptable.</li></ul></div>`;
  },

  modeles() {
    const T = S.T, q = quotaJour(), jours = Object.entries(T.quota.jours).reverse();
    return `
      <div class="bloc"><div class="rang espace"><h2>Requêtes gratuites aujourd'hui : ${q.total} sur ${T.quota.limite}</h2>${q.echecs ? `<span class="pastille attente">${q.echecs} échec(s) comptés</span>` : ''}</div>
        ${barre(q.total, T.quota.limite)}
        <p class="muted">Offre gratuite d'OpenRouter : ${T.quota.limite} requêtes par jour pour toute l'équipe. Les ${T.quota.reserve} dernières sont gardées en réserve. Une tâche d'agent ou un message de discussion compte pour une requête.</p></div>
      <div class="deux">
        <div class="bloc"><h2>Modèles en service</h2><div class="defile"><table><thead><tr><th>Agent</th><th>Modèle principal</th><th>Secours</th></tr></thead><tbody>
          ${T.equipe.agents.map(a => `<tr><td>${h(a.prenom)}</td><td class="n">${h(court(a.modeles[0]))}</td><td class="n">${a.modeles.slice(1).map(m => h(court(m))).join(', ') || (a.execution === 'openrouter' ? '' : 'abonnement Claude')}</td></tr>`).join('')}</tbody></table></div></div>
        <div class="bloc"><h2>Utilisation par jour</h2>
          ${jours.length ? `<div class="defile"><table><thead><tr><th>Jour</th><th>Requêtes</th><th>Échecs</th><th>Par modèle</th></tr></thead><tbody>
            ${jours.map(([j, v]) => `<tr><td class="n">${h(j)}</td><td class="n">${v.total}</td><td class="n">${v.echecs || 0}</td><td>${Object.entries(v.par_modele || {}).map(e => `${h(court(e[0]))} ${e[1]}`).join(', ')}</td></tr>`).join('')}</tbody></table></div>` : vide('Aucune requête enregistrée.')}</div>
      </div>`;
  },

  cles() {
    const T = S.T, secrets = LOCAL ? '' : `https://github.com/${S.depot}/settings/secrets/actions`;
    return `
      <div class="bloc"><h2>Clés utilisées par l'équipe</h2>
        <div class="defile"><table><thead><tr><th>Clé</th><th>Sert à</th><th>Où elle est rangée</th><th>Vue par les automates</th></tr></thead><tbody>
          <tr><td class="n">OPENROUTER_API_KEY</td><td>Les modèles gratuits des agents</td><td>Secrets du dépôt GitHub</td><td><span class="pastille ${T.cles.OPENROUTER_API_KEY ? 'ok' : 'danger'}">${T.cles.OPENROUTER_API_KEY ? 'oui' : 'non'}</span></td></tr>
          <tr><td class="n">GROQ_API_KEY</td><td>Les modèles gratuits de secours (environ 900 requêtes de plus par jour)</td><td>Secrets du dépôt GitHub et fichier .env du PC</td><td><span class="pastille ${T.cles.GROQ_API_KEY ? 'ok' : 'attente'}">${T.cles.GROQ_API_KEY ? 'oui' : 'pas encore'}</span></td></tr>
          <tr><td class="n">KIE_API_KEY</td><td>La génération d'images et de clips</td><td>Fichier .env du PC pour l'instant</td><td><span class="pastille">${T.cles.KIE_API_KEY ? 'oui' : 'pas encore'}</span></td></tr>
          <tr><td class="n">Jeton GitHub</td><td>L'accès de cette page au dépôt</td><td>Ce navigateur, chiffré par votre mot de passe</td><td><span class="pastille ok">${LOCAL ? 'inutile en local' : 'en service'}</span></td></tr>
        </tbody></table></div>
        <p class="muted">Aucune clé n'est affichée ni stockée dans cette page. ${secrets ? `Pour ajouter ou changer une clé : <a href="${h(secrets)}" target="_blank" rel="noopener noreferrer">secrets du dépôt</a>.` : ''}</p></div>
      ${LOCAL ? '' : `<div class="carte"><h3>Connecter une tablette ou un téléphone</h3>
        <p class="muted">Crée un lien qui contient votre accès, chiffré par votre mot de passe. Ouvrez-le sur l'autre appareil (copié, envoyé à vous-même ou passé par le câble USB dans un fichier) : il ne restera qu'à taper le mot de passe. Ne le partagez avec personne.</p>
        <div class="rang"><button class="btn primaire" data-a="lien-appareil">Créer le lien</button>${S.lien ? '<button class="btn" data-a="copier-lien">Copier le lien</button><button class="btn" data-a="fichier-lien">Enregistrer dans un fichier</button>' : ''}</div>
        ${S.lien ? `<textarea readonly rows="4" class="mono">${h(S.lien)}</textarea>` : ''}</div>`}
      ${LOCAL ? '' : `<div class="carte"><h3>Cet appareil</h3>
        <div class="rang"><button class="btn" data-a="verrouiller">Verrouiller maintenant</button><button class="btn" data-a="oublier">Oublier cet appareil</button></div>
        <p class="muted">La page se verrouille seule après 20 minutes sans activité. « Oublier cet appareil » efface le jeton chiffré de ce navigateur.</p></div>`}`;
  },
};
const nomAgent = id => (S.T.equipe.agents.find(a => a.id === id) || { prenom: id }).prenom;

function afficher() {
  if (!S.T) return;
  document.querySelectorAll('#onglets button').forEach(b => b.setAttribute('aria-selected', b.dataset.vue === S.vue));
  $('vue').innerHTML = VUES[S.vue]();
  document.querySelectorAll('[data-largeur]').forEach(e => { e.style.width = e.dataset.largeur + '%'; });
  document.querySelectorAll('[data-couleur]').forEach(e => { if (/^#[0-9a-fA-F]{6}$/.test(e.dataset.couleur)) e.style.background = e.dataset.couleur; });
  const q = quotaJour();
  $('etat-quota').textContent = `${q.total} / ${S.T.quota.limite} requêtes`;
  $('etat-quota').className = 'pastille ' + (q.total >= S.T.quota.limite - S.T.quota.reserve ? 'danger' : q.total > S.T.quota.limite * 0.6 ? 'attente' : '');
  $('pied').textContent = `Données du ${S.T.maj.replace('T', ' à ').slice(0, 19)}. ${LOCAL ? 'Version locale, sur ce PC.' : 'Version en ligne.'}`;
  const fil = $('fil'); if (fil) fil.scrollTop = fil.scrollHeight;
}

setInterval(() => {
  const m = $('minuteur'); if (!m) return;
  const reste = Math.round((Number(m.dataset.fin) - Date.now()) / 1000);
  m.textContent = reste > 0 ? `dans ${Math.floor(reste / 60)} min ${String(reste % 60).padStart(2, '0')} s` : 'possible';
}, 1000);

/* ---------- Actions ---------- */
async function faire(travail) {
  try { await travail(); } catch (e) { bandeau(e.message, 'erreur'); }
}
const zone = id => ($(id) ? $(id).value.trim() : '');

async function copierOuvrir(lien, idZone) {
  const texte = zone(idZone);
  if (!texte) return bandeau('Le message est vide.', 'erreur');
  const cible = lienSur(lien);
  try { await navigator.clipboard.writeText(texte); } catch { $(idZone).select(); return bandeau('Copie impossible : le texte est sélectionné, faites Ctrl+C.', 'erreur'); }
  if (cible) window.open(cible, '_blank', 'noopener,noreferrer');
  bandeau('Message copié. Collez-le dans la conversation Instagram, envoyez, puis revenez cliquer sur le bouton d\'à côté.', 'ok');
}

$('vue').addEventListener('click', e => {
  const b = e.target.closest('[data-a]'); if (!b) return;
  const a = b.dataset.a, lien = b.dataset.lien, agent = b.dataset.agent;
  const simple = { 'envoye': 'envoye', 'relance-envoyee': 'relance_envoyee', 'reponse-envoyee': 'reponse_envoyee', 'ecrire-relance': 'ecrire_relance', 'client': 'devenu_client' };
  if (a === 'aller') { S.vue = b.dataset.vue; location.hash = S.vue; return afficher(); }
  if (a === 'ouvrir-agent') { S.agent = agent; afficher(); return $('panneau-agent').scrollIntoView({ behavior: 'smooth' }); }
  if (a === 'fermer-agent') { S.agent = null; return afficher(); }
  if (a === 'voir-media') return faire(() => voirMedia(b.dataset));
  if (a === 'fermer-media') { fermerMedia(); return afficher(); }
  if (a === 'lien-appareil') {
    const c = localStorage.getItem(COFFRE);
    if (!c) return bandeau('Aucun accès enregistré sur cet appareil.', 'erreur');
    S.lien = location.origin + location.pathname + '#coffre=' + btoa(c).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return afficher();
  }
  if (a === 'copier-lien') return faire(async () => { await navigator.clipboard.writeText(S.lien); bandeau('Lien copié. Ouvrez-le sur la tablette.', 'ok'); });
  if (a === 'fichier-lien') {
    const url = URL.createObjectURL(new Blob(['Ouvrez ce lien sur la tablette, puis tapez votre mot de passe :\n\n' + S.lien + '\n'], { type: 'text/plain' }));
    const lienFichier = document.createElement('a'); lienFichier.href = url; lienFichier.download = 'connexion-clipandcroc.txt';
    document.body.appendChild(lienFichier); lienFichier.click(); lienFichier.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    return;
  }
  if (a === 'filtre-projets') { S.filtre = b.dataset.f; return afficher(); }
  if (a === 'verrouiller') return verrouiller();
  if (a === 'oublier') return oublier();
  if (a === 'copier-ouvrir') return faire(() => copierOuvrir(lien, b.dataset.zone));
  if (simple[a]) return faire(() => deposer({ action: simple[a], lien }));
  if (a === 'ecrire-premiers') return faire(() => deposer({ action: 'ecrire_premiers' }, 'Sacha écrit les messages. Comptez une minute.'));
  if (a === 'garder') return faire(async () => { await deposer({ action: 'modifier_message', lien, quoi: b.dataset.quoi, texte: zone(b.dataset.zone) }); bandeau('Votre version est enregistrée, et notée comme correction pour l\'agent.', 'ok'); });
  if (a === 'repondre') return faire(() => deposer({ action: 'repondre', lien, texte_du_prospect: zone(b.dataset.zone) }, 'Léa prépare la réponse…'));
  if (a === 'clore' || a === 'stop') {
    if (b.dataset.sur !== '1') { b.dataset.sur = '1'; b.textContent = 'Confirmer : c\'est définitif'; return; }
    return faire(() => deposer({ action: 'clore', lien, ne_plus_contacter: a === 'stop' }));
  }
  if (a === 'proposer') return faire(() => deposer({ action: 'proposer_lecons', agent }, 'L\'agent relit ses résultats…'));
  if (a === 'adopter') return faire(() => deposer({ action: 'adopter_lecons', agent }));
  if (a === 'refuser') return faire(() => deposer({ action: 'refuser_lecons', agent }));
});

$('vue').addEventListener('submit', e => {
  e.preventDefault();
  if (e.target.id === 'form-prospect') return faire(async () => {
    await deposer({ action: 'ajouter_prospect', nom: zone('np-nom'), ville: zone('np-ville'), lien: zone('np-lien'), ce_qui_manque: zone('np-vu') });
    bandeau('Prospect ajouté.', 'ok');
  });
  if (e.target.id === 'form-parler') return faire(async () => {
    const texte = zone('dire'), id = S.agent, fil = S.fils[id] = S.fils[id] || [];
    fil.push({ de: 'mathis', texte }); afficher();
    try { const r = await deposer({ action: 'discuter', agent: id, echanges: fil }, `${nomAgent(id)} réfléchit…`); fil.push({ de: 'agent', texte: r.texte }); }
    catch (err) { fil.pop(); throw err; }
    afficher();
  });
  if (e.target.id === 'form-noter') return faire(async () => {
    await deposer({ action: 'noter', agent: S.agent, resultat: e.submitter.value, detail: zone('note-detail') });
    bandeau('Résultat noté. Il servira aux prochaines leçons de l\'agent.', 'ok');
  });
});

$('onglets').addEventListener('click', e => { const b = e.target.closest('button[data-vue]'); if (b) { S.vue = b.dataset.vue; location.hash = S.vue; afficher(); } });
window.addEventListener('hashchange', () => { const v = location.hash.slice(1); if (VUES[v] && v !== S.vue) { S.vue = v; afficher(); } });
$('actualiser').addEventListener('click', () => faire(async () => { await charger(); bandeau('À jour.', 'ok'); }));
$('verrouiller').addEventListener('click', verrouiller);

/* ---------- Entrée, verrouillage ---------- */
function verrouiller() { S.jeton = null; S.T = null; S.fils = {}; $('appli').hidden = true; $('vue').innerHTML = ''; porte(); }
function oublier() { localStorage.removeItem(COFFRE); verrouiller(); }
function veiller() { clearTimeout(S.veille); if (!LOCAL) S.veille = setTimeout(verrouiller, 20 * 60 * 1000); }
['click', 'keydown'].forEach(ev => document.addEventListener(ev, veiller, { passive: true }));

async function entrer() {
  $('porte').hidden = true; $('appli').hidden = false; $('verrouiller').hidden = LOCAL;
  if (Object.keys(VUES).includes(location.hash.slice(1))) S.vue = location.hash.slice(1);
  veiller();
  await faire(charger);
}

/* Lien d'appareil : le coffre chiffré (dépôt + jeton chiffré par le mot de passe) voyage dans la partie « # » de l'adresse,
   qui n'est jamais envoyée au serveur. Sur la tablette, il ne reste qu'à taper le mot de passe. */
function importerLienAppareil() {
  if (!location.hash.startsWith('#coffre=')) return false;
  let ok = false;
  try {
    const brut = atob(location.hash.slice(8).replace(/-/g, '+').replace(/_/g, '/'));
    const c = JSON.parse(brut);
    if (c && c.depot && c.sel && c.iv && c.donnees) { localStorage.setItem(COFFRE, JSON.stringify(c)); ok = true; }
  } catch { ok = false; }
  history.replaceState(null, '', location.pathname);
  return ok;
}

function porte() {
  if (LOCAL) return entrer();
  const existe = !!localStorage.getItem(COFFRE);
  $('porte').hidden = false; $('form-ouvrir').hidden = !existe; $('form-installer').hidden = existe;
  if (S.nouvelAppareil) { $('info-ouvrir').textContent = 'Appareil ajouté. Tapez votre mot de passe habituel pour ouvrir la page.'; $('info-ouvrir').hidden = false; }
  ['mdp-ouvrir', 'jeton', 'mdp-nouveau', 'mdp-confirme'].forEach(i => { $(i).value = ''; });
}
const dire = (id, texte) => { $(id).textContent = texte; $(id).hidden = !texte; };

$('form-ouvrir').addEventListener('submit', async e => {
  e.preventDefault(); dire('erreur-ouvrir', '');
  try { Object.assign(S, await ouvrirCoffre($('mdp-ouvrir').value)); } catch { return dire('erreur-ouvrir', 'Mot de passe incorrect.'); }
  entrer();
});
$('oublier').addEventListener('click', oublier);
$('voir-jeton').addEventListener('click', () => { const j = $('jeton'); j.type = j.type === 'password' ? 'text' : 'password'; $('voir-jeton').textContent = j.type === 'password' ? 'Afficher le jeton' : 'Masquer le jeton'; });
$('form-installer').addEventListener('submit', async e => {
  e.preventDefault(); dire('erreur-installer', '');
  const depot = $('depot').value.trim(), jeton = $('jeton').value.trim(), mdp = $('mdp-nouveau').value;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(depot)) return dire('erreur-installer', 'Le dépôt s\'écrit compte/nom-du-dépôt.');
  if (mdp.length < 12) return dire('erreur-installer', 'Le mot de passe doit faire 12 caractères au moins.');
  if (mdp !== $('mdp-confirme').value) return dire('erreur-installer', 'Les deux mots de passe sont différents.');
  const jetonNet = jeton.replace(/[\s​-‍﻿]/g, '');
  if (!/^[A-Za-z0-9_]{20,}$/.test(jetonNet)) return dire('erreur-installer', 'Le jeton est vide ou contient des caractères étrangers (espace, retour à la ligne, guillemets). Recopiez-le en entier, sans rien autour. Il commence par github_pat_.');
  S.depot = depot; S.jeton = jetonNet;
  try { await diagnostiquer(); }
  catch (err) { S.jeton = null; return dire('erreur-installer', err.message); }
  await fermerCoffre(mdp, depot, jetonNet);
  entrer();
});

S.nouvelAppareil = importerLienAppareil();
porte();
