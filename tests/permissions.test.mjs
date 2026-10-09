// Permission d'hôte make.wordpress.org (lib/permissions.js). Lancer : node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  permissionState, hasSitePermission, isNetworkError, describeCheckError, NETWORK_HINT,
  isFirefoxManifest, currentIsFirefox, permissionWhere, deniedText, missingStartError, originsTouchSite,
} from '../lib/permissions.js';
import { SITE_ORIGINS } from '../lib/config.js';

const FF_MANIFEST = { browser_specific_settings: { gecko: { id: 'x@y' } } };

test('consigne selon le navigateur : Firefox → about:addons, Chrome → chrome://extensions', () => {
  assert.equal(isFirefoxManifest(FF_MANIFEST), true);
  assert.equal(isFirefoxManifest({ name: 'x' }), false);
  assert.equal(isFirefoxManifest(undefined), false);
  assert.equal(permissionWhere(true), 'about:addons → Polyglots FR → Permissions');
  assert.equal(permissionWhere(false), 'chrome://extensions → Polyglots FR → Détails → Accès aux sites');
  assert.match(deniedText(true), /^Accès refusé : tu peux aussi l’activer dans about:addons → Polyglots FR → Permissions\.$/);
  assert.match(deniedText(false), /chrome:\/\/extensions → Polyglots FR → Détails → Accès aux sites\.$/);
  assert.match(missingStartError(true), /about:addons → Polyglots FR → Permissions\)\.$/);
  assert.match(missingStartError(false), /Détails → Accès aux sites\)\.$/);
  assert.match(missingStartError(false), /« Autoriser l’accès »/);
});

test('currentIsFirefox : lit le manifeste de l’extension, sans exception', () => {
  assert.equal(currentIsFirefox({ runtime: { getManifest: () => FF_MANIFEST } }), true);
  assert.equal(currentIsFirefox({ runtime: { getManifest: () => ({}) } }), false);
  assert.equal(currentIsFirefox({ runtime: { getManifest: () => { throw new Error('x'); } } }), false);
  assert.equal(currentIsFirefox(undefined), false);
});

test('originsTouchSite : seuls les événements qui recoupent make.wordpress.org relancent une vérification', () => {
  const site = ['https://make.wordpress.org/*'];
  assert.equal(originsTouchSite({ origins: ['https://make.wordpress.org/*'] }, site), true);
  assert.equal(originsTouchSite({ origins: ['<all_urls>'] }, site), true);
  assert.equal(originsTouchSite({ origins: ['*://*.wordpress.org/*'] }, site), true);
  assert.equal(originsTouchSite({ origins: ['https://make.wordpress.org/polyglots/*'] }, site), true);
  assert.equal(originsTouchSite({ origins: ['https://example.com/*', 'https://make.wordpress.org/*'] }, site), true);
  assert.equal(originsTouchSite({ origins: ['https://example.com/*'] }, site), false);
  assert.equal(originsTouchSite({ origins: ['https://wordpress.org/*'] }, site), false);
  assert.equal(originsTouchSite({ origins: ['http://make.wordpress.org/*'] }, site), false, 'autre schéma');
  assert.equal(originsTouchSite({ origins: [] }, site), false);
  assert.equal(originsTouchSite({ permissions: ['tabs'] }, site), false, 'permissions d’API seulement');
  assert.equal(originsTouchSite(undefined, site), true, 'événement illisible : par prudence');
});

test('SITE_ORIGINS : même valeur que host_permissions du manifeste', async () => {
  const { readFile } = await import('node:fs/promises');
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(SITE_ORIGINS, manifest.host_permissions);
});

test('permissionState : seul un false explicite signale l’absence', () => {
  assert.equal(permissionState(false), 'missing');
  assert.equal(permissionState(true), 'granted');
  assert.equal(permissionState(undefined), 'granted');
  assert.equal(permissionState(null), 'granted');
  assert.equal(permissionState('non'), 'granted');
});

test('hasSitePermission : interroge permissions.contains avec les origines du site', async () => {
  let asked = null;
  const api = { permissions: { contains: async (q) => { asked = q; return false; } } };
  assert.equal(await hasSitePermission(api, SITE_ORIGINS), false);
  assert.deepEqual(asked, { origins: ['https://make.wordpress.org/*'] });
  assert.equal(await hasSitePermission({ permissions: { contains: async () => true } }, SITE_ORIGINS), true);
});

test('hasSitePermission : détection défensive (API absente ou en erreur → accordée)', async () => {
  assert.equal(await hasSitePermission(undefined, SITE_ORIGINS), true);
  assert.equal(await hasSitePermission({}, SITE_ORIGINS), true);
  assert.equal(await hasSitePermission({ permissions: {} }, SITE_ORIGINS), true);
  assert.equal(await hasSitePermission({ permissions: { contains: async () => { throw new Error('x'); } } }, SITE_ORIGINS), true);
});

test('isNetworkError : messages réseau des navigateurs', () => {
  assert.equal(isNetworkError('NetworkError when attempting to fetch resource.'), true);
  assert.equal(isNetworkError('TypeError: Failed to fetch'), true);
  assert.equal(isNetworkError('Load failed'), true);
  assert.equal(isNetworkError('HTTP 500 pour https://make.wordpress.org/…'), false);
  assert.equal(isNetworkError('Délai dépassé (15 s) pour …'), false);
  assert.equal(isNetworkError(undefined), false);
});

test('describeCheckError : la piste « bloqueur » n’est ajoutée qu’aux erreurs réseau', () => {
  const net = describeCheckError('NetworkError when attempting to fetch resource.');
  assert.ok(net.startsWith('Dernière vérification en échec : NetworkError'));
  assert.ok(net.endsWith(NETWORK_HINT));
  assert.match(net, /uBlock/);
  assert.equal(describeCheckError('HTTP 500 pour x'), 'Dernière vérification en échec : HTTP 500 pour x');
});
