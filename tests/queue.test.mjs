// Machine d'états de la file de réponse (lib/queue.js). Lancer : node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Q from '../lib/queue.js';

const req = (id, extra = {}) => ({
  id,
  link: `https://make.wordpress.org/polyglots/2026/10/0${id}/demande-${id}/`,
  title: `Demande ${id}`,
  authorSlug: `auteur${id}`,
  date: `2026-10-0${id}T10:00:00Z`,
  ...extra,
});

const three = () => Q.createSession([req(1), req(2), req(3)], { now: 1000, id: 'S1' });
const statuses = (s) => s.items.map((it) => it.status);

test('createSession : copie les champs, la première demande est courante, les doublons sont écartés', () => {
  const s = Q.createSession([req(1), req(2), req(1)], { now: 1000, id: 'S1' });
  assert.equal(s.id, 'S1');
  assert.equal(s.status, 'running');
  assert.equal(s.index, 0);
  assert.equal(s.items.length, 2);
  assert.deepEqual(statuses(s), ['current', 'pending']);
  assert.equal(s.items[0].author, 'auteur1');
  assert.equal(s.items[0].title, 'Demande 1');
  assert.equal(s.tabId, null);
  assert.equal(s.lastPublishedAt, null);
});

test('createSession : lien de repli ?p=<id>, liste vide = null', () => {
  const s = Q.createSession([{ id: 42, title: 'X' }], { now: 1 });
  assert.equal(s.items[0].link, 'https://make.wordpress.org/polyglots/?p=42');
  assert.equal(s.items[0].author, null);
  assert.equal(Q.createSession([]), null);
  assert.equal(Q.createSession(null), null);
});

test('sortRequests : de la plus ancienne à la plus récente, sans modifier l’entrée', () => {
  const input = [req(3), req(1), req(2)];
  const sorted = Q.sortRequests(input);
  assert.deepEqual(sorted.map((r) => r.id), [1, 2, 3]);
  assert.deepEqual(input.map((r) => r.id), [3, 1, 2]);
});

test('defaultSelection : tout sauf les demandes « à vérifier »', () => {
  const sel = Q.defaultSelection([req(1), req(2, { uncertain: true }), req(3, { uncertain: false })]);
  assert.deepEqual([...sel].sort(), [1, 3]);
});

test('isCurrent : bonne session, bonne demande, session en cours', () => {
  const s = three();
  assert.equal(Q.isCurrent(s, 'S1', 1), true);
  assert.equal(Q.isCurrent(s, 'S1', '1'), true);
  assert.equal(Q.isCurrent(s, 'S1', 2), false);
  assert.equal(Q.isCurrent(s, 'AUTRE', 1), false);
  assert.equal(Q.isCurrent(Q.pause(s, 'tabClosed'), 'S1', 1), false);
  assert.equal(Q.isCurrent(null, 'S1', 1), false);
});

test('markItem : publication datée, ignorée pour une autre demande ou une demande déjà réglée', () => {
  const s = three();
  assert.equal(Q.markItem(s, 2, 'published'), s, 'demande non courante : inchangé');
  const p = Q.markItem(s, 1, 'published', { now: 5000, by: 'moi' });
  assert.equal(p.items[0].status, 'published');
  assert.equal(p.items[0].by, 'moi');
  assert.equal(p.lastPublishedAt, 5000);
  assert.equal(s.items[0].status, 'current', 'l’entrée n’est pas modifiée');
  const again = Q.markItem(p, 1, 'skipped', { now: 9000 });
  assert.equal(again, p, 'déjà réglée : inchangé');
  assert.throws(() => Q.markItem(s, 1, 'pending'));
});

test('markItem : seule une publication date l’anti-flood', () => {
  const s = Q.markItem(three(), 1, 'skipped', { now: 5000 });
  assert.equal(s.lastPublishedAt, null);
  const a = Q.markItem(three(), 1, 'alreadyAnswered', { now: 5000, note: 'déjà répondue par @x' });
  assert.equal(a.lastPublishedAt, null);
  assert.equal(a.items[0].note, 'déjà répondue par @x');
});

test('advance : n’avance pas tant que la demande courante n’est pas réglée', () => {
  const s = three();
  assert.equal(Q.advance(s), s);
});

test('advance : double avancée ignorée (idempotence)', () => {
  let s = Q.markItem(three(), 1, 'published', { now: 10 });
  s = Q.advance(s);
  assert.equal(s.index, 1);
  assert.deepEqual(statuses(s), ['published', 'current', 'pending']);
  // Un second « suivante » pour la demande 1 : la garde la refuse, et advance seul ne bouge pas (la 2 n'est pas réglée).
  assert.equal(Q.isCurrent(s, 'S1', 1), false);
  assert.equal(Q.advance(s), s);
  assert.equal(Q.markItem(s, 1, 'skipped'), s);
  assert.equal(s.index, 1);
});

test('advance : après la dernière demande, la session est terminée', () => {
  let s = three();
  for (const id of [1, 2, 3]) {
    s = Q.advance(Q.markItem(s, id, id === 2 ? 'skipped' : 'published', { now: 100 + id }), { now: 777 });
  }
  assert.equal(s.status, 'finished');
  assert.equal(s.finishedAt, 777);
  assert.deepEqual(statuses(s), ['published', 'skipped', 'published']);
  assert.deepEqual(Q.summary(s), { total: 3, published: 2, skipped: 1, alreadyAnswered: 0, error: 0, done: 3, remaining: 0 });
  assert.equal(Q.advance(s), s, 'terminée : plus d’avancée');
  assert.equal(Q.currentItem(s), null);
});

test('advance : efface les ids relevés de la demande quittée', () => {
  let s = Q.setKnownIds(three(), 1, [10, 11]);
  assert.deepEqual(s.items[0].knownIds, ['10', '11']);
  s = Q.advance(Q.markItem(s, 1, 'published'));
  assert.equal(s.items[0].knownIds, null);
});

test('setKnownIds : écrit une seule fois par demande, seulement pour la courante', () => {
  const s = three();
  assert.equal(Q.setKnownIds(s, 2, [1]), s, 'pas la courante');
  const a = Q.setKnownIds(s, 1, [5, 5, '6']);
  assert.deepEqual(a.items[0].knownIds, ['5', '6']);
  assert.equal(Q.setKnownIds(a, 1, [99]), a, 'déjà relevés : conservés');
});

test('pause et reprise : la reprise rouvre la demande courante', () => {
  const s = three();
  const p = Q.pause(s, 'tabClosed');
  assert.equal(p.status, 'paused');
  assert.equal(p.pauseReason, 'tabClosed');
  assert.equal(Q.pause(p, 'wrongPage'), p, 'déjà en pause : la première raison reste');
  assert.equal(Q.currentItem(p).id, 1);
  const r = Q.resume(p);
  assert.equal(r.status, 'running');
  assert.equal(r.pauseReason, null);
  assert.equal(r.index, 0);
  assert.equal(Q.resume(s), s, 'pas en pause : inchangé');
});

test('reprise après une pause entre deux demandes : on passe à la suivante', () => {
  const s = Q.pause(Q.markItem(three(), 1, 'published', { now: 1 }), 'tabClosed');
  const r = Q.resume(s);
  assert.equal(r.status, 'running');
  assert.equal(r.index, 1);
  assert.deepEqual(statuses(r), ['published', 'current', 'pending']);
});

test('reprise d’une dernière demande déjà réglée : la session se termine', () => {
  const one = Q.createSession([req(1)], { now: 1, id: 'S' });
  const r = Q.resume(Q.pause(Q.markItem(one, 1, 'published'), 'restart'));
  assert.equal(r.status, 'finished');
});

test('setTab et setUser : sans effet inutile', () => {
  const s = three();
  const t = Q.setTab(s, 7);
  assert.equal(t.tabId, 7);
  assert.equal(Q.setTab(t, 7), t);
  assert.equal(Q.setUser(s, null), s);
  const u = Q.setUser(s, 'laboiteare');
  assert.equal(u.user, 'laboiteare');
  assert.equal(Q.setUser(u, 'laboiteare'), u);
});

test('stop : la demande en cours redevient « à venir » et compte dans les non traitées', () => {
  let s = Q.advance(Q.markItem(three(), 1, 'published', { now: 1 }));
  s = Q.stop(s, { now: 50 });
  assert.equal(s.status, 'stopped');
  assert.equal(s.finishedAt, 50);
  assert.deepEqual(statuses(s), ['published', 'pending', 'pending']);
  const sum = Q.summary(s);
  assert.equal(sum.published, 1);
  assert.equal(sum.remaining, 2);
  assert.equal(Q.isActive(s), false);
  assert.equal(Q.stop(s), s, 'déjà arrêtée');
  assert.equal(Q.pause(s, 'x'), s, 'arrêtée : pas de pause');
});

test('summary : tous les statuts', () => {
  let s = three();
  s = Q.advance(Q.markItem(s, 1, 'alreadyAnswered'));
  s = Q.advance(Q.markItem(s, 2, 'error', { note: 'formulaire absent' }));
  assert.deepEqual(Q.summary(s), { total: 3, published: 0, skipped: 0, alreadyAnswered: 1, error: 1, done: 2, remaining: 1 });
  assert.equal(Q.summary(null).total, 0);
});

test('antiFloodWaitMs : décompte depuis la dernière publication', () => {
  assert.equal(Q.antiFloodWaitMs(null, 10000, 15000), 0);
  assert.equal(Q.antiFloodWaitMs(1000, 4000, 15000), 12000);
  assert.equal(Q.antiFloodWaitMs(1000, 16000, 15000), 0);
  assert.equal(Q.antiFloodWaitMs(1000, 99000, 15000), 0);
});
