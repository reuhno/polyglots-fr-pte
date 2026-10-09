// Arrière-plan : vérification périodique, badge, notifications, contrôle de version.
// Service worker sous Chrome, script d'arrière-plan (event page) sous Firefox.

import { api, getSettings, getLocal, setLocal } from './lib/settings.js';
import { findUnansweredRequests } from './lib/requests.js';
import { checkForUpdate } from './lib/version.js';
import {
  ALARM_CHECK, SITE_URL, LATEST_RELEASE_API_URL, VERSION_CHECK_EVERY_MS,
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

async function maybeCheckVersion() {
  const { update } = await getLocal('update');
  const last = update?.checkedAt || 0;
  if (Date.now() - last < VERSION_CHECK_EVERY_MS) return;
  const localVersion = api.runtime.getManifest().version;
  const res = await checkForUpdate({ url: LATEST_RELEASE_API_URL, localVersion });
  await setLocal({ update: { ...res, localVersion, checkedAt: Date.now() } });
}

async function doCheck({ withVersion = false } = {}) {
  const settings = await getSettings();
  const local = await getLocal(['notified', 'initialized', 'slugById', 'state']);
  const cache = { slugById: local.slugById || {} };
  try {
    const { requests, stats } = await findUnansweredRequests({
      team: settings.team,
      days: settings.windowDays,
      cache,
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
    const visible = slim.map((r) => r.id);
    await setLocal({
      initialized: true,
      notified: visible.slice(-MAX_NOTIFIED),
      slugById: cache.slugById,
      state: {
        requests: slim,
        checkedAt: Date.now(),
        windowDays: settings.windowDays,
        totalPosts: stats.posts,
        error: null,
      },
    });
    await setBadge(slim.length);
  } catch (e) {
    await setLocal({
      state: { ...(local.state || { requests: [] }), error: errorText(e), errorAt: Date.now() },
      slugById: cache.slugById,
    });
  }
  if (withVersion) {
    try { await maybeCheckVersion(); } catch { /* sans importance */ }
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

// ---------- événements ----------

api.runtime.onInstalled.addListener(async () => {
  const s = await getSettings();
  await ensureAlarm(s.intervalMinutes, { force: true });
  await runCheck({ withVersion: true });
});

api.runtime.onStartup.addListener(async () => {
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

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'getSettings') {
    getSettings()
      .then((s) => sendResponse({ template: s.template }))
      .catch((e) => sendResponse({ error: errorText(e) }));
    return true;
  }
  if (msg?.type === 'refresh') {
    runCheck({ withVersion: true })
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: errorText(e) }));
    return true;
  }
  return false;
});

// Le service worker peut être réveillé sans événement d'installation : s'assurer que l'alarme existe.
getSettings().then((s) => ensureAlarm(s.intervalMinutes)).catch(() => {});
