// Demandes « ignorées » par l'utilisateur (une publication fr_FR qui n'est pas une demande PTE, par exemple).
// Fonctions pures : la liste des ids d'articles vit dans storage.sync (réglage `ignored`, lib/settings.js).
// Les ids les plus récemment ajoutés sont à la fin de la liste ; le plafond garde les derniers.

export const MAX_IGNORED = 500;

// Tableau d'entiers positifs, sans doublon (la dernière occurrence compte), plafonné aux MAX_IGNORED derniers.
export function sanitizeIgnored(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (let i = raw.length - 1; i >= 0; i--) {
    const n = Number(raw[i]);
    if (!Number.isInteger(n) || n <= 0 || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out.slice(0, MAX_IGNORED).reverse();
}

// Ajoute un id (ou le remet en fin de liste s'il y est déjà).
export function addIgnored(list, id) {
  return sanitizeIgnored([...(list || []), id]);
}

export function removeIgnored(list, id) {
  return sanitizeIgnored((list || []).filter((x) => Number(x) !== Number(id)));
}

export const isIgnored = (list, id) => (list || []).some((x) => Number(x) === Number(id));

// Élagage : ne garde que les ids encore présents dans la fenêtre surveillée (`windowIds`).
// À n'appliquer qu'après une vérification réussie : sur une erreur réseau, la fenêtre est inconnue.
export function pruneIgnored(list, windowIds) {
  const inWindow = new Set((windowIds || []).map(Number));
  return sanitizeIgnored((list || []).filter((x) => inWindow.has(Number(x))));
}
