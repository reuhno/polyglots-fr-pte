// Arrière-plan : vérification périodique, badge, notifications, contrôle de version.
// Service worker sous Chrome, script d'arrière-plan (event page) sous Firefox.

import { api, getSettings, getLocal, setLocal, getIgnored, setIgnored } from './lib/settings.js';
import { isIgnored, pruneIgnored } from './lib/ignored.js';
import {
  findUnansweredRequests, findTeamReply, fetchComments, fetchStruckLine, normalizeTeam,
} from './lib/requests.js';
import { checkForUpdate, shouldNotifyUpdate } from './lib/version.js';
import * as Q from './lib/queue.js';
import {
  ALARM_CHECK, SITE_URL, RELEASES_URL, LATEST_RELEASE_API_URL, VERSION_CHECK_EVERY_MS, QUEUE, QUEUE_PAGE,
} from './lib/config.js';

// Plafond de sécurité : `notified` ne garde déjà que les demandes encore listées.
const MAX_NOTIFIED = 500;
let running = null;
let rerunRequested = false;

function errorText(e) {
  return String((e && e.message) || e);
}

// ---------- alarme ----------

async function ensureAlarm(intervalMinutes, { force = false } = {}) {
  const existing = await api.alarms.get(ALARM_CHECK);
  if (!force && existing && existing.periodInMinutes === intervalMinutes) return;
  await api.alarms.create(ALARM_CHECK, { delayInMinutes: 1, periodInMinutes: intervalMinutes });
}

// ---------- badge ----------

async function setBadge(count) {
  const text = count > 0 ? (count > 99 ? '99+' : String(count)) : '';
  await api.action.setBadgeText({ text });
  if (api.action.setBadgeBackgroundColor) {
    await api.action.setBadgeBackgroundColor({ color: '#b32d2e' });
  }
  if (api.action.setBadgeTextColor) {
    await api.action.setBadgeTextColor({ color: '#ffffff' }).catch(() => {});
  }
  await api.action.setTitle({
    title:
      count > 0
        ? `Polyglots FR : ${count} demande${count > 1 ? 's' : ''} sans réponse de l'équipe FR`
        : 'Polyglots FR : aucune demande en attente',
  });
}

// ---------- notifications ----------

function notify(id, title, message) {
  return api.notifications.create(id, {
    type: 'basic',
    iconUrl: api.runtime.getURL('icons/icon-128.png'),
    title,
    message,
  });
}

async function notifyNewRequests(requests, notifiedBefore, firstRun) {
  const fresh = requests.filter((r) => !notifiedBefore.has(r.id));
  if (!fresh.length) return;
  if (firstRun || fresh.length > 1) {
    const total = requests.length;
    await notify(
      'pfr-group',
      firstRun ? 'Polyglots FR : demandes en attente' : 'Polyglots FR : nouvelles demandes',
      firstRun
        ? `${total} demande${total > 1 ? 's' : ''} fr_FR sans réponse de l'équipe FR. Clique pour ouvrir la liste.`
        : `${fresh.length} nouvelles demandes sans réponse de l'équipe FR. Clique pour ouvrir la liste.`,
    );
  } else {
    const r = fresh[0];
    await notify(`pfr-req-${r.id}`, 'Polyglots FR : nouvelle demande', `${r.title}\npar @${r.authorSlug || '?'}`);
  }
}

api.notifications.onClicked.addListener(async (id) => {
  api.notifications.clear(id);
  if (id === 'pfr-update') {
    // Nouvelle version : page de téléchargement (traité avant le cas « notification groupée »).
    await api.tabs.create({ url: RELEASES_URL });
    return;
  }
  const m = /^pfr-req-(\d+)$/.exec(id);
  if (m) {
    const { state } = await getLocal('state');
    const req = state?.requests?.find((r) => String(r.id) === m[1]);
    await api.tabs.create({ url: req?.link || `${SITE_URL}/?p=${m[1]}` });
    return;
  }
  // Notification groupée : ouvrir la popup si le navigateur le permet, sinon la même page dans un onglet.
  try {
    await api.action.openPopup();
  } catch {
    await api.tabs.create({ url: api.runtime.getURL('popup/popup.html') });
  }
});

// ---------- vérification ----------

// `notify` : réglage « notifications » de l'utilisateur. Le bandeau de la popup ne dépend pas de lui ; la notification
// système « nouvelle version » en dépend, et ne part qu'une fois par version (`update.notifiedVersion`).
async function maybeCheckVersion(withNotification = true) {
  const { update } = await getLocal('update');
  const last = update?.checkedAt || 0;
  if (Date.now() - last < VERSION_CHECK_EVERY_MS) return;
  const localVersion = api.runtime.getManifest().version;
  const res = await checkForUpdate({ url: LATEST_RELEASE_API_URL, localVersion });
  // La dernière version notifiée survit à toutes les vérifications, même en échec.
  let notifiedVersion = update?.notifiedVersion ?? null;
  if (withNotification && shouldNotifyUpdate(res, notifiedVersion)) {
    try {
      await notifyUpdate(res.latest, localVersion);
      notifiedVersion = res.latest; // marquée seulement si la notification a bien été créée
    } catch { /* notification refusée par le système : sans importance, nouvel essai à la prochaine vérification */ }
  }
  await setLocal({ update: { ...res, localVersion, checkedAt: Date.now(), notifiedVersion } });
}

function notifyUpdate(latest, localVersion) {
  return notify(
    'pfr-update',
    `Polyglots FR : nouvelle version ${latest} disponible`,
    `Version installée : ${localVersion}. Clique pour ouvrir la page de téléchargement.`,
  );
}

async function doCheck({ withVersion = false } = {}) {
  const settings = await getSettings();
  const local = await getLocal(['notified', 'initialized', 'slugById', 'state']);
  const cache = { slugById: local.slugById || {} };
  try {
    const { requests, ignoredPosts, postIds, stats } = await findUnansweredRequests({
      team: settings.team,
      days: settings.windowDays,
      cache,
      ignored: settings.ignored,
    });
    const slim = requests.map(({ id, date, link, title, authorSlug, commentCount, uncertain }) => ({
      id, date, link, title, authorSlug, commentCount, uncertain,
    }));
    const notified = new Set(local.notified || []);
    if (settings.notify) {
      // Une notification refusée ne doit pas empêcher d'enregistrer l'état et le badge.
      try {
        await notifyNewRequests(slim, notified, !local.initialized);
      } catch { /* notification impossible : sans importance */ }
    }
    // On mémorise tout ce qui est visible, notification activée ou non, pour ne pas rafaler à la réactivation.
    // Seules les demandes encore listées sont gardées : une liste tronquée provoquerait des renotifications.
    // `visible` suit l'ordre de l'API (du plus récent au plus ancien) : on garde les premières, les plus récentes.
    const visible = slim.map((r) => r.id);
    await setLocal({
      initialized: true,
      notified: visible.slice(0, MAX_NOTIFIED),
      slugById: cache.slugById,
      state: {
        requests: slim,
        checkedAt: Date.now(),
        windowDays: settings.windowDays,
        totalPosts: stats.posts,
        struck: stats.struck, // demandes masquées parce que leur ligne de tâche fr_FR est barrée
        ignored: ignoredPosts.length, // demandes ignorées par l'utilisateur, encore dans la fenêtre
        ignoredList: ignoredPosts, // pour la section « Ignorées » de la popup
        error: null,
      },
    });
    await setBadge(slim.length);
    // Élagage de la liste des ignorées, seulement après une vérification réussie (la fenêtre est alors connue) :
    // les ids qui n'y sont plus n'ont plus d'utilité. La liste est relue juste avant, pour ne pas écraser un ajout récent.
    try {
      const current = postIds.length ? await getIgnored() : []; // fenêtre vide : rien n'est élagué (réponse suspecte)
      const pruned = pruneIgnored(current, postIds);
      if (pruned.length !== current.length) await setIgnored(pruned);
    } catch { /* sans importance : élagué à la prochaine vérification */ }
  } catch (e) {
    await setLocal({
      state: { ...(local.state || { requests: [] }), error: errorText(e), errorAt: Date.now() },
      slugById: cache.slugById,
    });
  }
  if (withVersion) {
    try { await maybeCheckVersion(settings.notify); } catch { /* sans importance */ }
  }
}

// Une seule vérification à la fois. Si les réglages (équipe, fenêtre) changent pendant qu'elle tourne,
// une relance est demandée : elle repart dès la fin de la vérification en cours, réglages relus.
function runCheck(opts) {
  if (!running) {
    running = (async () => {
      try {
        let o = opts;
        do {
          rerunRequested = false;
          await doCheck(o);
          o = undefined;
        } while (rerunRequested);
      } finally {
        running = null;
      }
    })();
  }
  return running;
}

function requestFreshCheck() {
  if (running) rerunRequested = true;
  else runCheck().catch(() => {});
}

// ---------- file de réponse ----------
// L'extension ouvre les demandes l'une après l'autre dans UN onglet de travail et prérempli la réponse ;
// le bénévole publie lui-même. Rien n'est jamais envoyé par l'extension.
// La session vit dans storage.local.queue (lib/queue.js). Toute lecture-modification-écriture passe par `inQueue`
// (une seule à la fois, sur le modèle de runCheck). Les requêtes réseau d'une vérification se font hors verrou,
// puis la session est relue : un message dont la session ou la demande n'est plus la courante est ignoré.

let queueChain = Promise.resolve();
function inQueue(fn) {
  const run = queueChain.then(fn);
  queueChain = run.then(() => {}, () => {});
  return run;
}

async function loadSession() {
  const { queue } = await getLocal('queue');
  return queue || null;
}

function saveSession(session) {
  return setLocal({ queue: session });
}

// À appeler sous verrou. Charge la session en tenant compte de la veille de la page de travail : un signal de vie de
// l'onglet de travail (`aliveTab`) efface l'échéance ; sinon, une échéance dépassée sans signal met la file en pause
// `noHello` (le minuteur peut avoir été perdu quand le service worker s'est endormi).
// `alive` : { tab, sessionId, postId } d'un message de la page ; il n'efface l'échéance que s'il est valide (bonne
// session, bonne demande, bon onglet) : le message d'une page qui s'en va ne doit pas la prolonger.
async function loadSessionChecked({ alive = null } = {}) {
  const s = await loadSession();
  if (!s) return s;
  const valid = !!alive && alive.tab != null && s.tabId === alive.tab && Q.isCurrent(s, alive.sessionId, alive.postId);
  const n = valid ? Q.setHelloDeadline(s, null) : Q.applyHelloDeadline(s, Date.now());
  if (n !== s) await saveSession(n);
  if (valid) noteAlive(alive.tab);
  return n;
}

// Le cache id d'auteur -> pseudo est partagé avec doCheck : on fusionne, on n'écrase pas.
// `mergeSlugCache` : à appeler sous verrou ; `saveSlugCache` : depuis l'extérieur du verrou (jamais sous verrou : blocage).
async function mergeSlugCache(cache) {
  const { slugById } = await getLocal('slugById');
  await setLocal({ slugById: { ...(slugById || {}), ...(cache.slugById || {}) } });
}

const saveSlugCache = (cache) => inQueue(() => mergeSlugCache(cache));

const senderTabId = (sender) => (sender && sender.tab ? sender.tab.id : null);

// Arrêt demandé (hors verrou) : la vérification réseau en cours sous verrou est coupée tout de suite
// (AbortController), et la boucle d'ouverture ne navigue plus. `queue:stop` conclut ensuite sous verrou.
let stopRequested = null; // id de la session dont l'arrêt est demandé
let openSession = null; // { id, controller } de l'openCurrentLocked en cours

// Veille « hello » : dès que l'onglet de travail commence à naviguer, la page doit se manifester (hello, ready ou
// check valides). Sinon l'onglet affiche autre chose qu'une demande (ou l'extension a été rechargée) : pause.
let helloWatch = null;

function clearHelloWatch() {
  if (helloWatch) clearTimeout(helloWatch.timer);
  helloWatch = null;
}

// Un message valide de l'onglet de travail prouve que sa page est vivante.
function noteAlive(tabId) {
  if (helloWatch && helloWatch.tabId === tabId) clearHelloWatch();
}

// Minuteur de la veille, en plus de l'échéance enregistrée dans la session (`helloDeadline`) : l'échéance, elle, survit
// à un service worker endormi et se vérifie à chaque événement (loadSessionChecked).
function armHelloWatch(tabId) {
  clearHelloWatch();
  const timer = setTimeout(() => {
    helloWatch = null;
    inQueue(async () => {
      const s = await loadSession();
      // Échéance toujours posée = aucun signal de vie reçu depuis (un signal l'efface).
      if (s && s.status === 'running' && s.tabId === tabId && s.helloDeadline) await saveSession(Q.pause(s, 'noHello'));
    }).catch(() => {});
  }, QUEUE.helloTimeoutMs);
  helloWatch = { tabId, timer };
}

// Début de navigation de l'onglet de travail : l'échéance est enregistrée et le minuteur armé.
function startHelloWatch(tabId) {
  armHelloWatch(tabId);
  return inQueue(async () => {
    const s = await loadSession();
    if (s && s.status === 'running' && s.tabId === tabId) {
      await saveSession(Q.setHelloDeadline(s, Date.now() + QUEUE.helloTimeoutMs));
    }
  });
}

// Fin (terminée ou arrêtée) : sauvegarde, onglet de travail renvoyé sur la page de la file (bilan), badge recalculé.
async function endLocked(session, { leaveTab = true } = {}) {
  clearHelloWatch();
  await saveSession(session);
  if (leaveTab && session.tabId != null) {
    try {
      await api.tabs.update(session.tabId, { url: api.runtime.getURL(QUEUE_PAGE), active: true });
    } catch { /* onglet disparu : sans importance */ }
  }
  requestFreshCheck();
  return session;
}

// Ouvre la demande courante dans l'onglet de travail. Avant chaque ouverture, vérification par l'API : si un membre
// de l'équipe y a déjà répondu, la demande est sautée (« déjà répondue ») sans être ouverte. Si l'API ne répond pas,
// la demande est ouverte quand même. Sauvegarde la session.
// Une demande déjà armée (ids connus relevés : reprise après une pause) suit la règle de `queueCheck` : auteur accepté =
// équipe + utilisateur connecté, seuls comptent les commentaires absents des ids connus. Seules les demandes jamais
// armées gardent la vérification préalable (équipe seule, n'importe quel commentaire).
async function openCurrentLocked(session, { leaveTab = true } = {}) {
  let s = session;
  const controller = new AbortController();
  openSession = { id: s.id, controller };
  const stopped = () => stopRequested === s.id;
  try {
    const settings = await getSettings();
    const local = await getLocal('slugById');
    const cache = { slugById: { ...(local.slugById || {}) } };
    while (s.status === 'running' && !stopped()) {
      const item = s.items[s.index];
      if (Q.isFinal(item.status)) {
        s = Q.advance(s);
        continue;
      }
      const armed = Array.isArray(item.knownIds);
      // Demande jamais armée : ignorée par l'utilisateur, ou ligne de tâche fr_FR barrée (par n'importe qui) = on la saute
      // (décision pure : Q.preCheckDecision). Échec réseau : on ouvre quand même.
      if (!armed) {
        const ignored = isIgnored(settings.ignored, item.id);
        let struck = null;
        if (!ignored) {
          try {
            struck = await fetchStruckLine(item.id, { signal: controller.signal });
          } catch { /* on continue avec la vérification des commentaires */ }
          if (stopped()) break;
        }
        const d = Q.preCheckDecision({ ignored, struck });
        if (d.skip) {
          s = Q.advance(Q.markItem(s, item.id, d.status, { by: d.by, note: d.note }));
          await saveSession(s);
          continue;
        }
      }
      let reply = null;
      try {
        reply = await findTeamReply({
          post: item.id,
          link: item.link,
          accept: armed ? normalizeTeam([...settings.team, ...(s.user ? [s.user] : [])]) : settings.team,
          knownCommentIds: armed ? item.knownIds : null,
          cache,
          signal: controller.signal,
        });
      } catch { /* API injoignable ou arrêt demandé : on ouvre la demande, la barre vérifiera */ }
      if (stopped() || !reply || !reply.found) break;
      // Armée : même règle que queueCheck (la date du commentaire trouvé date l'anti-flood) ; sinon vérification préalable.
      const verdict = armed ? Q.classifyReply(s.user, reply.by) : Q.preCheckDecision({ reply });
      s = Q.advance(Q.markItem(s, item.id, verdict.status, {
        by: verdict.by, note: verdict.note, publishedAt: reply.publishedAt,
      }));
      await saveSession(s);
    }
    await mergeSlugCache(cache);
  } finally {
    openSession = null;
  }
  if (s.status !== 'running') return endLocked(s, { leaveTab });
  if (stopped()) {
    // Pas de navigation : `queue:stop` conclut juste après, sous verrou.
    await saveSession(s);
    return s;
  }

  const item = s.items[s.index];
  const url = item.link || Q.fallbackLink(item.id);
  try {
    let tabId = s.tabId;
    if (tabId != null) {
      try {
        await api.tabs.update(tabId, { url, active: true });
      } catch { tabId = null; } // l'onglet n'existe plus
    }
    if (tabId == null) tabId = (await api.tabs.create({ url, active: true })).id;
    s = Q.setTab(s, tabId);
    // L'événement « loading » peut passer avant que tabId soit enregistré : on arme ici aussi (minuteur + échéance).
    armHelloWatch(tabId);
    s = Q.setHelloDeadline(s, Date.now() + QUEUE.helloTimeoutMs);
  } catch {
    s = Q.pause(s, 'tabError');
  }
  await saveSession(s);
  return s;
}

// Règle la demande courante (`status` : 'skipped', ou null pour « suivante » qui exige une demande déjà réglée),
// puis ouvre la suivante ou termine.
function settleCurrent(msg, fromTab, status) {
  return inQueue(async () => {
    let s = await loadSessionChecked();
    if (!Q.isCurrent(s, msg.sessionId, msg.postId) || fromTab !== s.tabId) return { ok: false, reason: 'stale' };
    const item = s.items[s.index];
    if (status) s = Q.markItem(s, item.id, status);
    else if (!Q.isFinal(item.status)) return { ok: false, reason: 'notDone' };
    s = Q.advance(s);
    if (s.status !== 'running') {
      await endLocked(s);
      return { ok: true, finished: true };
    }
    await openCurrentLocked(s);
    return { ok: true };
  });
}

// Confirmation d'une publication, par l'API (seule à décider). Le DOM de la page n'est qu'un déclencheur.
async function queueCheck(msg, fromTab) {
  // Signal de vie de l'onglet de travail : efface l'échéance de la veille (sous verrou, avec la lecture de la session).
  const s0 = await inQueue(() => loadSessionChecked({ alive: { tab: fromTab, sessionId: msg.sessionId, postId: msg.postId } }));
  if (!Q.isCurrent(s0, msg.sessionId, msg.postId) || fromTab !== s0.tabId) return { status: 'stale' };
  const item = s0.items[s0.index];
  if (Q.isFinal(item.status)) return { status: item.status, by: item.by, note: item.note }; // réponse perdue : on la redonne
  if (!item.knownIds) return { status: 'pending' }; // détection pas encore armée : tout commentaire paraîtrait « nouveau »

  const settings = await getSettings();
  // Auteur accepté : l'équipe, plus l'utilisateur connecté (lu dans la page, il n'est pas forcément de l'équipe).
  const accept = normalizeTeam([...settings.team, ...(s0.user ? [s0.user] : [])]);
  const local = await getLocal('slugById');
  const cache = { slugById: { ...(local.slugById || {}) } };
  let reply;
  try {
    reply = await findTeamReply({
      post: item.id,
      link: item.link,
      accept,
      knownCommentIds: item.knownIds,
      liveAuthors: msg.live || {},
      cache,
    });
  } catch (e) {
    // « failed » et non « error » : « error » est un statut de demande, que cette fonction peut aussi renvoyer (réponse perdue).
    return { status: 'failed', error: errorText(e) };
  }
  await saveSlugCache(cache);
  if (!reply.found) return { status: 'pending', unresolved: reply.unresolved.length };

  return inQueue(async () => {
    const s = await loadSession();
    if (!Q.isCurrent(s, msg.sessionId, msg.postId) || fromTab !== s.tabId) return { status: 'stale' };
    const cur = s.items[s.index];
    if (Q.isFinal(cur.status)) return { status: cur.status, by: cur.by, note: cur.note };
    // Pseudo connecté connu : le sien = publiée, un autre membre = déjà répondue. Non lu : compté comme publié, la note le dit.
    const v = Q.classifyReply(s.user, reply.by);
    // La date du commentaire trouvé date l'anti-flood ; inconnue, ce sera maintenant.
    await saveSession(Q.markItem(s, cur.id, v.status, { by: v.by, note: v.note, publishedAt: reply.publishedAt }));
    return { status: v.status, by: v.by, note: v.note };
  });
}

async function handleQueueMessage(msg, sender) {
  const fromTab = senderTabId(sender);
  switch (msg.type) {
    case 'queue:start':
      return inQueue(async () => {
        if (Q.isActive(await loadSessionChecked())) return { ok: false, error: 'Une file est déjà en cours.' };
        const { state } = await getLocal('state');
        const wanted = new Set((msg.ids || []).map(String));
        const requests = Q.sortRequests((state?.requests || []).filter((r) => wanted.has(String(r.id))));
        const s = Q.createSession(requests);
        if (!s) return { ok: false, error: 'Aucune demande sélectionnée.' };
        await saveSession(s);
        await openCurrentLocked(s);
        return { ok: true };
      });

    case 'queue:resume':
      return inQueue(async () => {
        let s = await loadSession();
        if (!s || s.id !== msg.sessionId || s.status !== 'paused') return { ok: false, error: 'Aucune file en pause.' };
        if (s.tabId != null) {
          try {
            await api.tabs.get(s.tabId);
          } catch { s = Q.setTab(s, null); } // onglet fermé : openCurrentLocked en crée un nouveau
        }
        s = Q.resume(s);
        if (s.status !== 'running') {
          await endLocked(s);
          return { ok: true };
        }
        await openCurrentLocked(s);
        return { ok: true };
      });

    case 'queue:stop':
      // Drapeau posé hors verrou : il coupe la vérification réseau en cours sous verrou, sans attendre son délai.
      stopRequested = msg.sessionId;
      if (openSession && openSession.id === msg.sessionId) openSession.controller.abort();
      return inQueue(async () => {
        try {
          const s = await loadSession();
          if (!s || s.id !== msg.sessionId || !Q.isActive(s)) return { ok: false, reason: 'stale' };
          await endLocked(Q.stop(s), { leaveTab: fromTab != null && fromTab === s.tabId });
          return { ok: true };
        } finally {
          if (stopRequested === msg.sessionId) stopRequested = null;
        }
      });

    case 'queue:hello':
      return inQueue(async () => {
        const s = await loadSession();
        if (!s || (msg.sessionId && msg.sessionId !== s.id)) return { active: false };
        if (s.status !== 'running' || fromTab == null || fromTab !== s.tabId) return { active: false };
        const item = s.items[s.index];
        if (String(item.id) !== String(msg.postId)) {
          // L'onglet de travail affiche une autre demande que la courante.
          clearHelloWatch();
          await saveSession(Q.pause(s, 'wrongPage'));
          return { active: false };
        }
        // Signal de vie : minuteur et échéance de la veille effacés.
        noteAlive(fromTab);
        const alive = Q.setHelloDeadline(s, null);
        if (alive !== s) await saveSession(alive);
        if (msg.light) return { active: true }; // signal de vie périodique du script de contenu
        return {
          active: true,
          sessionId: s.id,
          postId: item.id,
          index: s.index,
          total: s.items.length,
          author: item.author,
          itemStatus: item.status,
          note: item.note,
          lastPublishedAt: s.lastPublishedAt,
          cfg: QUEUE,
        };
      });

    case 'queue:ready':
      // Le script a prérempli et relevé les commentaires présents : la détection peut être armée.
      return (async () => {
        // Signal de vie (valide) : efface la veille. Lecture sous verrou, courte ; la requête réseau vient après, hors verrou.
        const s0 = await inQueue(() => loadSessionChecked({ alive: { tab: fromTab, sessionId: msg.sessionId, postId: msg.postId } }));
        if (!Q.isCurrent(s0, msg.sessionId, msg.postId) || fromTab !== s0.tabId) return { ok: false, reason: 'stale' };
        // Les ids du DOM peuvent être incomplets (rendu client en cours) : on y ajoute ceux de l'API. Requête hors
        // verrou (délai maximal 15 s) : elle ne bloque ni « Arrêter » ni les autres messages.
        let apiIds = [];
        if (!s0.items[s0.index].knownIds) {
          try {
            apiIds = (await fetchComments([s0.items[s0.index].id], fetch, { bust: Date.now() })).map((c) => String(c.id));
          } catch { /* les ids du DOM suffisent */ }
        }
        return inQueue(async () => {
          let s = await loadSession();
          if (!Q.isCurrent(s, msg.sessionId, msg.postId) || fromTab !== s.tabId) return { ok: false, reason: 'stale' };
          s = Q.setUser(s, msg.user ? String(msg.user) : null);
          s = Q.setKnownIds(s, s.items[s.index].id, [...(msg.ids || []), ...apiIds]); // sans effet si déjà relevés
          await saveSession(s);
          return { ok: true, known: s.items[s.index].knownIds };
        });
      })();

    case 'queue:check':
      return queueCheck(msg, fromTab);

    case 'queue:published': // « Marquer publiée » : le bénévole constate lui-même la publication, rien n'est envoyé
      return inQueue(async () => {
        const s = await loadSessionChecked();
        if (!Q.isCurrent(s, msg.sessionId, msg.postId) || fromTab !== s.tabId) return { ok: false, reason: 'stale' };
        // markItem date lastPublishedAt (anti-flood), comme pour une publication détectée.
        await saveSession(Q.markItem(s, msg.postId, 'published', { by: s.user || null, note: 'marquée publiée à la main' }));
        return { ok: true };
      });

    case 'queue:error': // la page ne permet pas de répondre (formulaire absent, pseudo introuvable, déconnexion)
      return inQueue(async () => {
        const s = await loadSessionChecked();
        if (!Q.isCurrent(s, msg.sessionId, msg.postId) || fromTab !== s.tabId) return { ok: false, reason: 'stale' };
        await saveSession(Q.markItem(s, msg.postId, 'error', { note: String(msg.message || 'erreur').slice(0, 300) }));
        return { ok: true };
      });

    case 'queue:status': // ouverture de la page de la file : évalue l'échéance de la veille (minuteur peut-être perdu)
      return inQueue(async () => {
        await loadSessionChecked();
        return { ok: true };
      });

    case 'queue:next':
      return settleCurrent(msg, fromTab, null);

    case 'queue:skip':
      return settleCurrent(msg, fromTab, 'skipped');

    default:
      return { ok: false, error: 'Message inconnu.' };
  }
}

// Le navigateur (ou l'extension) a redémarré : les ids d'onglets ne valent plus rien, la file attend « Reprendre ».
function pauseForRestart() {
  return inQueue(async () => {
    const s = await loadSession();
    if (!Q.isActive(s)) return;
    await saveSession(Q.setTab(Q.pause(s, 'restart'), null));
  });
}

api.tabs.onRemoved.addListener((tabId) => {
  inQueue(async () => {
    const s = await loadSessionChecked();
    if (!s || !Q.isActive(s) || s.tabId !== tabId) return;
    clearHelloWatch();
    await saveSession(Q.setTab(Q.pause(s, 'tabClosed'), null));
  }).catch(() => {});
});

// Début de navigation de l'onglet de travail : la veille démarre (le « hello » de la page l'arrête). Armer sur
// « complete » armait après coup quand le hello était déjà passé : pause fantôme.
api.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.status) return;
  // « loading » : début de navigation (veille armée si c'est l'onglet de travail). Dans tous les cas, l'événement
  // évalue l'échéance de la veille, au cas où le minuteur aurait été perdu avec le service worker.
  inQueue(async () => {
    const s = await loadSessionChecked();
    if (changeInfo.status === 'loading' && s && s.status === 'running' && s.tabId === tabId) {
      armHelloWatch(tabId);
      await saveSession(Q.setHelloDeadline(s, Date.now() + QUEUE.helloTimeoutMs));
    }
  }).catch(() => {});
});

// ---------- événements ----------

api.runtime.onInstalled.addListener(async () => {
  await pauseForRestart().catch(() => {});
  const s = await getSettings();
  await ensureAlarm(s.intervalMinutes, { force: true });
  await runCheck({ withVersion: true });
});

api.runtime.onStartup.addListener(async () => {
  await pauseForRestart().catch(() => {});
  const s = await getSettings();
  await ensureAlarm(s.intervalMinutes);
  await runCheck({ withVersion: true });
});

api.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_CHECK) runCheck({ withVersion: true });
});

api.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'sync') return;
  const s = await getSettings();
  if (changes.intervalMinutes) await ensureAlarm(s.intervalMinutes, { force: true });
  if (changes.team || changes.windowDays) requestFreshCheck();
});

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (typeof msg?.type === 'string' && msg.type.startsWith('queue:')) {
    // Le « hello » arrête la veille tout de suite, sans attendre le verrou de la file (ready et check : une fois validés).
    if (msg.type === 'queue:hello') noteAlive(senderTabId(sender));
    handleQueueMessage(msg, sender).then(sendResponse, (e) => sendResponse({ ok: false, error: errorText(e) }));
    return true;
  }
  if (msg?.type === 'getSettings') {
    getSettings()
      .then((s) => sendResponse({ template: s.template }))
      .catch((e) => sendResponse({ error: errorText(e) }));
    return true;
  }
  if (msg?.type === 'refresh') {
    // `fresh` (réglages modifiés, par exemple une demande ignorée) : si une vérification tourne déjà avec les anciens
    // réglages, elle est relancée à sa fin au lieu d'être simplement attendue.
    if (msg.fresh && running) rerunRequested = true;
    runCheck({ withVersion: true })
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: errorText(e) }));
    return true;
  }
  return false;
});

// Le service worker peut être réveillé sans événement d'installation : s'assurer que l'alarme existe.
getSettings().then((s) => ensureAlarm(s.intervalMinutes)).catch(() => {});
