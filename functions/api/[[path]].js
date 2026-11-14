/* =========================================================================
   M4X Sourcing 2.0 — API (Cloudflare Pages Functions)
   Base D1 (binding DB) · fichiers R2 (binding FILES)
   Toutes les règles d'accès et de gratuité sont appliquées ICI, côté serveur.
   ========================================================================= */

const DAY = 864e5, MONTH = 30 * DAY, YEAR = 365 * DAY;
const SESSION_TTL = 30 * DAY;
const LAUNCH_DEF = { id: 'launch', trialOn: true, end: '2026-11-30', promoOn: true, promoEnd: '2026-12-15',
  candCap: 500, candMonths: 6, compCap: 50, compMonths: 4, offersFree: true };
const COLS = ['cands', 'comps', 'offers', 'links', 'msgs', 'pays', 'settings'];
const FILE_TYPES = {
  'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'text/plain': 'txt',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx'
};
const FILE_KINDS = ['cv', 'dc', 'kbis', 'vigilance', 'cabinet'];
const MAX_FILE = 20 * 1048576;

/* ---------------- utilitaires ---------------- */
const json = (d, s = 200, h = {}) => new Response(JSON.stringify(d), {
  status: s, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...h } });
const err = (s, msg) => json({ error: msg }, s);
const enc = new TextEncoder();
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const rand = (n = 16) => hex(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = async s => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
const now = () => Date.now();
const clean = (s, max = 500) => String(s ?? '').slice(0, max);
const isEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const validUrl = u => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) && /\.[a-z]{2,}$/i.test(x.hostname); } catch { return false; } };
function luhnSiret(s) { s = String(s).replace(/\s/g, ''); if (!/^\d{14}$/.test(s)) return false; let sum = 0;
  for (let i = 0; i < 14; i++) { let n = +s[13 - i]; if (i % 2) { n *= 2; if (n > 9) n -= 9; } sum += n; }
  return sum % 10 === 0 || s.startsWith('356000000'); }
const addMonths = (t, m) => { const d = new Date(t); d.setMonth(d.getMonth() + m); return d.getTime(); };

async function hashPw(pw, salt) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 100000 }, key, 256);
  return b64(bits);
}
function safeEq(a, b) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }
function cookie(req, name) { const m = (req.headers.get('cookie') || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)')); return m ? m[1] : null; }
const sessCookie = (tok, maxAge) => `sid=${tok}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

/* ---------------- accès base ---------------- */
async function allDocs(env, col) {
  const r = await env.DB.prepare('SELECT data FROM docs WHERE col=?').bind(col).all();
  return (r.results || []).map(x => JSON.parse(x.data));
}
async function getDoc(env, col, id) {
  const r = await env.DB.prepare('SELECT data FROM docs WHERE col=? AND id=?').bind(col, id).first();
  return r ? JSON.parse(r.data) : null;
}
async function putDoc(env, col, id, owner, data) {
  data.id = id;
  await env.DB.prepare('INSERT INTO docs(col,id,owner,data,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(col,id) DO UPDATE SET owner=excluded.owner,data=excluded.data,updated_at=excluded.updated_at')
    .bind(col, id, owner, JSON.stringify(data), now()).run();
  return data;
}
async function delDoc(env, col, id) { await env.DB.prepare('DELETE FROM docs WHERE col=? AND id=?').bind(col, id).run(); }

/* ---------------- session ---------------- */
async function currentUser(req, env) {
  const tok = cookie(req, 'sid'); if (!tok) return null;
  const th = await sha256(tok);
  const u = await env.DB.prepare('SELECT u.id,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires>?').bind(th, now()).first();
  if (!u) return null;
  const admins = String(env.ADMIN_EMAILS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  u.admin = u.role === 'admin' || admins.includes(u.email.toLowerCase());
  return u;
}
async function newSession(env, userId) {
  const tok = rand(32);
  await env.DB.prepare('INSERT INTO sessions(token_hash,user_id,expires) VALUES(?,?,?)').bind(await sha256(tok), userId, now() + SESSION_TTL).run();
  return tok;
}

/* ---------------- état métier (essai, promotion, abonnements) ---------------- */
async function loadState(env) {
  const [cands, comps, offers, links, settingsArr] = await Promise.all(['cands', 'comps', 'offers', 'links', 'settings'].map(c => allDocs(env, c)));
  const L = { ...LAUNCH_DEF, ...(settingsArr.find(s => s.id === 'launch') || {}) };
  const trialEnd = new Date(L.end + 'T23:59:59+01:00').getTime();
  const promoEnd = new Date(L.promoEnd + 'T23:59:59+01:00').getTime();
  const ranks = {};
  for (const g of [cands, comps]) g.filter(x => x.sub).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).forEach((x, i) => { ranks[x.id] = i + 1; });
  const cfg = g => g === 'cands' ? { cap: +L.candCap, months: +L.candMonths } : { cap: +L.compCap, months: +L.compMonths };
  const groupOf = x => x.id.startsWith('comp-') ? 'comps' : 'cands';
  const promo = x => {
    if (!x || !x.sub || !x.sub.trial || !L.promoOn) return null;
    const c = cfg(groupOf(x)), r = ranks[x.id];
    if (!r || r > c.cap || (x.createdAt || 0) > promoEnd) return null;
    return { rank: r, cap: c.cap, months: c.months, end: addMonths(x.createdAt, c.months) };
  };
  const subEnd = x => !x || !x.sub ? 0 : x.sub.trial ? Math.max(trialEnd, (promo(x) || {}).end || 0) : (x.sub.expiresAt || 0);
  const subOk = x => !!(x && x.sub && subEnd(x) > now());
  const count = g => (g === 'cands' ? cands : comps).filter(x => x.sub).length;
  const trialActive = () => !!L.trialOn && now() < trialEnd;
  const promoOpen = g => !!L.promoOn && now() <= promoEnd && count(g) < cfg(g).cap;
  const freeStart = g => trialActive() || promoOpen(g);
  const offerOn = o => o && o.active && o.expiresAt > now() && subOk(comps.find(c => c.id === o.compId));
  const isMatch = l => l && l.candLiked && l.compLiked;
  const decorate = x => ({ ...x, _subEnd: subEnd(x), _promo: promo(x) });
  return { L, cands, comps, offers, links, subEnd, subOk, promo, count, trialActive, freeStart, offerOn, isMatch, decorate };
}

/* ---------------- lecture filtrée selon les droits ---------------- */
async function readData(env, user) {
  const S = await loadState(env);
  const actC = S.cands.filter(S.subOk);
  const spec = {}; for (const c of actC) spec[c.primary] = (spec[c.primary] || 0) + 1;
  const out = { translate: !!env.DEEPL_API_KEY, settings: [S.L], stats: { cands: S.count('cands'), comps: S.count('comps'),
    activeCands: actC.length, activeComps: S.comps.filter(S.subOk).length, spec,
    offers: S.offers.filter(S.offerOn).length, matches: S.links.filter(S.isMatch).length } };
  if (!user) { Object.assign(out, { cands: [], comps: [], offers: [], links: [], msgs: [], pays: [] }); return out; }
  const myCand = S.cands.find(c => c.id === 'cand-' + user.id), myComp = S.comps.find(c => c.id === 'comp-' + user.id);
  if (user.admin) {
    const [msgs, pays] = await Promise.all([allDocs(env, 'msgs'), allDocs(env, 'pays')]);
    Object.assign(out, { cands: S.cands.map(S.decorate), comps: S.comps.map(S.decorate), offers: S.offers, links: S.links,
      msgs: msgs.filter(m => [myCand && myCand.id, myComp && myComp.id].some(id => id && m.linkId.includes(id))), pays,
      msgCount: msgs.length });
    return out;
  }
  const active = S.subOk(myCand) || S.subOk(myComp), compActive = S.subOk(myComp);
  const myLinks = S.links.filter(l => (myCand && l.candId === myCand.id) || (myComp && l.compId === myComp.id));
  const matchedWith = id => myLinks.some(l => S.isMatch(l) && (l.candId === id || l.compId === id));
  // candidats
  out.cands = [];
  if (myCand) out.cands.push(S.decorate(myCand));
  if (compActive) for (const c of S.cands) {
    if (c.id === (myCand && myCand.id) || !S.subOk(c)) continue;
    const m = matchedWith(c.id);
    const { email, phone, photo, consentAt, ...pub } = c;
    out.cands.push(S.decorate(m ? c : { ...pub, hasPhoto: !!photo }));
  }
  // entreprises
  out.comps = [];
  if (myComp) out.comps.push(S.decorate(myComp));
  if (active) for (const p of S.comps) {
    if (p.id === (myComp && myComp.id) || !S.subOk(p)) continue;
    const { docs, siret, email, contact, cgvAt, ...pub } = p;
    out.comps.push(S.decorate(matchedWith(p.id) ? { ...pub, email, contact } : pub));
  }
  // offres
  out.offers = S.offers.filter(o => (myComp && o.compId === myComp.id) || (active && S.offerOn(o)));
  out.links = myLinks;
  const msgs = await allDocs(env, 'msgs');
  const ids = new Set(myLinks.filter(S.isMatch).map(l => l.id));
  out.msgs = msgs.filter(m => ids.has(m.linkId));
  out.pays = (await allDocs(env, 'pays')).filter(p => p.ownerId === user.id);
  return out;
}

/* ---------------- écriture contrôlée ---------------- */
const strip = d => { const o = {}; for (const [k, v] of Object.entries(d || {})) if (!k.startsWith('_')) o[k] = v; return o; };

async function writeDoc(env, user, col, id, body) {
  if (!COLS.includes(col)) return err(400, 'Collection inconnue');
  const data = strip(body && body.data);
  const S = await loadState(env);
  const existing = await getDoc(env, col, id);
  const A = user.admin;

  if (col === 'settings') {
    if (!A || id !== 'launch') return err(403, 'Réservé à l\'administrateur');
    const L = { ...LAUNCH_DEF, ...existing, ...data, id: 'launch' };
    return json({ doc: await putDoc(env, col, id, user.id, L) });
  }
  if (col === 'pays') return err(403, 'Les paiements sont enregistrés par l\'administrateur');

  if (col === 'cands') {
    if (!A && id !== 'cand-' + user.id) return err(403, 'Profil d\'un autre utilisateur');
    const owner = existing ? existing.ownerId : user.id;
    const d = { ...data, ownerId: owner, createdAt: existing ? existing.createdAt : now() };
    if (!A || !('sub' in data)) d.sub = existing ? existing.sub : (S.freeStart('cands') ? { trial: true, startedAt: now() } : null);
    if (!clean(d.name).trim() || !isEmail(d.email || '')) return err(400, 'Nom et e-mail valides obligatoires');
    if (!d.primary) return err(400, 'Spécialité principale obligatoire');
    if (!d.consentAt) return err(400, 'Consentement obligatoire');
    if (!A && (!d.photo || !/^data:image\/(jpeg|png|webp);base64,/.test(d.photo) || d.photo.length > 400000)) return err(400, 'Photo portrait obligatoire');
    if (d.cvText) d.cvText = clean(d.cvText, 20000);
    for (const k of ['cvAsset', 'dcAsset']) if (d[k] && !(await ownsFile(env, user, d[k].id))) delete d[k];
    return json({ doc: S.decorate(await putDoc(env, col, id, owner, d)) });
  }

  if (col === 'comps') {
    if (!A && id !== 'comp-' + user.id) return err(403, 'Entreprise d\'un autre utilisateur');
    const owner = existing ? existing.ownerId : user.id;
    const d = { ...data, ownerId: owner, createdAt: existing ? existing.createdAt : now() };
    if (!A || !('sub' in data)) d.sub = existing ? existing.sub : (S.freeStart('comps') ? { trial: true, startedAt: now() } : null);
    if (!A) { d.verif = (data.verif === 'pending' || !existing) ? 'pending' : existing.verif; d.verifAt = existing && existing.verifAt; }
    if (!['ENT', 'EI', 'CAB'].includes(d.kind)) return err(400, 'Type de compte invalide');
    if (!clean(d.name).trim()) return err(400, 'Raison sociale obligatoire');
    if (!validUrl(d.website || '')) return err(400, 'Site internet obligatoire (https://…)');
    if ((d.country || 'France') === 'France' ? !luhnSiret(d.siret) : String(d.siret || '').trim().length < 4) return err(400, 'Numéro d\'immatriculation invalide');
    const docs = {};
    for (const [k, v] of Object.entries(d.docs || {})) if (['kbis', 'vigilance', 'cabinet'].includes(k) && v && v.id && (A || await ownsFile(env, user, v.id))) docs[k] = v;
    d.docs = docs;
    if (!docs.kbis) return err(400, 'Extrait d\'immatriculation obligatoire');
    if (d.kind === 'CAB' && !docs.cabinet) return err(400, 'Justificatif d\'activité de recrutement obligatoire');
    return json({ doc: S.decorate(await putDoc(env, col, id, owner, d)) });
  }

  if (col === 'offers') {
    const comp = S.comps.find(c => c.id === (existing ? existing.compId : data.compId));
    if (!comp) return err(400, 'Entreprise introuvable');
    if (!A && comp.id !== 'comp-' + user.id) return err(403, 'Offre d\'une autre entreprise');
    if (!A && !S.subOk(comp)) return err(402, 'Abonnement entreprise inactif');
    if (!A && comp.verif !== 'ok') return err(403, 'Justificatifs en cours de vérification');
    const free = S.trialActive() || S.L.offersFree;
    const d = { ...(existing || {}), ...data, compId: comp.id, ownerId: comp.ownerId };
    if (!d.attest) return err(400, 'Attestation de besoin réel obligatoire');
    if (!clean(d.title).trim() || !d.specialty || !(d.contract || []).length) return err(400, 'Offre incomplète');
    if (clean(d.description, 5000).trim().length < 80) return err(400, 'Description trop courte');
    if (!existing) {
      if (!free && !A) return err(402, 'Paiement en ligne bientôt disponible : contactez-nous pour publier.');
      Object.assign(d, { createdAt: now(), paidAt: now(), expiresAt: now() + MONTH, active: true, free });
    } else {
      d.createdAt = existing.createdAt;
      const republish = existing.expiresAt <= now() && data.expiresAt > now();
      if (republish) { if (!free && !A) return err(402, 'Paiement en ligne bientôt disponible : contactez-nous pour republier.'); d.expiresAt = now() + MONTH; d.paidAt = now(); d.active = true; }
      else d.expiresAt = existing.expiresAt;
    }
    return json({ doc: await putDoc(env, col, id, comp.ownerId, d) });
  }

  if (col === 'links') {
    const [candId, compId] = id.split('__');
    const cand = S.cands.find(c => c.id === candId), comp = S.comps.find(c => c.id === compId);
    if (!cand || !comp) return err(400, 'Profil ou entreprise introuvable');
    const d = { ...(existing || { candId, compId, createdAt: now() }), id };
    if (A && !['cand-' + user.id, 'comp-' + user.id].some(x => x === candId || x === compId)) return err(403, 'Action réservée aux parties');
    if (candId === 'cand-' + user.id) {
      if (!S.subOk(cand)) return err(402, 'Abonnement requis');
      if (!S.subOk(comp)) return err(400, 'Entreprise inactive');
      d.candLiked = true; d.candAt = d.candAt || now();
      if (data.offerId && !d.offerId) d.offerId = clean(data.offerId, 80);
    } else if (compId === 'comp-' + user.id) {
      if (!S.subOk(comp)) return err(402, 'Abonnement requis');
      if (!S.subOk(cand)) return err(400, 'Profil inactif');
      d.compLiked = true; d.compAt = d.compAt || now();
      if (data.offerId && !d.offerId) d.offerId = clean(data.offerId, 80);
    } else return err(403, 'Action réservée aux parties');
    return json({ doc: await putDoc(env, col, id, null, d) });
  }

  if (col === 'msgs') {
    if (existing) return err(409, 'Message déjà envoyé');
    const l = S.links.find(x => x.id === data.linkId);
    if (!l || !S.isMatch(l)) return err(403, 'Discussion non ouverte');
    let side;
    if (l.candId === 'cand-' + user.id) side = 'cand'; else if (l.compId === 'comp-' + user.id) side = 'comp'; else return err(403, 'Discussion d\'autres utilisateurs');
    const mine = side === 'cand' ? S.cands.find(c => c.id === l.candId) : S.comps.find(c => c.id === l.compId);
    if (!S.subOk(mine)) return err(402, 'Abonnement requis pour envoyer des messages');
    const text = clean(data.text, 4000).trim(); if (!text) return err(400, 'Message vide');
    return json({ doc: await putDoc(env, col, id, user.id, { id, linkId: l.id, side, authorId: user.id, text, at: now() }) });
  }
  return err(400, 'Écriture non autorisée');
}

async function deleteDoc(env, user, col, id) {
  const ex = await getDoc(env, col, id); if (!ex) return json({ ok: true });
  const mine = (col === 'cands' && id === 'cand-' + user.id) || (col === 'comps' && id === 'comp-' + user.id) || (col === 'offers' && ex.ownerId === user.id);
  if (!user.admin && !mine) return err(403, 'Suppression non autorisée');
  await delDoc(env, col, id);
  return json({ ok: true });
}

/* ---------------- fichiers (R2) ---------------- */
async function ownsFile(env, user, fid) { if (!fid) return false; const m = await getDoc(env, 'files', String(fid)); return !!(m && (m.owner === user.id || user.admin)); }

async function uploadFile(env, user, req) {
  const fd = await req.formData();
  const f = fd.get('file'), kind = String(fd.get('kind') || '');
  if (!f || typeof f === 'string') return err(400, 'Fichier manquant');
  if (!FILE_KINDS.includes(kind)) return err(400, 'Type de document inconnu');
  if (f.size > MAX_FILE) return err(413, 'Fichier trop lourd (20 Mo max)');
  const type = f.type || 'application/octet-stream';
  if (!FILE_TYPES[type]) return err(415, 'Format non accepté (PDF, Word, image ou texte)');
  const id = 'f' + rand(12);
  await env.FILES.put(id, await f.arrayBuffer(), { httpMetadata: { contentType: type } });
  const meta = { id, owner: user.id, kind, name: clean(f.name, 200), type, size: f.size, at: now() };
  await putDoc(env, 'files', id, user.id, meta);
  return json({ id, url: '/api/files/' + id, size: f.size, type, name: meta.name });
}

async function serveFile(env, user, fid) {
  const m = await getDoc(env, 'files', fid); if (!m) return err(404, 'Fichier introuvable');
  let ok = m.owner === user.id || user.admin;
  if (!ok && (m.kind === 'cv' || m.kind === 'dc')) {
    const S = await loadState(env);
    ok = S.subOk(S.comps.find(c => c.id === 'comp-' + user.id));   // CV complet : entreprises abonnées
  }
  if (!ok) return err(403, 'Accès réservé');
  const obj = await env.FILES.get(fid); if (!obj) return err(404, 'Fichier introuvable');
  return new Response(obj.body, { headers: { 'content-type': m.type, 'content-disposition': `inline; filename="${m.name.replace(/[^\w.\- ]/g, '_')}"`,
    'cache-control': 'private, max-age=300', 'x-content-type-options': 'nosniff' } });
}

/* ---------------- comptes ---------------- */
async function register(env, b) {
  const email = clean(b.email, 200).trim().toLowerCase(), pw = String(b.password || '');
  if (!isEmail(email)) return err(400, 'Adresse e-mail invalide');
  if (pw.length < 8) return err(400, 'Mot de passe : 8 caractères minimum');
  if (await env.DB.prepare('SELECT 1 FROM users WHERE email=?').bind(email).first()) return err(409, 'Un compte existe déjà avec cet e-mail');
  const id = 'u' + rand(8), salt = rand(16);
  await env.DB.prepare('INSERT INTO users(id,email,pass,salt,role,created_at) VALUES(?,?,?,?,?,?)').bind(id, email, await hashPw(pw, salt), salt, 'user', now()).run();
  const tok = await newSession(env, id);
  return json({ ok: true }, 200, { 'set-cookie': sessCookie(tok, SESSION_TTL / 1000) });
}
async function login(env, b) {
  const email = clean(b.email, 200).trim().toLowerCase(), pw = String(b.password || '');
  const u = await env.DB.prepare('SELECT * FROM users WHERE email=?').bind(email).first();
  if (!u) return err(401, 'E-mail ou mot de passe incorrect');
  if (u.lock_until > now()) return err(429, 'Trop de tentatives : réessayez dans quelques minutes');
  if (!safeEq(await hashPw(pw, u.salt), u.pass)) {
    const fails = u.fails + 1;
    await env.DB.prepare('UPDATE users SET fails=?, lock_until=? WHERE id=?').bind(fails >= 8 ? 0 : fails, fails >= 8 ? now() + 15 * 60e3 : 0, u.id).run();
    return err(401, 'E-mail ou mot de passe incorrect');
  }
  await env.DB.prepare('UPDATE users SET fails=0, lock_until=0 WHERE id=?').bind(u.id).run();
  const tok = await newSession(env, u.id);
  return json({ ok: true }, 200, { 'set-cookie': sessCookie(tok, SESSION_TTL / 1000) });
}
async function logout(env, req) {
  const tok = cookie(req, 'sid');
  if (tok) await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha256(tok)).run();
  return json({ ok: true }, 200, { 'set-cookie': sessCookie('', 0) });
}
async function changePw(env, user, b) {
  const u = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(user.id).first();
  if (!safeEq(await hashPw(String(b.current || ''), u.salt), u.pass)) return err(401, 'Mot de passe actuel incorrect');
  if (String(b.password || '').length < 8) return err(400, 'Nouveau mot de passe : 8 caractères minimum');
  const salt = rand(16);
  await env.DB.prepare('UPDATE users SET pass=?, salt=? WHERE id=?').bind(await hashPw(b.password, salt), salt, user.id).run();
  return json({ ok: true });
}
async function forgot(env, req, b) {
  const email = clean(b.email, 200).trim().toLowerCase();
  if (!env.RESEND_API_KEY) return json({ ok: true, manual: true });
  const u = await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(email).first();
  if (u) {
    const tok = rand(24);
    await env.DB.prepare('INSERT INTO resets(token_hash,user_id,expires) VALUES(?,?,?)').bind(await sha256(tok), u.id, now() + 3600e3).run();
    const link = new URL(req.url).origin + '/?reset=' + tok;
    await fetch('https://api.resend.com/emails', { method: 'POST', headers: { 'authorization': 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.MAIL_FROM || 'M4X Sourcing <onboarding@resend.dev>', to: [email], subject: 'M4X Sourcing — réinitialisation du mot de passe',
        html: `<p>Bonjour,</p><p>Pour choisir un nouveau mot de passe, cliquez sur ce lien (valable 1 heure) :</p><p><a href="${link}">${link}</a></p><p>Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.</p><p>M4X Sourcing 2.0</p>` }) });
  }
  return json({ ok: true });
}
async function resetPw(env, b) {
  const th = await sha256(String(b.token || ''));
  const r = await env.DB.prepare('SELECT * FROM resets WHERE token_hash=? AND expires>?').bind(th, now()).first();
  if (!r) return err(400, 'Lien expiré ou invalide');
  if (String(b.password || '').length < 8) return err(400, 'Mot de passe : 8 caractères minimum');
  const salt = rand(16);
  await env.DB.prepare('UPDATE users SET pass=?, salt=?, fails=0, lock_until=0 WHERE id=?').bind(await hashPw(b.password, salt), salt, r.user_id).run();
  await env.DB.prepare('DELETE FROM resets WHERE user_id=?').bind(r.user_id).run();
  await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(r.user_id).run();
  return json({ ok: true });
}
async function deleteAccount(env, req, user, b) {
  const u = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(user.id).first();
  if (!safeEq(await hashPw(String(b.password || ''), u.salt), u.pass)) return err(401, 'Mot de passe incorrect');
  const cid = 'cand-' + user.id, pid = 'comp-' + user.id;
  const files = await env.DB.prepare("SELECT id FROM docs WHERE col='files' AND owner=?").bind(user.id).all();
  for (const f of files.results || []) await env.FILES.delete(f.id);
  const links = (await allDocs(env, 'links')).filter(l => l.candId === cid || l.compId === pid);
  for (const l of links) { await delDoc(env, 'links', l.id); await env.DB.prepare("DELETE FROM docs WHERE col='msgs' AND json_extract(data,'$.linkId')=?").bind(l.id).run(); }
  await env.DB.prepare("DELETE FROM docs WHERE owner=? AND col IN ('cands','comps','offers','files','msgs')").bind(user.id).run();
  await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(user.id).run();
  await env.DB.prepare('DELETE FROM users WHERE id=?').bind(user.id).run();
  return json({ ok: true }, 200, { 'set-cookie': sessCookie('', 0) });
}

/* ---------------- traduction des messages (DeepL) ---------------- */
const DEEPL_TARGET = { fr: 'FR', en: 'EN-GB', es: 'ES', de: 'DE', it: 'IT', hi: 'HI' };
async function translateMsgs(env, user, b) {
  const key = env.DEEPL_API_KEY;
  if (!key) return err(503, 'Traduction non configurée');
  const lang = String(b.lang || '');
  const target = DEEPL_TARGET[lang]; if (!target) return err(400, 'Langue non prise en charge');
  const ids = Array.isArray(b.ids) ? b.ids.slice(0, 50).map(String) : [];
  // seuls les messages des discussions de l'utilisateur peuvent être traduits
  const S = await loadState(env);
  const mine = new Set(S.links.filter(l => S.isMatch(l) && (l.candId === 'cand-' + user.id || l.compId === 'comp-' + user.id)).map(l => l.id));
  const msgs = (await Promise.all(ids.map(id => getDoc(env, 'msgs', id)))).filter(m => m && mine.has(m.linkId));
  const out = {}, todo = [];
  for (const m of msgs) {
    const c = await getDoc(env, 'tr', lang + ':' + m.id);
    if (c) out[m.id] = c.t; else todo.push(m);
  }
  if (todo.length) {
    const host = key.trim().endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
    const r = await fetch(host + '/v2/translate', { method: 'POST',
      headers: { 'authorization': 'DeepL-Auth-Key ' + key.trim(), 'content-type': 'application/json' },
      body: JSON.stringify({ text: todo.map(m => m.text), target_lang: target, preserve_formatting: true }) });
    if (!r.ok) { console.error('DeepL', r.status, await r.text().catch(() => '')); return err(502, r.status === 403 ? 'Clé DeepL refusée' : r.status === 456 ? 'Quota DeepL atteint' : 'Traduction indisponible'); }
    const d = await r.json();
    for (let i = 0; i < todo.length; i++) {
      const t = d.translations && d.translations[i];
      const same = t && String(t.detected_source_language || '').slice(0, 2).toLowerCase() === lang;
      const text = t && !same ? t.text : todo[i].text;
      out[todo[i].id] = text;
      await putDoc(env, 'tr', lang + ':' + todo[i].id, null, { t: text, at: now() });
    }
  }
  return json({ tr: out });
}

/* ---------------- administration ---------------- */
async function adminGrant(env, user, b) {
  const col = b.col === 'comps' ? 'comps' : 'cands';
  const x = await getDoc(env, col, String(b.id || '')); if (!x) return err(404, 'Compte introuvable');
  const S = await loadState(env);
  const base = Math.max(now(), S.subEnd(x));
  const amount = Math.max(0, +b.amount || 0);
  x.sub = { paidAt: now(), expiresAt: base + YEAR, amount, manual: true };
  await putDoc(env, col, x.id, x.ownerId, x);
  if (amount) await putDoc(env, 'pays', 'pay' + rand(8), x.ownerId, { ownerId: x.ownerId, kind: col === 'cands' ? 'cand' : (x.kind === 'CAB' ? 'cab' : 'comp'), amount, label: 'Abonnement 1 an — ' + (x.name || ''), at: now() });
  return json({ ok: true });
}
async function adminUsers(env) {
  const r = await env.DB.prepare('SELECT id,email,role,created_at FROM users ORDER BY created_at DESC').all();
  return json({ users: r.results || [] });
}
async function adminResetPw(env, b) {
  const u = await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(clean(b.email, 200).trim().toLowerCase()).first();
  if (!u) return err(404, 'Utilisateur introuvable');
  const temp = rand(5), salt = rand(16);
  await env.DB.prepare('UPDATE users SET pass=?, salt=?, fails=0, lock_until=0 WHERE id=?').bind(await hashPw(temp, salt), salt, u.id).run();
  await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(u.id).run();
  return json({ ok: true, temp });
}

/* ---------------- routeur ---------------- */
export async function onRequest(context) {
  const { request: req, env } = context;
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const M = req.method;
  try {
    // protection CSRF : toute écriture doit venir du site (en-tête personnalisé → pré-vérification CORS bloquée ailleurs)
    if (M !== 'GET' && req.headers.get('x-m4x') !== '1') return err(403, 'Requête refusée');
    const body = (M === 'POST' || M === 'PUT' || M === 'DELETE') && (req.headers.get('content-type') || '').includes('application/json') ? await req.json().catch(() => ({})) : {};
    const user = await currentUser(req, env);
    const [a, b2, c3] = parts;

    if (a === 'auth') {
      if (b2 === 'me' && M === 'GET') return json({ user: user ? { id: user.id, email: user.email, admin: user.admin } : null });
      if (b2 === 'register' && M === 'POST') return register(env, body);
      if (b2 === 'login' && M === 'POST') return login(env, body);
      if (b2 === 'logout' && M === 'POST') return logout(env, req);
      if (b2 === 'forgot' && M === 'POST') return forgot(env, req, body);
      if (b2 === 'reset' && M === 'POST') return resetPw(env, body);
      if (!user) return err(401, 'Connexion requise');
      if (b2 === 'password' && M === 'POST') return changePw(env, user, body);
      if (b2 === 'account' && M === 'DELETE') return deleteAccount(env, req, user, body);
    }
    if (a === 'data' && M === 'GET') return json(await readData(env, user));
    if (!user) return err(401, 'Connexion requise');
    if (a === 'doc' && b2 && c3) {
      if (M === 'PUT') return writeDoc(env, user, b2, c3, body);
      if (M === 'DELETE') return deleteDoc(env, user, b2, c3);
    }
    if (a === 'translate' && M === 'POST') return translateMsgs(env, user, body);
    if (a === 'files') {
      if (M === 'POST' && !b2) return uploadFile(env, user, req);
      if (M === 'GET' && b2) return serveFile(env, user, b2);
    }
    if (a === 'admin') {
      if (!user.admin) return err(403, 'Réservé à l\'administrateur');
      if (b2 === 'grant' && M === 'POST') return adminGrant(env, user, body);
      if (b2 === 'users' && M === 'GET') return adminUsers(env);
      if (b2 === 'reset-password' && M === 'POST') return adminResetPw(env, body);
    }
    return err(404, 'Route inconnue');
  } catch (e) {
    console.error(e);
    return err(500, 'Erreur serveur');
  }
}
