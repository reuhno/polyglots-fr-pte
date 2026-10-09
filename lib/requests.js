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

import { API_BASE, REQUEST_TAG_IDS } from './config.js';

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

async function getJson(url, fetchFn) {
  const res = await fetchFn(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} pour ${url}`);
  return {
    data: await res.json(),
    totalPages: Number(res.headers.get('x-wp-totalpages') || 1),
  };
}

async function getAllPages(buildUrl, fetchFn, maxPages = 10) {
  const all = [];
  let page = 1;
  let total = 1;
  do {
    const { data, totalPages } = await getJson(buildUrl(page), fetchFn);
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
  const fields = 'id,date_gmt,link,title,author,tags,class_list';
  const raw = await getAllPages(
    (page) =>
      `${API_BASE}/posts?tags=${tagIds.join(',')}&after=${after}&per_page=100&page=${page}` +
      `&orderby=date&order=desc&_fields=${fields}`,
    fetchFn,
  );
  return raw.map((p) => ({
    id: p.id,
    date: `${p.date_gmt}Z`,
    link: p.link,
    title: decodeEntities(p.title?.rendered),
    authorId: p.author,
    authorSlug: authorSlugFromClassList(p.class_list),
    tags: p.tags || [],
  }));
}

export async function fetchComments(postIds, fetchFn = fetch) {
  const out = [];
  for (let i = 0; i < postIds.length; i += 30) {
    const chunk = postIds.slice(i, i + 30);
    const raw = await getAllPages(
      (page) =>
        `${API_BASE}/comments?post=${chunk.join(',')}&per_page=100&page=${page}` +
        `&order=asc&_fields=id,post,author,date_gmt`,
      fetchFn,
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
} = {}) {
  const teamSet = normalizeTeam(team);
  const slugById = (cache.slugById = cache.slugById || {});
  const stats = { posts: 0, htmlFetched: 0, htmlFailed: 0, skippedOwn: 0 };

  const posts = await fetchRecentPosts({ days, tagIds, now, fetchFn });
  stats.posts = posts.length;
  const comments = posts.length ? await fetchComments(posts.map((p) => p.id), fetchFn) : [];

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
  for (const p of posts) {
    const list = byPost.get(p.id) || [];
    if (!answeredBy(list) && unknownIds(list).length) needHtml.push(p);
  }

  // Passe 2 : résoudre les auteurs inconnus par le HTML de la page (une page résout tous ses commentateurs).
  await pool(needHtml, concurrency, async (p) => {
    const list = byPost.get(p.id) || [];
    if (answeredBy(list) || !unknownIds(list).length) return; // résolu entre-temps par une autre page
    try {
      const res = await fetchFn(p.link, { headers: { Accept: 'text/html' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const map = parseCommentAuthorsFromHtml(await res.text());
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
  for (const p of posts) {
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

  return { requests, answered, stats, cache };
}
