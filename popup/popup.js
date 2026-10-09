import { api, getLocal, setLocal, getSettings } from '../lib/settings.js';
import { RELEASES_URL, SITE_ORIGINS } from '../lib/config.js';
import { hasSitePermission, describeCheckError } from '../lib/permissions.js';
import { mountPermissionBanner } from '../lib/permission-banner.js';
import { sortRequests } from '../lib/queue.js';
import { isSignedFirefoxInstall } from '../lib/version.js';

const $ = (id) => document.getElementById(id);

// Bandeau « Autoriser l'accès » : le clic appelle permissions.request directement (voir lib/permission-banner.js).
// Sous Firefox la popup peut se fermer pendant la demande : l'écouteur permissions.onAdded de l'arrière-plan prend le relais.
const permissionBanner = mountPermissionBanner($('permission'), {
  extApi: api,
  origins: SITE_ORIGINS,
  onGranted: () => refresh(),
});

// Tri de la liste, mémorisé dans storage.local (clé `popupSort`) : 'oldest' (défaut : les plus anciennes sont les
// plus prioritaires) ou 'newest'. Lecture et écriture ne bloquent jamais l'affichage.
let sortMode = 'oldest';
let sortLoaded = false;

async function loadSort() {
  try {
    const { popupSort } = await getLocal('popupSort');
    return popupSort === 'newest' ? 'newest' : 'oldest';
  } catch {
    return 'oldest';
  }
}

async function saveSort(mode) {
  try {
    await setLocal({ popupSort: mode });
  } catch { /* le choix ne sera pas mémorisé : sans importance */ }
}

function renderSortButton() {
  const btn = $('sort');
  const next = sortMode === 'oldest' ? 'Plus récentes d’abord' : 'Plus anciennes d’abord';
  const current = sortMode === 'oldest' ? 'plus anciennes d’abord' : 'plus récentes d’abord';
  btn.title = `Tri actuel : ${current}. Cliquer pour : ${next.toLowerCase()}`;
  btn.setAttribute('aria-label', btn.title);
}
const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });
const dtf = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'short' });

function relative(iso) {
  const diffSec = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diffSec);
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  return rtf.format(Math.round(diffSec / 86400), 'day');
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'text') node.textContent = v;
    else if (k in node) node[k] = v;
    else node.setAttribute(k, v);
  }
  node.append(...children);
  return node;
}

// `signed` : installation Firefox par le .xpi signé (mises à jour automatiques), voir isSignedFirefoxInstall.
function renderUpdate(update, signed = false) {
  const box = $('update');
  box.replaceChildren();
  // Dépôt absent (404) ou vérification en échec : pas de bandeau.
  if (!update || update.status !== 'ok' || !update.newer) {
    box.hidden = true;
    return;
  }
  box.append(
    el('p', {}, el('strong', { text: `Nouvelle version disponible : ${update.latest}` }), ` (installée : ${update.localVersion}).`),
    signed
      ? el('p', { text: 'Firefox installera la nouvelle version tout seul (ou : menu Modules, roue dentée, « Rechercher des mises à jour »).' })
      : el('p', {}, el('a', { href: RELEASES_URL, target: '_blank', rel: 'noopener', text: 'Ouvrir la page de téléchargement' }),
        '. Chrome : télécharge le zip, remplace le dossier de l’extension par son contenu, puis clique sur ↻ dans chrome://extensions. Firefox : installe le .xpi signé de cette page (il se mettra à jour tout seul) ; avec un module temporaire, recharge le zip.'),
  );
  box.hidden = false;
}

// Liste d'équipe vide : aucune demande ne peut être jugée répondue, la liste est donc trop longue.
async function renderTeamMissing() {
  let empty = false;
  try {
    empty = (await getSettings()).team.length === 0;
  } catch { /* réglages illisibles : pas de bandeau */ }
  $('team-missing').hidden = !empty;
}

// Ignorer ou rétablir (réversible, sans confirmation). La liste des ignorées n'est écrite que par l'arrière-plan
// (message `ignore` / `unignore`, qui met aussi à jour l'état local et le badge) ; la popup relit l'état tout de suite,
// puis demande la vérification complète et relit de nouveau.
async function changeIgnored(message) {
  try {
    await api.runtime.sendMessage({ ...message, noRefresh: true });
  } catch { /* la vérification complète ci-dessous rétablit un affichage cohérent */ }
  await render();
  try {
    await api.runtime.sendMessage({ type: 'refresh', fresh: true });
  } catch { /* l'arrière-plan se réveille ; l'état sera relu */ }
  await render();
}

// Section repliable « Ignorées (N) » : les demandes ignorées encore dans la fenêtre surveillée.
function renderIgnored(state) {
  const box = $('ignored-box');
  const items = state?.ignoredList || [];
  box.hidden = items.length === 0;
  $('ignored-summary').textContent = `Ignorées (${items.length})`;
  $('ignored-list').replaceChildren(...sortRequests(items).reverse().map((r) =>
    el('li', {},
      el('div', { className: 'row-main' },
        el('a', { className: 'title', href: r.link, target: '_blank', rel: 'noopener', text: r.title || `Demande ${r.id}` })),
      el('button', {
        type: 'button',
        className: 'row-btn',
        text: 'Rétablir',
        title: 'Afficher de nouveau cette demande',
        onclick: () => changeIgnored({ type: 'unignore', postId: r.id }),
      }))));
}

// `fallbackDays` : fenêtre des réglages, à défaut de celle de l'état. `failed` : la dernière demande de vérification a échoué.
function renderList(state, fallbackDays, failed) {
  const list = $('list');
  list.replaceChildren();
  $('ignored-box').hidden = true;
  const reqs = state?.requests || [];
  $('checked').textContent = '';
  // Bouton de la file de réponse : seulement quand une vérification a abouti et qu'il y a des demandes.
  const queueBtn = $('queue-start');
  queueBtn.hidden = !(state?.checkedAt && reqs.length > 0);
  queueBtn.textContent = `Répondre en file (${reqs.length})`;
  if (!state) {
    $('summary').textContent = failed ? 'Aucune vérification n’a encore abouti.' : 'Première vérification en cours…';
    return;
  }
  // Aucune vérification réussie (la première a échoué) : on ne peut pas affirmer qu'il n'y a aucune demande.
  if (!state.checkedAt) {
    $('summary').textContent = 'Aucune vérification n’a encore abouti.';
    return;
  }
  const days = state.windowDays ?? fallbackDays;
  const period = days ? `${days} derniers jours` : 'période surveillée';
  // Demandes dont la ligne de tâche #fr_FR est barrée : masquées, mais signalées discrètement.
  const struck = Number(state.struck) || 0;
  const struckNote = struck > 0 ? ` (${struck} barrée${struck > 1 ? 's' : ''} masquée${struck > 1 ? 's' : ''})` : '';
  $('summary').textContent = (reqs.length
    ? `${reqs.length} demande${reqs.length > 1 ? 's' : ''} sans réponse de l’équipe FR (${period}).`
    : `Aucune demande sans réponse sur ${days ? `les ${period}` : 'la période surveillée'}.`) + struckNote;
  const ordered = sortMode === 'oldest' ? sortRequests(reqs) : sortRequests(reqs).reverse();
  for (const r of ordered) {
    const meta = el('div', { className: 'meta' });
    meta.append(
      el('span', { text: relative(r.date), title: dtf.format(new Date(r.date)) }),
      ' · par ',
      r.authorSlug
        ? el('a', { href: `https://profiles.wordpress.org/${encodeURIComponent(r.authorSlug)}/`, target: '_blank', rel: 'noopener', text: `@${r.authorSlug}` })
        : el('span', { text: 'pseudo inconnu' }),
      ` · ${r.commentCount} commentaire${r.commentCount > 1 ? 's' : ''}`,
    );
    if (r.uncertain) {
      meta.append(' · ', el('span', { className: 'flag', text: 'à vérifier', title: 'Un commentateur n’a pas pu être identifié' }));
    }
    list.append(
      el('li', {},
        el('div', { className: 'row-main' },
          el('a', { className: 'title', href: r.link, target: '_blank', rel: 'noopener', text: r.title || `Demande ${r.id}` }), meta),
        el('button', {
          type: 'button',
          className: 'row-btn',
          text: 'Ignorer',
          title: 'Ne plus afficher cette demande',
          onclick: () => changeIgnored({
            type: 'ignore', postId: r.id, link: r.link, title: r.title, authorSlug: r.authorSlug, date: r.date,
          }),
        })),
    );
  }
  renderIgnored(state);
  $('checked').textContent = state.checkedAt ? `Vérifié ${relative(new Date(state.checkedAt).toISOString())}` : '';
}

// `failure` : erreur renvoyée par l'arrière-plan à la dernière demande, prioritaire sur celle de l'état.
// `missing` : permission d'hôte absente. Le bandeau de permission suffit alors, pas d'erreur réseau en plus.
function renderError(state, failure, missing = false) {
  const box = $('error');
  const error = missing ? null : failure || state?.error;
  if (error) {
    box.textContent = describeCheckError(error); // erreur réseau avec permission accordée : piste « bloqueur »
    box.hidden = false;
  } else {
    box.hidden = true;
  }
}

async function render(failure = null) {
  const { state, update } = await getLocal(['state', 'update']);
  if (!sortLoaded) {
    sortMode = await loadSort(); // une seule fois : le basculement en cours reste valable même si l'écriture échoue
    sortLoaded = true;
  }
  renderSortButton();
  const fallbackDays = await getSettings().then((s) => s.windowDays, () => null);
  await renderTeamMissing();
  renderUpdate(update, await isSignedFirefoxInstall(api));
  // Permission d'hôte : absente d'après le navigateur (relu à chaque ouverture) ou d'après le dernier état enregistré.
  const missing = !(await hasSitePermission(api, SITE_ORIGINS)) || state?.missingPermission === true;
  permissionBanner.show(missing);
  renderError(state, failure, missing);
  renderList(state, fallbackDays, !!failure);
}

async function refresh() {
  $('refresh').disabled = true;
  $('summary').textContent = 'Vérification en cours…';
  let failure = null;
  try {
    const res = await api.runtime.sendMessage({ type: 'refresh' });
    if (res && res.error) failure = String(res.error);
  } catch { /* l'arrière-plan se réveille ; l'état sera relu */ }
  $('refresh').disabled = false;
  await render(failure);
}

$('refresh').addEventListener('click', refresh);
$('sort').addEventListener('click', async () => {
  sortMode = sortMode === 'oldest' ? 'newest' : 'oldest';
  renderSortButton();
  await saveSort(sortMode);
  render();
});
$('queue-start').addEventListener('click', async () => {
  await api.tabs.create({ url: api.runtime.getURL('queue/queue.html') });
  window.close();
});
function openOptions(e) {
  if (e) e.preventDefault();
  api.runtime.openOptionsPage();
  window.close();
}
$('options').addEventListener('click', openOptions);
$('team-missing-link').addEventListener('click', openOptions);

render().then(async () => {
  const { state } = await getLocal('state');
  // Données absentes ou vieilles de plus de 10 min : relancer une vérification.
  if (!state || state.missingPermission || Date.now() - (state.checkedAt || 0) > 10 * 60 * 1000) refresh();
});
