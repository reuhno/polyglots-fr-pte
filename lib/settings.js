// Accès aux réglages (chrome.storage.sync) et à l'état local (chrome.storage.local).
// `browser` existe sous Firefox, `chrome` sous Chrome ; les deux renvoient des promesses en MV3.

import { DEFAULT_SETTINGS, LIMITS, SITE_URL } from './config.js';
import { sanitizeIgnored, addIgnored, removeIgnored } from './ignored.js';

export const api = globalThis.browser ?? globalThis.chrome;

function clampInt(value, { min, max }, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function sanitizeSettings(raw = {}) {
  const team = Array.isArray(raw.team)
    ? [...new Set(raw.team.map((s) => String(s).trim().replace(/^@/, '')).filter(Boolean))]
    : DEFAULT_SETTINGS.team;
  return {
    team,
    template:
      typeof raw.template === 'string' && raw.template.trim() ? raw.template : DEFAULT_SETTINGS.template,
    intervalMinutes: clampInt(raw.intervalMinutes, LIMITS.intervalMinutes, DEFAULT_SETTINGS.intervalMinutes),
    windowDays: clampInt(raw.windowDays, LIMITS.windowDays, DEFAULT_SETTINGS.windowDays),
    notify: typeof raw.notify === 'boolean' ? raw.notify : DEFAULT_SETTINGS.notify,
    ignored: sanitizeIgnored(raw.ignored),
  };
}

export async function getSettings() {
  const stored = await api.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
  return sanitizeSettings({ ...DEFAULT_SETTINGS, ...stored });
}

// Enregistre les réglages de l'écran d'options (jamais la liste des demandes ignorées, voir ci-dessous).
export async function saveSettings(settings) {
  const clean = sanitizeSettings(settings);
  // La liste des demandes ignorées n'est jamais écrite d'ici : toutes ses écritures passent par l'arrière-plan
  // (chaîne `inIgnored`, background.js), sinon deux lectures-modifications-écritures pourraient s'écraser.
  const { ignored: _ignored, ...toStore } = clean;
  await api.storage.sync.set(toStore);
  return clean;
}

// « Rétablir les valeurs par défaut » : retire les réglages de l'écran d'options, sans toucher aux demandes ignorées
// (ni les relire ni les réécrire).
export async function resetSettings() {
  await api.storage.sync.remove(Object.keys(DEFAULT_SETTINGS).filter((k) => k !== 'ignored'));
  return getSettings();
}

// ---------- demandes ignorées ----------

export async function getIgnored() {
  const { ignored } = await api.storage.sync.get('ignored');
  return sanitizeIgnored(ignored);
}

export async function setIgnored(list) {
  await api.storage.sync.set({ ignored: sanitizeIgnored(list) });
}

async function setBadgeCount(count) {
  try {
    await api.action.setBadgeText({ text: count > 0 ? (count > 99 ? '99+' : String(count)) : '' });
  } catch { /* le badge sera recalculé par la vérification complète */ }
}

// Ignore une demande : liste synchronisée, puis état local et badge mis à jour tout de suite (sans attendre la
// vérification complète que l'appelant demande ensuite à l'arrière-plan).
export async function ignoreRequest(request) {
  await setIgnored(addIgnored(await getIgnored(), request.id));
  const { state } = await getLocal('state');
  if (!state) return;
  const requests = (state.requests || []).filter((r) => r.id !== request.id);
  // `request` peut ne porter que l'id (ignorée depuis la page d'une demande) : le reste vient alors de l'état connu.
  const known = (state.requests || []).find((r) => r.id === request.id) || {};
  const entry = {
    id: request.id,
    date: request.date ?? known.date ?? null,
    link: request.link ?? known.link ?? `${SITE_URL}/?p=${request.id}`,
    title: request.title ?? known.title ?? `Demande ${request.id}`,
    authorSlug: request.authorSlug ?? known.authorSlug ?? null,
  };
  const ignoredList = [...(state.ignoredList || []).filter((r) => r.id !== request.id), entry];
  await setLocal({ state: { ...state, requests, ignoredList, ignored: ignoredList.length } });
  await setBadgeCount(requests.length);
}

// Rétablit une demande ignorée : elle reparaîtra à la vérification complète que l'appelant demande ensuite.
export async function restoreRequest(id) {
  await setIgnored(removeIgnored(await getIgnored(), id));
  const { state } = await getLocal('state');
  if (!state) return;
  const ignoredList = (state.ignoredList || []).filter((r) => r.id !== id);
  await setLocal({ state: { ...state, ignoredList, ignored: ignoredList.length } });
}

export async function getLocal(keys) {
  return api.storage.local.get(keys);
}

export async function setLocal(obj) {
  return api.storage.local.set(obj);
}
