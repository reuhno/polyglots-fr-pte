// Logique de lib/requests.js : findTeamReply (file de réponse) et non-régression de findUnansweredRequests.
// `fetch` est simulé : aucun accès réseau. Lancer : node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findTeamReply, findUnansweredRequests, fetchComments } from '../lib/requests.js';
import * as Q from '../lib/queue.js';

const LINK = 'https://make.wordpress.org/polyglots/2026/10/07/demande-pte/';

// Commentaire de l'API : auteur = id numérique.
const c = (id, author, post = 100) => ({ id, post, author, date_gmt: '2026-10-07T10:00:00' });

function htmlWith(map) {
  return Object.entries(map)
    .map(([id, slug]) => `<li id="li-comment-${id}" class="comment byuser comment-author-${slug} even thread-even depth-1">x</li>`)
    .join('\n');
}

// Fabrique un `fetch` simulé.
// - comments : commentaires renvoyés par /comments, pageSize par page (header x-wp-totalpages)
// - html : { [url]: texte | number (statut d'erreur) }
// - commentsStatus : statut HTTP de /comments
function makeFetch({ comments = [], pageSize = 100, html = {}, commentsStatus = 200, posts = [] } = {}) {
  const calls = [];
  const res = (data, { status = 200, totalPages = 1, text = '' } = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => text,
    headers: { get: (n) => (n.toLowerCase() === 'x-wp-totalpages' ? String(totalPages) : null) },
  });
  const fetchFn = async (url) => {
    calls.push(url);
    if (url.includes('/wp-json/wp/v2/comments')) {
      if (commentsStatus !== 200) return res([], { status: commentsStatus });
      const page = Number(/[?&]page=(\d+)/.exec(url)[1]);
      const totalPages = Math.max(1, Math.ceil(comments.length / pageSize));
      return res(comments.slice((page - 1) * pageSize, page * pageSize), { totalPages });
    }
    if (url.includes('/wp-json/wp/v2/posts')) return res(posts);
    if (url in html) {
      const body = html[url];
      return typeof body === 'number' ? res(null, { status: body }) : res(null, { text: body });
    }
    return res(null, { status: 404 });
  };
  fetchFn.calls = calls;
  return fetchFn;
}

const htmlCalls = (f) => f.calls.filter((u) => !u.includes('/wp-json/'));

test('confirmation : un commentaire nouveau d’un membre de l’équipe (pseudo en cache) est trouvé', async () => {
  const fetchFn = makeFetch({ comments: [c(1, 7), c(2, 9)] });
  const cache = { slugById: { 9: 'audrasjb', 7: 'tiers' } };
  const r = await findTeamReply({ post: 100, link: LINK, accept: ['audrasjb'], knownCommentIds: ['1'], cache, fetchFn });
  assert.equal(r.found, true);
  assert.equal(r.by, 'audrasjb');
  assert.equal(r.commentId, '2');
  assert.equal(htmlCalls(fetchFn).length, 0, 'aucune page HTML lue : tout était en cache');
});

test('confirmation : le commentaire d’un tiers ne compte pas', async () => {
  const fetchFn = makeFetch({ comments: [c(1, 7), c(2, 8)] });
  const cache = { slugById: { 7: 'tiers', 8: 'autre-tiers' } };
  const r = await findTeamReply({ post: 100, link: LINK, accept: ['wolforg', 'laboiteare'], knownCommentIds: ['1'], cache, fetchFn });
  assert.equal(r.found, false);
  assert.deepEqual(r.unresolved, []);
});

test('confirmation : le commentaire de l’utilisateur connecté (hors équipe) compte', async () => {
  const fetchFn = makeFetch({ comments: [c(1, 7), c(2, 12)] });
  const cache = { slugById: { 7: 'tiers', 12: 'laboiteare' } };
  const team = ['wolforg', 'fxbenard', 'audrasjb', 'jdy68'];
  const sansUtilisateur = await findTeamReply({ post: 100, accept: team, knownCommentIds: ['1'], cache, fetchFn });
  assert.equal(sansUtilisateur.found, false, 'l’équipe seule ne reconnaît pas ce compte');
  const avecUtilisateur = await findTeamReply({ post: 100, accept: [...team, 'laboiteare'], knownCommentIds: ['1'], cache, fetchFn });
  assert.equal(avecUtilisateur.found, true);
  assert.equal(avecUtilisateur.by, 'laboiteare');
});

test('confirmation : les pseudos se comparent sans tenir compte de la casse ni de l’arobase', async () => {
  const fetchFn = makeFetch({ comments: [c(2, 9)] });
  const r = await findTeamReply({
    post: 100, accept: ['@AudrasJB'], knownCommentIds: [], cache: { slugById: { 9: 'audrasjb' } }, fetchFn,
  });
  assert.equal(r.found, true);
});

test('confirmation : un commentaire d’équipe déjà connu (présent avant l’armement) est ignoré', async () => {
  const fetchFn = makeFetch({ comments: [c(1, 9)] });
  const cache = { slugById: { 9: 'audrasjb' } };
  const r = await findTeamReply({ post: 100, accept: ['audrasjb'], knownCommentIds: new Set(['1']), cache, fetchFn });
  assert.equal(r.found, false);
});

test('pagination : le nouveau commentaire est sur la page 2', async () => {
  const comments = [];
  for (let i = 1; i <= 120; i++) comments.push(c(i, 7));
  comments.push(c(121, 9));
  const fetchFn = makeFetch({ comments, pageSize: 100 });
  const known = comments.slice(0, 120).map((x) => String(x.id));
  const cache = { slugById: { 7: 'tiers', 9: 'jdy68' } };
  const r = await findTeamReply({ post: 100, accept: ['jdy68'], knownCommentIds: known, cache, fetchFn });
  assert.equal(r.found, true);
  assert.equal(r.commentId, '121');
  assert.equal(r.total, 121);
  assert.equal(fetchFn.calls.filter((u) => u.includes('/comments')).length, 2, 'deux pages demandées');
});

test('anti-cache : la requête REST porte un paramètre unique', async () => {
  const f1 = makeFetch({ comments: [] });
  await findTeamReply({ post: 100, accept: ['x'], knownCommentIds: [], fetchFn: f1, now: 1111 });
  const f2 = makeFetch({ comments: [] });
  await findTeamReply({ post: 100, accept: ['x'], knownCommentIds: [], fetchFn: f2, now: 2222 });
  assert.match(f1.calls[0], /[?&]_pfr=1111(&|$)/);
  assert.match(f2.calls[0], /[?&]_pfr=2222(&|$)/);
  assert.match(f1.calls[0], /per_page=100/);
});

test('fetchComments sans `bust` : l’URL reste celle de la v0.1', async () => {
  const f = makeFetch({ comments: [] });
  await fetchComments([100], f);
  assert.ok(!f.calls[0].includes('_pfr'));
});

test('auteur inconnu : repli sur le HTML de la page, qui résout le pseudo', async () => {
  const fetchFn = makeFetch({ comments: [c(1, 7), c(2, 9)], html: { [LINK]: htmlWith({ 1: 'tiers', 2: 'fxbenard' }) } });
  const cache = {};
  const r = await findTeamReply({ post: 100, link: LINK, accept: ['fxbenard'], knownCommentIds: ['1'], cache, fetchFn });
  assert.equal(r.found, true);
  assert.equal(r.by, 'fxbenard');
  assert.equal(htmlCalls(fetchFn).length, 1);
  // Seuls les commentaires candidats (absents de la liste connue) sont résolus : le 1, déjà connu, ne l'est pas.
  assert.deepEqual(cache.slugById, { 9: 'fxbenard' }, 'le cache est complété pour les prochains appels');
});

test('auteur inconnu et pas de HTML exploitable : non trouvé, ids signalés', async () => {
  const fetchFn = makeFetch({ comments: [c(2, 9)], html: { [LINK]: 500 } });
  const r = await findTeamReply({ post: 100, link: LINK, accept: ['fxbenard'], knownCommentIds: [], cache: {}, fetchFn });
  assert.equal(r.found, false);
  assert.equal(r.htmlFailed, true);
  assert.deepEqual(r.unresolved, ['2']);
});

test('auteur inconnu sans lien : aucune page lue, ids signalés', async () => {
  const fetchFn = makeFetch({ comments: [c(2, 9)] });
  const r = await findTeamReply({ post: 100, accept: ['fxbenard'], knownCommentIds: [], cache: {}, fetchFn });
  assert.equal(r.found, false);
  assert.deepEqual(r.unresolved, ['2']);
  assert.equal(htmlCalls(fetchFn).length, 0);
});

test('auteurs lus en direct dans la page connectée : prioritaires, sans lire le HTML (cache anonyme)', async () => {
  // Le HTML lu sans session est périmé (il ne contient pas le nouveau commentaire) : on ne doit même pas le lire.
  const fetchFn = makeFetch({ comments: [c(1, 7), c(5, 12)], html: { [LINK]: htmlWith({ 1: 'tiers' }) } });
  const cache = { slugById: { 7: 'tiers' } };
  const r = await findTeamReply({
    post: 100, link: LINK, accept: ['wolforg', 'laboiteare'], knownCommentIds: ['1'], liveAuthors: { 5: 'laboiteare' }, cache, fetchFn,
  });
  assert.equal(r.found, true);
  assert.equal(r.by, 'laboiteare');
  assert.equal(htmlCalls(fetchFn).length, 0);
  assert.equal(cache.slugById[12], 'laboiteare', 'l’id d’auteur est mémorisé');
});

test('un auteur en direct qui n’est pas accepté ne déclenche rien', async () => {
  const fetchFn = makeFetch({ comments: [c(5, 12)] });
  const r = await findTeamReply({ post: 100, accept: ['wolforg'], knownCommentIds: [], liveAuthors: { 5: 'passant' }, cache: {}, fetchFn });
  assert.equal(r.found, false);
  assert.deepEqual(r.unresolved, []);
});

test('un commentaire d’invité (auteur 0) n’est jamais « à résoudre » ni accepté', async () => {
  const fetchFn = makeFetch({ comments: [c(3, 0)] });
  const r = await findTeamReply({ post: 100, link: LINK, accept: ['wolforg'], knownCommentIds: [], cache: {}, fetchFn });
  assert.equal(r.found, false);
  assert.deepEqual(r.unresolved, []);
  assert.equal(htmlCalls(fetchFn).length, 0);
});

test('erreur de l’API : l’exception remonte à l’appelant (qui espace ses requêtes)', async () => {
  const fetchFn = makeFetch({ commentsStatus: 500 });
  await assert.rejects(findTeamReply({ post: 100, accept: ['x'], knownCommentIds: [], fetchFn }), /HTTP 500/);
});

test('les commentaires d’une autre demande sont ignorés', async () => {
  const fetchFn = makeFetch({ comments: [c(2, 9, 999)] });
  const r = await findTeamReply({ post: 100, accept: ['fxbenard'], knownCommentIds: [], cache: { slugById: { 9: 'fxbenard' } }, fetchFn });
  assert.equal(r.found, false);
  assert.equal(r.total, 0);
});

test('vérification préalable : sans liste connue, tout commentaire d’un membre de l’équipe suffit', async () => {
  const fetchFn = makeFetch({ comments: [c(1, 7), c(2, 9)] });
  const cache = { slugById: { 7: 'tiers', 9: 'wolforg' } };
  const r = await findTeamReply({ post: 100, accept: ['wolforg'], cache, fetchFn });
  assert.equal(r.found, true);
  assert.equal(r.by, 'wolforg');
  const aucun = await findTeamReply({ post: 100, accept: ['jdy68'], cache, fetchFn });
  assert.equal(aucun.found, false);
});

test('file : un membre de l’équipe répond entre le démarrage et l’ouverture, la demande est marquée « déjà répondue »', async () => {
  // Deux demandes en file. Au démarrage, personne n'a répondu. Pendant la demande 1, un membre de l'équipe
  // répond à la demande 2 : au moment de l'ouvrir, la vérification préalable la saute sans l'ouvrir.
  const team = ['wolforg', 'fxbenard'];
  const cache = { slugById: { 7: 'tiers', 9: 'fxbenard' } };
  let session = Q.createSession(
    [{ id: 101, link: 'l1', title: 'A', authorSlug: 'a' }, { id: 102, link: 'l2', title: 'B', authorSlug: 'b' }],
    { now: 1, id: 'S' },
  );

  // Ouverture de la 1 : rien à signaler.
  const avant = await findTeamReply({ post: 101, accept: team, cache, fetchFn: makeFetch({ comments: [c(1, 7, 101)] }) });
  assert.equal(avant.found, false);

  // Publication de la 1, puis passage à la 2.
  session = Q.advance(Q.markItem(session, 101, 'published', { now: 2 }));
  assert.equal(Q.currentItem(session).id, 102);

  // Vérification préalable de la 2 : fxbenard a répondu entre-temps.
  const f = makeFetch({ comments: [c(10, 7, 102), c(11, 9, 102)] });
  const reply = await findTeamReply({ post: 102, accept: team, cache, fetchFn: f });
  assert.equal(reply.found, true);
  session = Q.advance(Q.markItem(session, 102, 'alreadyAnswered', { by: reply.by, note: `déjà répondue par @${reply.by}` }));

  assert.equal(session.status, 'finished');
  assert.equal(session.items[1].status, 'alreadyAnswered');
  assert.equal(session.items[1].note, 'déjà répondue par @fxbenard');
  assert.equal(session.items[1].knownIds, null, 'jamais ouverte, donc jamais armée');
  assert.deepEqual(Q.summary(session), { total: 2, published: 1, skipped: 0, alreadyAnswered: 1, error: 0, done: 2, remaining: 0 });
});

test('non-régression v0.1 : findUnansweredRequests liste les demandes sans réponse de l’équipe', async () => {
  const post = (id, author) => ({
    id, date_gmt: '2026-10-07T08:00:00', link: `https://make.wordpress.org/polyglots/p${id}/`,
    title: { rendered: `Demande &amp; ${id}` }, author: 1, tags: [123], class_list: ['post', `author-${author}`],
  });
  const fetchFn = makeFetch({
    posts: [post(1, 'alice'), post(2, 'bob'), post(3, 'wolforg')],
    comments: [c(10, 9, 2), c(11, 7, 1)],
  });
  const cache = { slugById: { 9: 'fxbenard', 7: 'tiers' } };
  const { requests, answered, stats } = await findUnansweredRequests({
    team: ['fxbenard', 'wolforg'], cache, fetchFn, now: Date.parse('2026-10-09T00:00:00Z'),
  });
  assert.deepEqual(requests.map((r) => r.id), [1], 'la 2 est répondue, la 3 est un article de l’équipe');
  assert.equal(requests[0].title, 'Demande & 1');
  assert.equal(requests[0].commentCount, 1);
  assert.equal(requests[0].uncertain, false);
  assert.deepEqual(answered.map((r) => r.id), [2]);
  assert.equal(stats.skippedOwn, 1);
});
