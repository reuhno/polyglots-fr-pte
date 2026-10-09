import { api, getLocal, getSettings } from '../lib/settings.js';
import { RELEASES_URL } from '../lib/config.js';

const $ = (id) => document.getElementById(id);
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

function renderUpdate(update) {
  const box = $('update');
  box.replaceChildren();
  // Dépôt absent (404) ou vérification en échec : pas de bandeau.
  if (!update || update.status !== 'ok' || !update.newer) {
    box.hidden = true;
    return;
  }
  box.append(
    el('p', {}, el('strong', { text: `Nouvelle version disponible : ${update.latest}` }), ` (installée : ${update.localVersion}).`),
    el('p', {}, el('a', { href: RELEASES_URL, target: '_blank', rel: 'noopener', text: 'Ouvrir la page de téléchargement' }),
      '. Télécharge le zip de ton navigateur (Chrome ou Firefox), remplace le dossier de l’extension par son contenu, puis clique sur ↻ dans chrome://extensions (Chrome) ou recharge le module (Firefox).'),
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

// `fallbackDays` : fenêtre des réglages, à défaut de celle de l'état. `failed` : la dernière demande de vérification a échoué.
function renderList(state, fallbackDays, failed) {
  const list = $('list');
  list.replaceChildren();
  const reqs = state?.requests || [];
  $('checked').textContent = '';
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
  $('summary').textContent = reqs.length
    ? `${reqs.length} demande${reqs.length > 1 ? 's' : ''} sans réponse de l’équipe FR (${period}).`
    : `Aucune demande sans réponse sur ${days ? `les ${period}` : 'la période surveillée'}.`;
  for (const r of reqs) {
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
      el('li', {}, el('a', { className: 'title', href: r.link, target: '_blank', rel: 'noopener', text: r.title || `Demande ${r.id}` }), meta),
    );
  }
  $('checked').textContent = state.checkedAt ? `Vérifié ${relative(new Date(state.checkedAt).toISOString())}` : '';
}

// `failure` : erreur renvoyée par l'arrière-plan à la dernière demande, prioritaire sur celle de l'état.
function renderError(state, failure) {
  const box = $('error');
  const error = failure || state?.error;
  if (error) {
    box.textContent = `Dernière vérification en échec : ${error}`;
    box.hidden = false;
  } else {
    box.hidden = true;
  }
}

async function render(failure = null) {
  const { state, update } = await getLocal(['state', 'update']);
  const fallbackDays = await getSettings().then((s) => s.windowDays, () => null);
  await renderTeamMissing();
  renderUpdate(update);
  renderError(state, failure);
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
  if (!state || Date.now() - (state.checkedAt || 0) > 10 * 60 * 1000) refresh();
});
