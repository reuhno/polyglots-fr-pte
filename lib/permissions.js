// Permission d'hôte make.wordpress.org. Firefox traite les `host_permissions` d'une extension MV3 comme facultatives :
// l'utilisateur peut les refuser à l'installation ou les retirer dans about:addons → Permissions. Sans elles, les `fetch`
// vers make.wordpress.org échouent (CORS) avec « NetworkError when attempting to fetch resource ».
// Fonctions sans DOM (testables sous Node) ; la bannière avec son bouton est dans lib/permission-banner.js.

export const MISSING_TEXT =
  "L’extension n’a pas l’autorisation d’accéder à make.wordpress.org : sans elle, elle ne peut pas lister les demandes.";
export const NETWORK_HINT =
  "Vérifie qu’un bloqueur (uBlock, protection contre le pistage) ne bloque pas make.wordpress.org.";
export const MISSING_TITLE = 'Polyglots FR : accès à make.wordpress.org à autoriser';
export const FAILED_TITLE = 'Polyglots FR : dernière vérification en échec';

// Le manifeste de la version Firefox porte `browser_specific_settings.gecko` (tools/build-firefox.py).
export function isFirefoxManifest(manifest) {
  return !!(manifest && manifest.browser_specific_settings && manifest.browser_specific_settings.gecko);
}

// Où activer l'accès soi-même, selon le navigateur.
export function permissionWhere(firefox) {
  return firefox
    ? 'about:addons → Polyglots FR → Permissions'
    : 'chrome://extensions → Polyglots FR → Détails → Accès aux sites';
}

export function deniedText(firefox) {
  return `Accès refusé : tu peux aussi l’activer dans ${permissionWhere(firefox)}.`;
}

export function missingStartError(firefox) {
  return `L’extension n’a pas l’autorisation d’accéder à make.wordpress.org : autorise-la d’abord (bouton « Autoriser l’accès », ou ${permissionWhere(firefox)}).`;
}

// Le manifeste de l'extension en cours (Firefox ou non) ; jamais d'exception.
export function currentIsFirefox(extApi) {
  try {
    return isFirefoxManifest(extApi.runtime.getManifest());
  } catch {
    return false;
  }
}

// Origines d'un événement permissions.onAdded / onRemoved ({ origins, permissions }) : recoupent-elles celles du site ?
// Un motif d'événement recoupe le site s'il le couvre (<all_urls>, schéma * ou identique, hôte identique ou *.domaine).
// `changes` illisible (pas un objet) → recoupe, par prudence ; objet sans `origins` (permissions d'API seulement) → non.
export function originsTouchSite(changes, siteOrigins) {
  if (!changes || typeof changes !== 'object') return true;
  const list = Array.isArray(changes.origins) ? changes.origins : [];
  const parse = (p) => {
    const m = /^(\*|https?|wss?|ftp|file):\/\/([^/]*)\//.exec(String(p));
    return m ? { scheme: m[1], host: m[2] } : null;
  };
  const covers = (event, site) => {
    if (event === '<all_urls>') return true;
    const e = parse(event);
    const s = parse(site);
    if (!e || !s) return false;
    if (e.scheme !== '*' && e.scheme !== s.scheme) return false;
    if (e.host === '*' || e.host === s.host) return true;
    return e.host.startsWith('*.') && (s.host === e.host.slice(2) || s.host.endsWith(e.host.slice(1)));
  };
  return list.some((o) => (siteOrigins || []).some((s) => covers(o, s) || covers(s, o)));
}

// Décision à partir du résultat de `permissions.contains` : seul un `false` explicite signale l'absence.
// Tout le reste (true, résultat illisible) est tenu pour accordé : mieux vaut tenter la requête que bloquer à tort.
export function permissionState(containsResult) {
  return containsResult === false ? 'missing' : 'granted';
}

// La permission d'hôte est-elle accordée ? Détection défensive : API absente ou en erreur → considérée comme accordée.
export async function hasSitePermission(extApi, origins) {
  try {
    if (!extApi || !extApi.permissions || typeof extApi.permissions.contains !== 'function') return true;
    return permissionState(await extApi.permissions.contains({ origins })) === 'granted';
  } catch {
    return true;
  }
}

// Message d'échec du navigateur pour une requête réseau (Firefox : NetworkError…, Chrome : Failed to fetch, Safari : Load failed).
export function isNetworkError(message) {
  return /NetworkError|Failed to fetch|Load failed/i.test(String(message ?? ''));
}

// Message d'erreur de la popup, complété d'une piste quand c'est une erreur réseau alors que la permission est là.
export function describeCheckError(message) {
  const base = `Dernière vérification en échec : ${message}`;
  return isNetworkError(message) ? `${base} ${NETWORK_HINT}` : base;
}
