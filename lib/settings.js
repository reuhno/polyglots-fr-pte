// Accès aux réglages (chrome.storage.sync) et à l'état local (chrome.storage.local).
// `browser` existe sous Firefox, `chrome` sous Chrome ; les deux renvoient des promesses en MV3.

import { DEFAULT_SETTINGS, LIMITS } from './config.js';

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
  };
}

export async function getSettings() {
  const stored = await api.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
  return sanitizeSettings({ ...DEFAULT_SETTINGS, ...stored });
}

export async function saveSettings(settings) {
  const clean = sanitizeSettings(settings);
  await api.storage.sync.set(clean);
  return clean;
}

export async function resetSettings() {
  await api.storage.sync.clear();
  return getSettings();
}

export async function getLocal(keys) {
  return api.storage.local.get(keys);
}

export async function setLocal(obj) {
  return api.storage.local.set(obj);
}
