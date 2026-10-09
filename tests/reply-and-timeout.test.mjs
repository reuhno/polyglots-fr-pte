// Classement d'un commentaire détecté (pseudo connecté lu ou non), reprise d'une demande armée, délais réseau.
// Lancer : node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Q from '../lib/queue.js';
import { findTeamReply, fetchComments, fetchLimits } from '../lib/requests.js';

const c = (id, author, post = 100) => ({ id, post, author, date_gmt: '2026-10-07T10:00:00' });

function jsonFetch(comments) {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => comments,
    text: async () => '',
    headers: { get: () => '1' },
  });
}

// ---------- classifyReply ----------

test('classifyReply : pseudo connecté connu, c’est le sien → publiée', () => {
  assert.deepEqual(Q.classifyReply('Moi', 'moi'), { status: 'published', by: 'moi', note: null });
});

test('classifyReply : pseudo connecté connu, un autre membre → déjà répondue', () => {
  assert.deepEqual(Q.classifyReply('moi', 'wolforg'), {
    status: 'alreadyAnswered', by: 'wolforg', note: 'déjà répondue par @wolforg',
  });
});

test('classifyReply : pseudo connecté non lu → publiée, la note le dit (jamais « déjà répondue »)', () => {
  const v = Q.classifyReply(null, 'wolforg');
  assert.equal(v.status, 'published');
  assert.equal(v.by, 'wolforg');
  assert.match(v.note, /pseudo connecté non lu/);
  assert.match(v.note, /@wolforg/);
  assert.equal(Q.classifyReply('', 'x').status, 'published');
});

test('classifyReply appliqué à la session : publiée date l’anti-flood, déjà répondue non', () => {
  const s = Q.createSession([{ id: 1 }, { id: 2 }], { now: 1, id: 'S' });
  const v = Q.classifyReply(null, 'moi');
  const p = Q.markItem(s, 1, v.status, { now: 5000, by: v.by, note: v.note });
  assert.equal(p.items[0].status, 'published');
  assert.equal(p.lastPublishedAt, 5000);
  const a = Q.classifyReply('moi', 'wolforg');
  const q2 = Q.markItem(s, 1, a.status, { now: 5000, by: a.by, note: a.note });
  assert.equal(q2.items[0].status, 'alreadyAnswered');
  assert.equal(q2.lastPublishedAt, null);
});

// ---------- reprise d'une demande armée (règle de queueCheck) ----------

test('reprise d’une demande armée : équipe + utilisateur, seulement les commentaires absents des ids connus', async () => {
  // Demande armée avec les ids ['1'] ; le commentaire 50 (de « moi », hors équipe) a été publié pendant la pause.
  const fetchFn = jsonFetch([c(1, 7), c(50, 12)]);
  const cache = { slugById: { 7: 'tiers', 12: 'moi' } };
  const armee = await findTeamReply({
    post: 100, accept: ['wolforg', 'moi'], knownCommentIds: ['1'], cache, fetchFn,
  });
  assert.equal(armee.found, true);
  assert.equal(armee.by, 'moi');
  assert.equal(Q.classifyReply('moi', armee.by).status, 'published');
  // Vérification préalable (jamais armée) : équipe seule, le commentaire de « moi » ne compte pas.
  const jamais = await findTeamReply({ post: 100, accept: ['wolforg'], cache, fetchFn });
  assert.equal(jamais.found, false);
  // Armée, sans nouveau commentaire : rien (un commentaire d'équipe antérieur à l'armement est ignoré).
  const fetchAncien = jsonFetch([c(1, 9)]);
  const rien = await findTeamReply({
    post: 100, accept: ['fxbenard', 'moi'], knownCommentIds: ['1'], cache: { slugById: { 9: 'fxbenard' } }, fetchFn: fetchAncien,
  });
  assert.equal(rien.found, false);
});

// ---------- délais réseau ----------

test('délai maximal : un fetch qui ne répond jamais fait échouer la requête avec une erreur explicite', async () => {
  const avant = fetchLimits.timeoutMs;
  fetchLimits.timeoutMs = 60;
  try {
    const t0 = Date.now();
    await assert.rejects(fetchComments([100], () => new Promise(() => {})), /Délai dépassé/);
    assert.ok(Date.now() - t0 < 1000);
    await assert.rejects(
      findTeamReply({ post: 100, accept: ['x'], knownCommentIds: [], fetchFn: () => new Promise(() => {}) }),
      /Délai dépassé/,
    );
  } finally {
    fetchLimits.timeoutMs = avant;
  }
});

test('délai maximal : le corps de la réponse est aussi borné', async () => {
  const avant = fetchLimits.timeoutMs;
  fetchLimits.timeoutMs = 60;
  try {
    const fetchFn = async () => ({
      ok: true, status: 200, headers: { get: () => '1' }, json: () => new Promise(() => {}),
    });
    await assert.rejects(fetchComments([100], fetchFn), /Délai dépassé/);
  } finally {
    fetchLimits.timeoutMs = avant;
  }
});

test('annulation par l’appelant (AbortSignal) : la requête échoue tout de suite', async () => {
  const controller = new AbortController();
  const p = findTeamReply({
    post: 100, accept: ['x'], knownCommentIds: [], fetchFn: () => new Promise(() => {}), signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 20);
  const t0 = Date.now();
  await assert.rejects(p, /annulée/);
  assert.ok(Date.now() - t0 < 1000);
  // Signal déjà annulé : refus immédiat, sans appeler fetch.
  let called = false;
  await assert.rejects(
    findTeamReply({ post: 100, accept: ['x'], knownCommentIds: [], fetchFn: async () => { called = true; }, signal: controller.signal }),
    /annulée/,
  );
  assert.equal(called, false);
});

test('le fetch reçoit un signal d’annulation et les requêtes normales ne sont pas gênées', async () => {
  let signalSeen = null;
  const fetchFn = async (url, init) => {
    signalSeen = init.signal;
    return jsonFetch([c(1, 7)])();
  };
  const out = await fetchComments([100], fetchFn);
  assert.equal(out.length, 1);
  assert.ok(signalSeen && typeof signalSeen.aborted === 'boolean');
});
