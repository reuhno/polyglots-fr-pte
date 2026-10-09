// File de réponse : machine d'états pure (aucune API d'extension, aucun DOM), testable sous Node.
// Toutes les fonctions retournent une nouvelle session ; si rien ne change, elles retournent
// la session reçue telle quelle (comparaison par `===` possible côté appelant).
//
// Une session : {
//   id, status: 'running' | 'paused' | 'finished' | 'stopped', pauseReason,
//   tabId, index (demande courante), user (pseudo connecté, relevé dans la page),
//   startedAt, finishedAt, lastPublishedAt,
//   items: [{ id, link, title, author, status, note, by, knownIds }]
// }
// Statuts d'une demande : pending, current, puis un statut final (published, skipped, alreadyAnswered, error).

import { SITE_URL } from './config.js';

export const FINAL_STATUSES = new Set(['published', 'skipped', 'alreadyAnswered', 'error']);

export const isFinal = (status) => FINAL_STATUSES.has(status);

// ---------- sélection ----------

// De la plus ancienne à la plus récente (les ex æquo restent dans l'ordre des ids).
export function sortRequests(requests) {
  return [...(requests || [])].sort((a, b) => {
    const d = new Date(a.date).getTime() - new Date(b.date).getTime();
    if (Number.isFinite(d) && d !== 0) return d;
    return Number(a.id) - Number(b.id);
  });
}

// Cochées par défaut : toutes, sauf celles « à vérifier » (un commentateur n'a pas pu être identifié).
export function defaultSelection(requests) {
  return new Set((requests || []).filter((r) => !r.uncertain).map((r) => r.id));
}

export function fallbackLink(id) {
  return `${SITE_URL}/?p=${id}`;
}

// ---------- cycle de vie ----------

function newSessionId(now) {
  return globalThis.crypto?.randomUUID?.() ?? `s${now}-${Math.random().toString(36).slice(2)}`;
}

const replaceItem = (session, index, patch) => ({
  ...session,
  items: session.items.map((it, i) => (i === index ? { ...it, ...patch } : it)),
});

// `requests` : demandes de `state.requests` (id, link, title, authorSlug), déjà dans l'ordre voulu.
// Chaque demande est copiée dans la session (l'état de surveillance peut changer pendant la file).
// Retourne null si la liste est vide.
export function createSession(requests, { now = Date.now(), id = newSessionId(now) } = {}) {
  const seen = new Set();
  const items = [];
  for (const r of requests || []) {
    if (r == null || r.id == null || seen.has(String(r.id))) continue;
    seen.add(String(r.id));
    items.push({
      id: r.id,
      link: r.link || fallbackLink(r.id),
      title: r.title || `Demande ${r.id}`,
      author: r.authorSlug || r.author || null,
      status: items.length === 0 ? 'current' : 'pending',
      note: null,
      by: null,
      knownIds: null,
    });
  }
  if (!items.length) return null;
  return {
    id,
    status: 'running',
    pauseReason: null,
    tabId: null,
    index: 0,
    user: null,
    startedAt: now,
    finishedAt: null,
    lastPublishedAt: null,
    helloDeadline: null, // échéance de la veille « la page doit se manifester » (survit à un service worker endormi)
    items,
  };
}

export const isActive = (session) => !!session && (session.status === 'running' || session.status === 'paused');

export function currentItem(session) {
  return isActive(session) ? session.items[session.index] || null : null;
}

// Garde « bonne session, bonne demande » : tout message de l'onglet de travail passe par elle.
export function isCurrent(session, sessionId, postId) {
  if (!session || session.status !== 'running' || session.id !== sessionId) return false;
  const it = session.items[session.index];
  return !!it && String(it.id) === String(postId);
}

// Règle la demande courante. Sans effet si `postId` n'est pas la demande courante ou si elle est déjà réglée
// (une double notification ne fait donc rien). Une publication date l'anti-flood : à la date du commentaire trouvé
// (`publishedAt`, en ms) s'il est connu et pas dans le futur, sinon à `now`.
export function markItem(session, postId, status, { now = Date.now(), note = null, by = null, publishedAt = null } = {}) {
  if (!isFinal(status)) throw new Error(`Statut final attendu : ${status}`);
  if (!isActive(session)) return session;
  const it = session.items[session.index];
  if (!it || String(it.id) !== String(postId) || isFinal(it.status)) return session;
  const next = replaceItem(session, session.index, { status, note, by });
  if (status !== 'published') return next;
  const known = Number.isFinite(publishedAt) && publishedAt > 0 && publishedAt <= now;
  return { ...next, lastPublishedAt: known ? publishedAt : now };
}

// Passe à la demande suivante, seulement si la courante est réglée : un second appel pour la même demande
// ne fait rien (la nouvelle courante n'est pas réglée). Après la dernière, la session est terminée.
export function advance(session, { now = Date.now() } = {}) {
  if (!session || session.status !== 'running') return session;
  const it = session.items[session.index];
  if (!it || !isFinal(it.status)) return session;
  const cleared = replaceItem(session, session.index, { knownIds: null });
  const nextIndex = session.index + 1;
  if (nextIndex >= session.items.length) {
    return { ...cleared, status: 'finished', pauseReason: null, finishedAt: now, helloDeadline: null };
  }
  return { ...replaceItem(cleared, nextIndex, { status: 'current' }), index: nextIndex, helloDeadline: null };
}

export function pause(session, reason) {
  if (!session || session.status !== 'running') return session;
  return { ...session, status: 'paused', pauseReason: reason || 'unknown', helloDeadline: null };
}

// Veille de la page de travail : l'échéance est enregistrée dans la session (un minuteur peut être perdu quand le
// service worker s'endort). Un signal de vie l'efface ; un événement qui la trouve dépassée met la file en pause.
export function setHelloDeadline(session, deadline) {
  if (!session || (session.helloDeadline ?? null) === deadline) return session;
  return { ...session, helloDeadline: deadline };
}

export function applyHelloDeadline(session, now = Date.now()) {
  if (!session || session.status !== 'running' || !session.helloDeadline || now <= session.helloDeadline) return session;
  return pause(session, 'noHello');
}

// Décision de la vérification préalable d'une demande jamais armée : la sauter (et pourquoi) ou l'ouvrir.
// - `ignored` : la demande est dans la liste des ignorées → statut « skipped », note « ignorée » ;
// - `struck` : { struck, by } de la ligne de tâche fr_FR → barrée par n'importe qui = traitée ;
// - `reply` : résultat de findTeamReply (un membre de l'équipe a déjà répondu).
// Retourne { skip: true, status, by, note } ou { skip: false }.
export function preCheckDecision({ ignored = false, struck = null, reply = null } = {}) {
  if (ignored) return { skip: true, status: 'skipped', by: null, note: 'ignorée' };
  if (struck && struck.struck) {
    const by = struck.by || null;
    return { skip: true, status: 'alreadyAnswered', by, note: by ? `ligne fr_FR barrée par @${by}` : 'ligne fr_FR barrée' };
  }
  if (reply && reply.found) {
    return { skip: true, status: 'alreadyAnswered', by: reply.by, note: `déjà répondue par @${reply.by}` };
  }
  return { skip: false };
}

// Reprise : si la demande courante était déjà réglée (pause entre deux demandes), on passe à la suivante.
export function resume(session, opts) {
  if (!session || session.status !== 'paused') return session;
  return advance({ ...session, status: 'running', pauseReason: null }, opts);
}

// Arrêt : la demande en cours, non réglée, redevient « à venir » (elle compte dans « non traitées »).
export function stop(session, { now = Date.now() } = {}) {
  if (!isActive(session)) return session;
  const items = session.items.map((it) => (it.status === 'current' ? { ...it, status: 'pending', knownIds: null } : it));
  return { ...session, items, status: 'stopped', pauseReason: null, finishedAt: now, helloDeadline: null };
}

export function setTab(session, tabId) {
  return session && session.tabId !== tabId ? { ...session, tabId } : session;
}

export function setUser(session, user) {
  return session && user && session.user !== user ? { ...session, user } : session;
}

// Ids des commentaires présents quand la détection a été armée. Écrits une seule fois par demande :
// une page rechargée après la publication ne doit pas faire oublier le commentaire publié.
export function setKnownIds(session, postId, ids) {
  if (!isActive(session)) return session;
  const it = session.items[session.index];
  if (!it || String(it.id) !== String(postId) || it.knownIds) return session;
  return replaceItem(session, session.index, { knownIds: [...new Set((ids || []).map(String))] });
}

// Classe un commentaire d'un auteur accepté, absent des ids connus à l'armement (donc nouveau depuis).
// - pseudo connecté connu : publication si c'est le sien, sinon « déjà répondue » (un autre membre de l'équipe) ;
// - pseudo connecté non lu : on ne peut pas distinguer, le commentaire est compté comme publié (auteur dans `by`),
//   et la note le dit.
export function classifyReply(user, by) {
  if (!user) {
    return { status: 'published', by, note: `pseudo connecté non lu : commentaire de @${by} compté comme publié` };
  }
  if (String(by).toLowerCase() === String(user).toLowerCase()) return { status: 'published', by, note: null };
  return { status: 'alreadyAnswered', by, note: `déjà répondue par @${by}` };
}

// ---------- lecture ----------

export function summary(session) {
  const count = (s) => (session ? session.items.filter((it) => it.status === s).length : 0);
  const total = session ? session.items.length : 0;
  const published = count('published');
  const skipped = count('skipped');
  const alreadyAnswered = count('alreadyAnswered');
  const error = count('error');
  const done = published + skipped + alreadyAnswered + error;
  return { total, published, skipped, alreadyAnswered, error, done, remaining: total - done };
}

// Millisecondes à attendre avant de publier à nouveau (0 si le délai est écoulé ou s'il n'y a pas eu de publication).
export function antiFloodWaitMs(lastPublishedAt, now, delayMs) {
  if (!lastPublishedAt) return 0;
  return Math.max(0, delayMs - (now - lastPublishedAt));
}
