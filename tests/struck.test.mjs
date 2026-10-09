// Ligne de tâche #fr_FR barrée (cochée dans o2) : détection, masquage dans la liste, saut dans la file.
// `fetch` simulé, aucun accès réseau. Lancer : node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { struckLocaleLine, findUnansweredRequests, fetchStruckLine, findTeamReply } from '../lib/requests.js';
import * as Q from '../lib/queue.js';

const li = (text, { done = true, quote = '"', extra = '' } = {}) =>
  `<li ${extra}class=${quote}o2-task-item o2-task-sortable${done ? ' o2-task-completed' : ''}${quote} ` +
  `data-item-hash=${quote}abc${quote} data-hash-instance=${quote}0${quote} data-item-text=${quote}${text}${quote}>x</li>`;

test('struckLocaleLine : ligne fr_FR cochée → barrée, avec la personne qui l’a cochée', () => {
  assert.deepEqual(struckLocaleLine(`<ul>${li('#fr_FR – @imagepipe (@tobifjellner)')}</ul>`), { struck: true, by: 'tobifjellner' });
});

test('struckLocaleLine : ligne non cochée → pas barrée', () => {
  assert.deepEqual(struckLocaleLine(li('#fr_FR – @imagepipe (@tobifjellner)', { done: false })), { struck: false });
});

test('struckLocaleLine : le demandeur lui-même peut avoir coché', () => {
  assert.deepEqual(struckLocaleLine(li('#fr_FR – @foodord (@foodord)')), { struck: true, by: 'foodord' });
});

test('struckLocaleLine : plusieurs langues, seule une autre langue cochée → pas barrée pour fr_FR', () => {
  const html = li('#de_DE – @x (@y)') + li('#fr_FR – @x (@z)', { done: false });
  assert.deepEqual(struckLocaleLine(html), { struck: false });
  const aussi = li('#de_DE – @x (@y)') + li('#fr_FR – @x (@z)');
  assert.deepEqual(struckLocaleLine(aussi), { struck: true, by: 'z' });
});

test('struckLocaleLine : #fr_BE et #fr_FR_xyz ne comptent pas, la casse est ignorée', () => {
  assert.equal(struckLocaleLine(li('#fr_BE – @x (@y)')).struck, false);
  assert.equal(struckLocaleLine(li('#fr_FR_xyz – @x (@y)')).struck, false);
  assert.equal(struckLocaleLine(li('#fr_FRA @x (@y)')).struck, false);
  assert.deepEqual(struckLocaleLine(li('#FR_fr – @x (@y)')), { struck: true, by: 'y' });
  assert.equal(struckLocaleLine(li('##fr_FR – @x (@y)')).struck, false);
});

test('struckLocaleLine : variantes réelles du texte', () => {
  for (const text of ['#fr_FR – @x (@y)', '#fr_FR - @x (@y)', '#fr_FR (@y)', '#fr_FR @x (@y)', '#fr_FR — @x (@y)']) {
    assert.deepEqual(struckLocaleLine(li(text)), { struck: true, by: 'y' }, text);
  }
});

test('struckLocaleLine : entités HTML décodées', () => {
  assert.deepEqual(struckLocaleLine(li('&#35;fr_FR &#8211; @x (@y)')), { struck: true, by: 'y' });
  assert.deepEqual(struckLocaleLine(li('#fr_FR &ndash; @x (@y)')), { struck: true, by: 'y' });
});

test('struckLocaleLine : le dernier « (@pseudo) » désigne la personne', () => {
  assert.deepEqual(struckLocaleLine(li('#fr_FR – @x (@a) (@b)')), { struck: true, by: 'b' });
});

test('struckLocaleLine : ligne barrée sans pseudo entre parenthèses → by null', () => {
  assert.deepEqual(struckLocaleLine(li('#fr_FR – @x')), { struck: true, by: null });
});

test('struckLocaleLine : guillemets simples, ordre des attributs quelconque', () => {
  assert.equal(struckLocaleLine(li('#fr_FR – @x (@y)', { quote: "'" })).struck, true);
  const reordered = `<li data-item-text="#fr_FR (@y)" data-hash-instance="0" class="o2-task-completed o2-task-item">x</li>`;
  assert.deepEqual(struckLocaleLine(reordered), { struck: true, by: 'y' });
});

test('struckLocaleLine : absence de liste de tâches, entrées vides ou autres éléments', () => {
  assert.deepEqual(struckLocaleLine(''), { struck: false });
  assert.deepEqual(struckLocaleLine(undefined), { struck: false });
  assert.deepEqual(struckLocaleLine('<p>#fr_FR demande</p><ul><li>#fr_FR</li></ul>'), { struck: false });
  // Un <li> coché mais qui n'est pas une ligne de tâche d'o2 ne compte pas.
  assert.deepEqual(struckLocaleLine('<li class="o2-task-completed" data-item-text="#fr_FR (@y)">x</li>'), { struck: false });
});

// ---------- findUnansweredRequests ----------

const LINK = (id) => `https://make.wordpress.org/polyglots/p${id}/`;

function makeFetch({ posts = [], comments = [], single = {} } = {}) {
  const calls = [];
  const res = (data, status = 200) => ({
    ok: status < 300, status, json: async () => data, text: async () => '', headers: { get: () => '1' },
  });
  const fetchFn = async (url) => {
    calls.push(url);
    const one = /\/wp-json\/wp\/v2\/posts\/(\d+)\?/.exec(url);
    if (one) return single[one[1]] === undefined ? res(null, 404) : res({ content: { rendered: single[one[1]] } });
    if (url.includes('/wp-json/wp/v2/posts')) return res(posts);
    if (url.includes('/wp-json/wp/v2/comments')) {
      const ids = /post=([\d,]+)/.exec(url)[1].split(',').map(Number);
      return res(comments.filter((c) => ids.includes(c.post)));
    }
    return res(null, 404);
  };
  fetchFn.calls = calls;
  return fetchFn;
}

const post = (id, content) => ({
  id, date_gmt: '2026-10-07T08:00:00', link: LINK(id), title: { rendered: `Demande ${id}` }, author: 1, tags: [123],
  class_list: ['post', 'author-alice'], content: { rendered: content },
});

test('findUnansweredRequests : une demande barrée est exclue, comptée dans stats.struck, sans garder le HTML', async () => {
  const fetchFn = makeFetch({
    posts: [
      post(1, `<ul>${li('#fr_FR – @alice (@tobifjellner)')}</ul>`),
      post(2, `<ul>${li('#fr_FR – @alice (@alice)', { done: false })}</ul>`),
      post(3, `<ul>${li('#de_DE – @alice (@bob)')}</ul>`), // autre langue cochée : la demande reste
      post(4, '<p>Pas de liste de tâches</p>'),
    ],
    comments: [],
  });
  const { requests, answered, stats } = await findUnansweredRequests({
    team: ['wolforg'], cache: { slugById: {} }, fetchFn, now: Date.parse('2026-10-09T00:00:00Z'),
  });
  assert.deepEqual(requests.map((r) => r.id), [2, 3, 4]);
  assert.equal(stats.struck, 1);
  assert.equal(stats.posts, 4, 'stats.posts compte tous les articles lus');
  assert.deepEqual(answered.map((r) => [r.id, r.struckBy]), [[1, 'tobifjellner']]);
  assert.ok(requests.every((r) => !('content' in r)), 'le HTML du contenu n’est pas conservé');
  assert.ok(fetchFn.calls.find((u) => u.includes('/posts?') && u.includes('content')), '_fields demande le contenu');
  // Les commentaires de la demande barrée ne sont pas lus.
  const commentCall = fetchFn.calls.find((u) => u.includes('/comments'));
  assert.match(commentCall, /[?&]post=2,3,4&/);
});

test('findUnansweredRequests : barrée par le demandeur lui-même, masquée aussi', async () => {
  const fetchFn = makeFetch({ posts: [post(1, li('#fr_FR – @foodord (@foodord)'))] });
  const { requests, stats } = await findUnansweredRequests({ team: [], cache: {}, fetchFn, now: Date.parse('2026-10-09T00:00:00Z') });
  assert.equal(requests.length, 0);
  assert.equal(stats.struck, 1);
});

// ---------- vérification préalable (file) ----------

test('fetchStruckLine : lit l’article seul avec un paramètre anti-cache', async () => {
  const fetchFn = makeFetch({ single: { 7: li('#fr_FR – @a (@b)') } });
  assert.deepEqual(await fetchStruckLine(7, { fetchFn, now: 4242 }), { struck: true, by: 'b' });
  assert.match(fetchFn.calls[0], /posts\/7\?_fields=content&_pfr=4242/);
  await assert.rejects(fetchStruckLine(8, { fetchFn }), /HTTP 404/);
});

// ---------- décision de la vérification préalable (fonction pure de lib/queue.js, utilisée par openCurrentLocked) ----------

test('preCheckDecision : ligne barrée avec pseudo → sautée, « ligne fr_FR barrée par @x »', () => {
  assert.deepEqual(Q.preCheckDecision({ struck: { struck: true, by: 'tobifjellner' } }), {
    skip: true, status: 'alreadyAnswered', by: 'tobifjellner', note: 'ligne fr_FR barrée par @tobifjellner',
  });
});

test('preCheckDecision : ligne barrée sans pseudo → sautée, note sans pseudo', () => {
  assert.deepEqual(Q.preCheckDecision({ struck: { struck: true, by: null } }), {
    skip: true, status: 'alreadyAnswered', by: null, note: 'ligne fr_FR barrée',
  });
});

test('preCheckDecision : réponse d’un membre de l’équipe → sautée, « déjà répondue par @x »', () => {
  assert.deepEqual(Q.preCheckDecision({ struck: { struck: false }, reply: { found: true, by: 'fxbenard' } }), {
    skip: true, status: 'alreadyAnswered', by: 'fxbenard', note: 'déjà répondue par @fxbenard',
  });
});

test('preCheckDecision : ni barrée ni répondue (ou vérifications en échec) → ouverte', () => {
  assert.deepEqual(Q.preCheckDecision({ struck: { struck: false }, reply: { found: false } }), { skip: false });
  assert.deepEqual(Q.preCheckDecision({ struck: null, reply: null }), { skip: false });
  assert.deepEqual(Q.preCheckDecision({}), { skip: false });
  assert.deepEqual(Q.preCheckDecision(), { skip: false });
});

test('preCheckDecision : la ligne barrée passe avant la réponse, la demande ignorée avant tout', () => {
  const both = Q.preCheckDecision({ struck: { struck: true, by: 'a' }, reply: { found: true, by: 'b' } });
  assert.equal(both.by, 'a');
  assert.deepEqual(Q.preCheckDecision({ ignored: true, struck: { struck: true, by: 'a' } }), {
    skip: true, status: 'skipped', by: null, note: 'ignorée',
  });
});

test('file : la décision appliquée à une session saute la demande barrée sans l’ouvrir, avec les vrais appels', async () => {
  let session = Q.createSession([{ id: 7, link: LINK(7), title: 'A' }, { id: 8, link: LINK(8), title: 'B' }], { now: 1, id: 'S' });
  const fetchFn = makeFetch({
    single: { 7: li('#fr_FR – @a (@tobifjellner)'), 8: li('#fr_FR – @a (@a)', { done: false }) },
    comments: [],
  });
  const opened = [];
  while (session.status === 'running') {
    const item = session.items[session.index];
    const struck = await fetchStruckLine(item.id, { fetchFn });
    let d = Q.preCheckDecision({ struck });
    if (!d.skip) {
      const reply = await findTeamReply({ post: item.id, accept: ['wolforg'], cache: {}, fetchFn });
      d = Q.preCheckDecision({ reply });
    }
    if (!d.skip) {
      opened.push(item.id);
      break;
    }
    session = Q.advance(Q.markItem(session, item.id, d.status, { by: d.by, note: d.note }));
  }
  assert.deepEqual(opened, [8]);
  assert.equal(session.items[0].status, 'alreadyAnswered');
  assert.equal(session.items[0].note, 'ligne fr_FR barrée par @tobifjellner');
  assert.equal(session.index, 1);
  assert.equal(session.items[1].status, 'current');
});

// ---------- échantillon réel (wp/v2/posts/71316?_fields=content, constaté le 2026-10-09) ----------

const REAL_CONTENT =
  '<p>Request PTE for fr_FR</p>\n<ul class="o2-task-list">' +
  '<li class="o2-task-item o2-task-sortable o2-task-completed" data-item-hash="d21ec8d022c3e0fc099c3951bb5e4bd9" ' +
  'data-hash-instance="0" data-item-text="#fr_FR – @imagepipe (@tobifjellner)">' +
  '<input type="checkbox" name="" value="" checked disabled> <span class="o2-task-item-text">' +
  '<a href="https://make.wordpress.org/polyglots/teams/?locale=fr_FR" class="tag"><span class="tag-prefix">#</span>fr_FR</a> – ' +
  '<a href="https://profiles.wordpress.org/imagepipe/">@imagepipe</a> (<a href="https://profiles.wordpress.org/tobifjellner/">@tobifjellner</a>)' +
  '</span></li></ul>';

test('échantillon réel de wp/v2/posts/71316 : ligne fr_FR barrée par tobifjellner', () => {
  assert.deepEqual(struckLocaleLine(REAL_CONTENT), { struck: true, by: 'tobifjellner' });
  // La même ligne non cochée (classe o2-task-completed retirée) ne l'est plus.
  assert.deepEqual(struckLocaleLine(REAL_CONTENT.replace(' o2-task-completed', '')), { struck: false });
});

test('échantillon réel : lu par fetchStruckLine et par findUnansweredRequests', async () => {
  const fetchFn = makeFetch({ single: { 71316: REAL_CONTENT }, posts: [post(71316, REAL_CONTENT)] });
  assert.deepEqual(await fetchStruckLine(71316, { fetchFn }), { struck: true, by: 'tobifjellner' });
  const { requests, stats } = await findUnansweredRequests({ team: [], cache: {}, fetchFn, now: Date.parse('2026-10-09T00:00:00Z') });
  assert.equal(requests.length, 0);
  assert.equal(stats.struck, 1);
});
