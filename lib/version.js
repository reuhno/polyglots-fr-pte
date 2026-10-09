// Comparaison semver (sans dépendance) et lecture de la dernière release publiée.

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(v) {
  const m = SEMVER.exec(String(v).trim());
  if (!m) return null;
  return {
    core: [Number(m[1]), Number(m[2]), Number(m[3])],
    pre: m[4] ? m[4].split('.') : [],
  };
}

// -1 si a < b, 0 si égales, 1 si a > b. null si l'une n'est pas une version valide.
export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] < pb.core[i] ? -1 : 1;
  }
  // Une version sans suffixe est plus récente que la même avec suffixe (1.0.0 > 1.0.0-beta).
  if (!pa.pre.length && !pb.pre.length) return 0;
  if (!pa.pre.length) return 1;
  if (!pb.pre.length) return -1;
  const n = Math.max(pa.pre.length, pb.pre.length);
  for (let i = 0; i < n; i++) {
    const x = pa.pre[i];
    const y = pb.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) return Number(x) < Number(y) ? -1 : 1;
    if (xn) return -1;
    if (yn) return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

// Faut-il afficher la notification système « nouvelle version » ? Oui seulement si la dernière release publiée est plus
// récente que la version installée ET différente de la dernière version déjà notifiée (une notification par version).
// `update` : résultat de checkForUpdate ; un statut « error » ou « unavailable » ne notifie jamais.
export function shouldNotifyUpdate(update, notifiedVersion = null) {
  if (!update || update.status !== 'ok' || update.newer !== true || !update.latest) return false;
  return String(update.latest) !== String(notifiedVersion ?? '');
}

// Lit la dernière release publiée (API GitHub : « tag_name », préfixe « v » facultatif).
// 404 = pas encore de release. Ne lève jamais d'exception.
// Retourne { status: 'ok' | 'unavailable' | 'error', latest?, newer?, httpStatus?, message? }
export async function checkForUpdate({ url, localVersion, fetchFn = fetch }) {
  try {
    const res = await fetchFn(url, {
      cache: 'no-store',
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (res.status === 404) return { status: 'unavailable', httpStatus: 404 };
    if (!res.ok) return { status: 'error', httpStatus: res.status };
    let data;
    try {
      data = await res.json();
    } catch {
      return { status: 'error', message: 'Réponse de la release illisible' };
    }
    const tag = data && typeof data.tag_name === 'string' ? data.tag_name.trim() : '';
    const latest = tag.replace(/^v/i, '') || null;
    const cmp = latest ? compareVersions(latest, localVersion) : null;
    if (cmp === null) return { status: 'error', message: 'Version distante invalide' };
    return { status: 'ok', latest, newer: cmp > 0 };
  } catch (e) {
    return { status: 'error', message: String((e && e.message) || e) };
  }
}
