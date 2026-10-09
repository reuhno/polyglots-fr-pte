// Demandes ignorées, date de publication, échéance de la veille. Lancer : node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_IGNORED, sanitizeIgnored, addIgnored, removeIgnored, isIgnored, pruneIgnored,
} from '../lib/ignored.js';
import { sanitizeSettings } from '../lib/settings.js';
import { findUnansweredRequests, findTeamReply } from '../lib/requests.js';
import * as Q from '../lib/queue.js';

// ---------- liste des ignorées ----------

test('sanitizeIgnored : entiers positifs, sans doublon, ordre conservé', () => {
  assert.deepEqual(sanitizeIgnored([5, '7', 5, 0, -3, 2.5, 'x', null, undefined, 9]), [7, 5, 9]);
  assert.deepEqual(sanitizeIgnored(undefined), []);
  assert.deepEqual(sanitizeIgnored('12'), []);
  assert.deepEqual(sanitizeIgnored([]), []);
});

test('sanitizeIgnored : plafonné à 500 en gardant les plus récents (fin de liste)', () => {
  const list = Array.from({ length: 700 }, (_, i) => i + 1);
  const out = sanitizeIgnored(list);
  assert.equal(out.length, MAX_IGNORED);
  assert.equal(out[0], 201);
  assert.equal(out[out.length - 1], 700);
});

test('addIgnored / removeIgnored / isIgnored', () => {
  let list = addIgnored([], 10);
  list = addIgnored(list, 20);
  list = addIgnored(list, 10); // déjà présent : remis en fin de liste
  assert.deepEqual(list, [20, 10]);
  assert.equal(isIgnored(list, '20'), true);
  assert.equal(isIgnored(list, 30), false);
  assert.deepEqual(removeIgnored(list, 20), [10]);
  assert.deepEqual(removeIgnored(list, 99), [20, 10]);
});

test('pruneIgnored : ne garde que les ids encore dans la fenêtre surveillée', () => {
  assert.deepEqual(pruneIgnored([1, 2, 3, 4], [2, 4, 5]), [2, 4]);
  assert.deepEqual(pruneIgnored([1, 2], []), [], 'fenêtre vide : tout est retiré (l’appelant ne l’appelle pas dans ce cas)');
  assert.deepEqual(pruneIgnored([], [1, 2]), []);
});

test('sanitizeSettings : le réglage `ignored` est assaini, absent = liste vide', () => {
  assert.deepEqual(sanitizeSettings({}).ignored, []);
  assert.deepEqual(sanitizeSettings({ ignored: ['4', 4, 'a', 8] }).ignored, [4, 8]);
  assert.equal(sanitizeSettings({}).team.length, 4, 'l’équipe par défaut est inchangée');
});

// ---------- exclusion dans findUnansweredRequests ----------

const post = (id) => ({
  id, date_gmt: '2026-10-07T08:00:00', link: `https://make.wordpress.org/polyglots/p${id}/`, title: { rendered: `Demande ${id}` },
  author: 1, tags: [123], class_list: ['post', 'author-alice'], content: { rendered: '' },
});

function makeFetch(posts) {
  const calls = [];
  const res = (data) => ({ ok: true, status: 200, json: async () => data, text: async () => '', headers: { get: () => '1' } });
  const fetchFn = async (url) => {
    calls.push(url);
    if (url.includes('/wp/v2/posts')) return res(posts);
    if (url.includes('/wp/v2/comments')) return res([]);
    return { ok: false, status: 404 };
  };
  fetchFn.calls = calls;
  return fetchFn;
}

test('findUnansweredRequests : une demande ignorée sort de la liste, comptée dans stats.ignored', async () => {
  const fetchFn = makeFetch([post(1), post(2), post(3)]);
  const r = await findUnansweredRequests({
    team: [], cache: {}, fetchFn, ignored: [2, 99], now: Date.parse('2026-10-09T00:00:00Z'),
  });
  assert.deepEqual(r.requests.map((x) => x.id), [1, 3]);
  assert.equal(r.stats.ignored, 1);
  assert.deepEqual(r.ignoredPosts.map((x) => x.id), [2]);
  assert.deepEqual(r.postIds, [1, 2, 3], 'toute la fenêtre, pour l’élagage');
  assert.match(fetchFn.calls.find((u) => u.includes('/comments')), /post=1,3&/, 'ses commentaires ne sont pas lus');
});

test('findUnansweredRequests : sans liste, rien ne change ; les commentaires sont lus avec l’anti-cache', async () => {
  const fetchFn = makeFetch([post(1)]);
  const r = await findUnansweredRequests({ team: [], cache: {}, fetchFn, now: 777 });
  assert.equal(r.requests.length, 1);
  assert.equal(r.stats.ignored, 0);
  assert.match(fetchFn.calls.find((u) => u.includes('/comments')), /[?&]_pfr=777(&|$)/);
});

test('élagage après vérification : seuls les ids sortis de la fenêtre disparaissent', async () => {
  const fetchFn = makeFetch([post(1), post(2)]);
  const stored = [2, 50];
  const r = await findUnansweredRequests({ team: [], cache: {}, fetchFn, ignored: stored, now: 1 });
  assert.deepEqual(pruneIgnored(stored, r.postIds), [2]);
});

test('file : une demande ignorée en cours de session, pas encore ouverte, est sautée avec la note « ignorée »', () => {
  let s = Q.createSession([{ id: 1 }, { id: 2 }, { id: 3 }], { now: 1, id: 'S' });
  s = Q.advance(Q.markItem(s, 1, 'published', { now: 5 }));
  // L'utilisateur ignore la 2 pendant la session : la liste est consultée à l'ouverture de chaque demande.
  const ignored = [2];
  while (s.status === 'running') {
    const item = s.items[s.index];
    const d = Q.preCheckDecision({ ignored: isIgnored(ignored, item.id) });
    if (!d.skip) break;
    s = Q.advance(Q.markItem(s, item.id, d.status, { by: d.by, note: d.note }));
  }
  assert.equal(s.items[1].status, 'skipped');
  assert.equal(s.items[1].note, 'ignorée');
  assert.equal(s.index, 2);
  assert.equal(s.items[2].status, 'current');
});

// ---------- date de publication ----------

test('findTeamReply : renvoie la date du commentaire trouvé (date_gmt + Z)', async () => {
  const fetchFn = async () => ({
    ok: true,
    status: 200,
    json: async () => [{ id: 5, post: 100, author: 9, date_gmt: '2026-10-07T10:30:00' }],
    text: async () => '',
    headers: { get: () => '1' },
  });
  const r = await findTeamReply({ post: 100, accept: ['x'], knownCommentIds: [], cache: { slugById: { 9: 'x' } }, fetchFn });
  assert.equal(r.found, true);
  assert.equal(r.publishedAt, Date.parse('2026-10-07T10:30:00Z'));
  const sans = await findTeamReply({
    post: 100, accept: ['x'], knownCommentIds: [], cache: { slugById: { 9: 'x' } },
    fetchFn: async () => ({ ok: true, status: 200, json: async () => [{ id: 5, post: 100, author: 9 }], headers: { get: () => '1' } }),
  });
  assert.equal(sans.publishedAt, null);
});

test('markItem : lastPublishedAt prend la date du commentaire si connue, sinon maintenant', () => {
  const base = Q.createSession([{ id: 1 }], { now: 1, id: 'S' });
  const t = 1_000_000;
  assert.equal(Q.markItem(base, 1, 'published', { now: t + 500, publishedAt: t }).lastPublishedAt, t);
  assert.equal(Q.markItem(base, 1, 'published', { now: t + 500 }).lastPublishedAt, t + 500);
  assert.equal(Q.markItem(base, 1, 'published', { now: t, publishedAt: null }).lastPublishedAt, t);
  assert.equal(Q.markItem(base, 1, 'published', { now: t, publishedAt: t + 9999 }).lastPublishedAt, t, 'date future : ignorée');
  assert.equal(Q.markItem(base, 1, 'published', { now: t, publishedAt: NaN }).lastPublishedAt, t);
});

// ---------- échéance de la veille ----------

test('setHelloDeadline / applyHelloDeadline : pause « noHello » seulement si l’échéance est dépassée sans signal', () => {
  const s = Q.createSession([{ id: 1 }], { now: 1, id: 'S' });
  assert.equal(Q.applyHelloDeadline(s, 1e12), s, 'pas d’échéance : rien');
  const d = Q.setHelloDeadline(s, 5000);
  assert.equal(d.helloDeadline, 5000);
  assert.equal(Q.applyHelloDeadline(d, 4000), d, 'pas encore dépassée');
  assert.equal(Q.applyHelloDeadline(d, 5000), d, 'à l’échéance exacte : pas encore');
  const p = Q.applyHelloDeadline(d, 5001);
  assert.equal(p.status, 'paused');
  assert.equal(p.pauseReason, 'noHello');
  assert.equal(p.helloDeadline, null);
  // Un signal de vie efface l'échéance.
  const alive = Q.setHelloDeadline(d, null);
  assert.equal(alive.helloDeadline, null);
  assert.equal(Q.applyHelloDeadline(alive, 1e12), alive);
  assert.equal(Q.setHelloDeadline(alive, null), alive, 'déjà effacée : inchangé');
});

test('l’échéance disparaît à la pause, à l’arrêt, à l’avancée et à la fin', () => {
  const two = Q.createSession([{ id: 1 }, { id: 2 }], { now: 1, id: 'S' });
  const armed = Q.setHelloDeadline(two, 9);
  assert.equal(Q.pause(armed, 'tabClosed').helloDeadline, null);
  assert.equal(Q.stop(armed).helloDeadline, null);
  const next = Q.advance(Q.markItem(armed, 1, 'skipped'));
  assert.equal(next.helloDeadline, null);
  const fin = Q.advance(Q.markItem(Q.setHelloDeadline(next, 9), 2, 'skipped'));
  assert.equal(fin.status, 'finished');
  assert.equal(fin.helloDeadline, null);
  assert.equal(Q.applyHelloDeadline(Q.pause(armed, 'x'), 1e12).status, 'paused');
});
