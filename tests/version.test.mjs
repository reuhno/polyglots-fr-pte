// Notification système « nouvelle version » : décision pure (lib/version.js). Lancer : node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldNotifyUpdate, checkForUpdate } from '../lib/version.js';

test('shouldNotifyUpdate : version plus récente jamais notifiée → oui', () => {
  assert.equal(shouldNotifyUpdate({ status: 'ok', latest: '0.2.1', newer: true }, null), true);
  assert.equal(shouldNotifyUpdate({ status: 'ok', latest: '0.2.1', newer: true }), true);
  assert.equal(shouldNotifyUpdate({ status: 'ok', latest: '0.2.1', newer: true }, '0.2.0'), true, 'une autre version a été notifiée avant');
});

test('shouldNotifyUpdate : même version déjà notifiée → non', () => {
  assert.equal(shouldNotifyUpdate({ status: 'ok', latest: '0.2.1', newer: true }, '0.2.1'), false);
});

test('shouldNotifyUpdate : pas plus récente → non', () => {
  assert.equal(shouldNotifyUpdate({ status: 'ok', latest: '0.2.0', newer: false }, null), false);
});

test('shouldNotifyUpdate : statut error ou unavailable, ou résultat absent → non', () => {
  assert.equal(shouldNotifyUpdate({ status: 'error', httpStatus: 500 }, null), false);
  assert.equal(shouldNotifyUpdate({ status: 'unavailable', httpStatus: 404 }, null), false);
  assert.equal(shouldNotifyUpdate({ status: 'error', newer: true, latest: '9.9.9' }, null), false);
  assert.equal(shouldNotifyUpdate(null, null), false);
  assert.equal(shouldNotifyUpdate(undefined, '0.2.1'), false);
  assert.equal(shouldNotifyUpdate({ status: 'ok', newer: true }, null), false, 'version distante absente');
});

test('shouldNotifyUpdate avec checkForUpdate : de bout en bout sur une release simulée', async () => {
  const fetchFn = async () => ({ ok: true, status: 200, json: async () => ({ tag_name: 'v0.2.1' }) });
  const res = await checkForUpdate({ url: 'x', localVersion: '0.2.0', fetchFn });
  assert.equal(shouldNotifyUpdate(res, null), true);
  assert.equal(shouldNotifyUpdate(res, res.latest), false);
  const same = await checkForUpdate({ url: 'x', localVersion: '0.2.1', fetchFn });
  assert.equal(shouldNotifyUpdate(same, null), false);
});
