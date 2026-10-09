// Logique pure : récupérer les demandes fr_FR et garder celles sans réponse de l'équipe FR.
// Aucune API d'extension, aucun DOM : testable sous Node (fetch natif).
//
// Méthode pour les pseudos (user_nicename) :
//  - auteur d'un article : l'API REST ne donne qu'un id numérique (wp/v2/users/<id> répond 404),
//    mais `class_list` de l'article contient « author-<pseudo> » ;
//  - auteur d'un commentaire : l'API REST ne donne qu'un id numérique. Le HTML de la page de
//    l'article porte, sur chaque commentaire, « id="li-comment-<id>" » et
//    « class="… comment-author-<pseudo> …" ». On lit la page seulement quand un id est inconnu,
//    et on garde la correspondance id -> pseudo en cache (les ids sont stables).

import { API_BASE, REQUEST_TAG_IDS, FETCH_TIMEOUT_MS } from './config.js';

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  ndash: '–', mdash: '—', laquo: '«', raquo: '»',
};

export function decodeEntities(str) {
  return String(str ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(code); } catch { return m; }
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, e.toLowerCase())
      ? NAMED_ENTITIES[e.toLowerCase()]
      : m;
  });
}

export function normalizeTeam(list) {
  const out = new Set();
  for (const raw of list || []) {
    const s = String(raw).trim().replace(/^@/, '').toLowerCase();
    if (s) out.add(s);
  }
  return out;
}

export function authorSlugFromClassList(classList) {
  for (const c of classList || []) {
    const m = /^author-(.+)$/.exec(c);
    if (m) return m[1];
  }
  return null;
}

// Map id de commentaire (string) -> pseudo, lue dans le HTML de la page d'un article.
export function parseCommentAuthorsFromHtml(html) {
  const map = new Map();
  const tags = String(html).match(/<li\b[^>]*\bid=["']li-comment-\d+["'][^>]*>/g) || [];
  for (const tag of tags) {
    const id = /\bid=["']li-comment-(\d+)["']/.exec(tag)?.[1];
    const cls = /\bclass=["']([^"']*)["']/.exec(tag)?.[1] || '';
    const slug = /(?:^|\s)comment-author-(\S+)/.exec(cls)?.[1];
    if (id && slug) map.set(id, slug);
  }
  return map;
}

// Liste de tâches d'o2 dans le contenu d'un article : « <li class="o2-task-item … o2-task-completed" data-item-text="#fr_FR – @x (@y)"> ».
// Une ligne cochée (barrée) porte la classe « o2-task-completed » ; le dernier « (@pseudo) » du texte est la personne qui l'a
// cochée (le demandeur lui-même, parfois). Seule compte une ligne dont le texte contient « #<locale> » comme mot entier
// (insensible à la casse : ni #fr_FR_xyz ni #fr_BE). Expressions régulières, comme parseCommentAuthorsFromHtml :
// le service worker n'a pas de DOMParser. Retourne { struck: true, by } (by : pseudo ou null) ou { struck: false }.
export function struckLocaleLine(html, locale = 'fr_FR') {
  const attr = (tag, name) => {
    const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag);
    return m ? (m[1] ?? m[2]) : null;
  };
  const localeRe = new RegExp(`(?:^|[^\\w#])#${locale.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\w)`, 'i');
  for (const tag of String(html ?? '').match(/<li\b[^>]*>/gi) || []) {
    const classes = (attr(tag, 'class') || '').split(/\s+/);
    if (!classes.includes('o2-task-item') || !classes.includes('o2-task-completed')) continue;
    const text = attr(tag, 'data-item-text');
    if (text == null) continue;
    const decoded = decodeEntities(text);
    if (!localeRe.test(decoded)) continue;
    const people = [...decoded.matchAll(/\(@([^)\s]+)\)/g)];
    return { struck: true, by: people.length ? people[people.length - 1][1] : null };
  }
  return { struck: false };
}

// Délai maximal d'une requête (corps compris). Modifiable (tests) ; défaut : FETCH_TIMEOUT_MS.
export const fetchLimits = { timeoutMs: FETCH_TIMEOUT_MS };

// Lance `fetchFn(url, init)` puis `read(res)` sous un délai maximal, avec un AbortController. La promesse est
// rejetée à l'expiration même si `fetchFn` ignore le signal. `signal` (facultatif) : annulation par l'appelant.
function fetchGuarded(fetchFn, url, init, read, signal) {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const fail = (err) => {
      controller.abort();
      reject(err);
    };
    const onAbort = () => fail(new Error(`Requête annulée : ${url}`));
    const timer = setTimeout(
      () => fail(new Error(`Délai dépassé (${Math.round(fetchLimits.timeoutMs / 1000)} s) pour ${url}`)),
      fetchLimits.timeoutMs,
    );
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer);
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
    Promise.resolve()
      .then(() => fetchFn(url, { ...init, signal: controller.signal }))
      .then(read)
      .then(resolve, reject)
      .finally(() => {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
      });
  });
}

// Texte d'une page HTML (erreur levée si le statut n'est pas 2xx).
function fetchHtml(url, fetchFn, signal) {
  return fetchGuarded(fetchFn, url, { headers: { Accept: 'text/html' } }, async (res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  }, signal);
}

function getJson(url, fetchFn, signal) {
  return fetchGuarded(fetchFn, url, { headers: { Accept: 'application/json' } }, async (res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status} pour ${url}`);
    return {
      data: await res.json(),
      totalPages: Number(res.headers.get('x-wp-totalpages') || 1),
    };
  }, signal);
}

async function getAllPages(buildUrl, fetchFn, maxPages = 10, signal = null) {
  const all = [];
  let page = 1;
  let total = 1;
  do {
    const { data, totalPages } = await getJson(buildUrl(page), fetchFn, signal);
    total = totalPages;
    all.push(...data);
    page++;
  } while (page <= total && page <= maxPages);
  return all;
}

export async function fetchRecentPosts({
  days = 14, tagIds = REQUEST_TAG_IDS, now = Date.now(), fetchFn = fetch,
} = {}) {
  const after = new Date(now - days * 86400e3).toISOString().slice(0, 19);
  const fields = 'id,date_gmt,link,title,author,tags,class_list,content';
  const raw = await getAllPages(
    (page) =>
      `${API_BASE}/posts?tags=${tagIds.join(',')}&after=${after}&per_page=100&page=${page}` +
      `&orderby=date&order=desc&_fields=${fields}`,
    fetchFn,
  );
  // Le HTML du contenu n'est pas gardé : on n'en retient que l'état de la ligne de tâche fr_FR.
  return raw.map((p) => {
    const line = struckLocaleLine(p.content?.rendered);
    return {
      id: p.id,
      date: `${p.date_gmt}Z`,
      link: p.link,
      title: decodeEntities(p.title?.rendered),
      authorId: p.author,
      authorSlug: authorSlugFromClassList(p.class_list),
      tags: p.tags || [],
      struck: line.struck,
      struckBy: line.struck ? line.by : null,
    };
  });
}

// Ligne de tâche fr_FR d'une seule demande (file de réponse, vérification préalable) : { struck, by }.
// Les erreurs sont levées : l'appelant décide quoi faire (la file ouvre alors la demande).
export async function fetchStruckLine(postId, { fetchFn = fetch, now = Date.now(), signal = null } = {}) {
  const url = `${API_BASE}/posts/${postId}?_fields=content&_pfr=${encodeURIComponent(now)}`;
  const { data } = await getJson(url, fetchFn, signal);
  return struckLocaleLine(data?.content?.rendered);
}

// `bust` : valeur ajoutée à l'URL pour contourner un cache intermédiaire (file de réponse).
// `signal` : AbortSignal de l'appelant (annulation).
export async function fetchComments(postIds, fetchFn = fetch, { bust = null, signal = null } = {}) {
  const out = [];
  for (let i = 0; i < postIds.length; i += 30) {
    const chunk = postIds.slice(i, i + 30);
    const raw = await getAllPages(
      (page) =>
        `${API_BASE}/comments?post=${chunk.join(',')}&per_page=100&page=${page}` +
        `&order=asc&_fields=id,post,author,date_gmt` +
        (bust == null ? '' : `&_pfr=${encodeURIComponent(bust)}`),
      fetchFn,
      10,
      signal,
    );
    out.push(...raw);
  }
  return out;
}

async function pool(items, concurrency, worker) {
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const i = next++;
      await worker(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
}

// Retourne les demandes fr_FR récentes qui n'ont pas de commentaire d'un membre de l'équipe FR.
// `cache.slugById` (objet { idAuteur: pseudo }) est complété au fil de l'eau : à persister par l'appelant.
export async function findUnansweredRequests({
  team,
  days = 14,
  tagIds = REQUEST_TAG_IDS,
  now = Date.now(),
  fetchFn = fetch,
  cache = {},
  concurrency = 4,
  ignored = [], // ids d'articles ignorés par l'utilisateur : hors liste, comptés dans stats.ignored
} = {}) {
  const teamSet = normalizeTeam(team);
  const slugById = (cache.slugById = cache.slugById || {});
  const stats = { posts: 0, htmlFetched: 0, htmlFailed: 0, skippedOwn: 0, struck: 0, ignored: 0 };
  const ignoredSet = new Set((ignored || []).map(Number));

  const posts = await fetchRecentPosts({ days, tagIds, now, fetchFn });
  stats.posts = posts.length;
  // Demande ignorée, ou dont la ligne de tâche fr_FR est barrée (par n'importe qui) : hors liste, ses commentaires ne
  // sont pas lus. L'anti-cache évite qu'un cache intermédiaire serve une liste de commentaires périmée.
  const open = posts.filter((p) => !p.struck && !ignoredSet.has(Number(p.id)));
  const comments = open.length ? await fetchComments(open.map((p) => p.id), fetchFn, { bust: now }) : [];

  const byPost = new Map();
  for (const c of comments) {
    if (!byPost.has(c.post)) byPost.set(c.post, []);
    byPost.get(c.post).push(c);
  }

  const isTeamId = (id) => !!id && !!slugById[id] && teamSet.has(slugById[id].toLowerCase());
  const answeredBy = (list) => {
    const hit = list.find((c) => isTeamId(c.author));
    return hit ? slugById[hit.author] : null;
  };
  const unknownIds = (list) => [...new Set(list.filter((c) => c.author && !slugById[c.author]).map((c) => c.author))];

  // Passe 1 : ce qui se décide sans lire de page.
  const needHtml = [];
  for (const p of open) {
    const list = byPost.get(p.id) || [];
    if (!answeredBy(list) && unknownIds(list).length) needHtml.push(p);
  }

  // Passe 2 : résoudre les auteurs inconnus par le HTML de la page (une page résout tous ses commentateurs).
  await pool(needHtml, concurrency, async (p) => {
    const list = byPost.get(p.id) || [];
    if (answeredBy(list) || !unknownIds(list).length) return; // résolu entre-temps par une autre page
    try {
      const map = parseCommentAuthorsFromHtml(await fetchHtml(p.link, fetchFn));
      stats.htmlFetched++;
      for (const c of list) {
        const slug = map.get(String(c.id));
        if (c.author && slug) slugById[c.author] = slug;
      }
    } catch {
      stats.htmlFailed++;
    }
  });

  const requests = [];
  const answered = [];
  const ignoredPosts = [];
  for (const p of posts) {
    if (ignoredSet.has(Number(p.id))) {
      stats.ignored++;
      ignoredPosts.push({ id: p.id, date: p.date, link: p.link, title: p.title, authorSlug: p.authorSlug });
      continue;
    }
    if (p.struck) {
      stats.struck++;
      answered.push({ ...p, struckBy: p.struckBy });
      continue;
    }
    const list = byPost.get(p.id) || [];
    const by = answeredBy(list);
    if (by) {
      answered.push({ ...p, answeredBy: by });
      continue;
    }
    if (p.authorSlug && teamSet.has(p.authorSlug.toLowerCase())) {
      stats.skippedOwn++; // article publié par un membre de l'équipe : ce n'est pas une demande à traiter
      continue;
    }
    requests.push({
      ...p,
      commentCount: list.length,
      // true si un commentateur n'a pas pu être identifié : la demande est listée par prudence
      uncertain: unknownIds(list).length > 0,
    });
  }

  // `postIds` : toute la fenêtre surveillée (pour élaguer la liste des ignorées après une vérification réussie).
  return { requests, answered, ignoredPosts, postIds: posts.map((p) => p.id), stats, cache };
}

// File de réponse : cherche, sur UNE demande, un commentaire d'un auteur accepté.
// - Vérification préalable (`knownCommentIds` absent) : n'importe quel commentaire d'un auteur de `accept`.
// - Confirmation d'une publication (`knownCommentIds` fourni) : seulement un commentaire absent de cette liste.
// `accept` : pseudos acceptés (l'équipe, plus l'utilisateur connecté pour la confirmation).
// `liveAuthors` : { idCommentaire: pseudo } relevé dans la page connectée (le HTML lu sans session peut venir
// d'un cache pour les anonymes) ; il passe avant le cache et le HTML. `link` : repli HTML, seulement si un
// auteur reste inconnu. `cache.slugById` est complété : à persister par l'appelant.
// Retourne { found, by, commentId, publishedAt (ms, ou null), unresolved (ids sans auteur connu), htmlFailed, total }.
// Les erreurs de l'API sont levées : l'appelant décide quoi faire.
export async function findTeamReply({
  post,
  link = null,
  accept,
  knownCommentIds = null,
  liveAuthors = {},
  cache = {},
  fetchFn = fetch,
  now = Date.now(),
  signal = null, // AbortSignal de l'appelant (arrêt de la file) ; chaque requête a en plus son délai maximal
} = {}) {
  const acceptSet = normalizeTeam(accept);
  const known = knownCommentIds ? new Set([...knownCommentIds].map(String)) : null;
  const slugById = (cache.slugById = cache.slugById || {});
  const live = {};
  for (const [id, slug] of Object.entries(liveAuthors || {})) {
    if (slug) live[String(id)] = String(slug);
  }

  const comments = (await fetchComments([post], fetchFn, { bust: now, signal })).filter(
    (c) => String(c.post) === String(post),
  );
  const candidates = known ? comments.filter((c) => !known.has(String(c.id))) : comments;

  // Un auteur lu en direct dans la page vaut pour tous ses commentaires (même id d'auteur).
  for (const c of candidates) {
    const s = live[String(c.id)];
    if (s && c.author) slugById[c.author] = s;
  }
  const slugOf = (c) => live[String(c.id)] || (c.author ? slugById[c.author] : null) || null;
  const search = () => {
    const hit = candidates.find((c) => {
      const s = slugOf(c);
      return !!s && acceptSet.has(s.toLowerCase());
    });
    if (!hit) return null;
    // Date du commentaire (date_gmt de l'API, sans suffixe : GMT) en ms, ou null si absente ou illisible.
    const t = hit.date_gmt ? Date.parse(`${hit.date_gmt}Z`) : NaN;
    return { commentId: String(hit.id), by: slugOf(hit), publishedAt: Number.isFinite(t) ? t : null };
  };
  // Un commentaire sans id d'auteur (invité) ne peut pas être de l'équipe : il n'est pas « à résoudre ».
  const unresolved = () => candidates.filter((c) => c.author && !slugOf(c));

  let hit = search();
  let htmlFailed = false;
  if (!hit && link && unresolved().length) {
    try {
      if (signal && signal.aborted) throw new Error('Requête annulée');
      const map = parseCommentAuthorsFromHtml(await fetchHtml(link, fetchFn, signal));
      for (const c of candidates) {
        const s = map.get(String(c.id));
        if (c.author && s) slugById[c.author] = s;
      }
    } catch {
      htmlFailed = true;
    }
    hit = search();
  }

  return {
    found: !!hit,
    by: hit ? hit.by : null,
    commentId: hit ? hit.commentId : null,
    publishedAt: hit ? hit.publishedAt : null,
    unresolved: unresolved().map((c) => String(c.id)),
    htmlFailed,
    total: comments.length,
  };
}
