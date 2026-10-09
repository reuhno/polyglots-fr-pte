// Page de la file de réponse : sélection des demandes, session en cours, bilan, reprise.
// La session est pilotée par l'arrière-plan ; cette page l'affiche (storage.onChanged) et lui envoie des ordres.
import { api, getLocal, ignoreRequest } from '../lib/settings.js';
import * as Q from '../lib/queue.js';

const $ = (id) => document.getElementById(id);
const dtf = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });

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

const STATUS_LABELS = {
  pending: 'à venir',
  current: 'en cours',
  published: 'publiée',
  skipped: 'passée',
  alreadyAnswered: 'déjà répondue',
  error: 'erreur',
};

const PAUSE_REASONS = {
  tabClosed: 'L’onglet de travail a été fermé.',
  wrongPage: 'L’onglet de travail affiche une autre page que la demande en cours.',
  noHello: 'La page de la demande n’a pas répondu (autre page, page non chargée, ou extension rechargée).',
  restart: 'Le navigateur ou l’extension a redémarré.',
  tabError: 'L’onglet de travail n’a pas pu être ouvert.',
};

// Sélection en cours de saisie : conservée quand l’état est rafraîchi (toutes les 30 minutes, ou à la main).
const selected = new Set();
const seen = new Set();
let newSelection = false; // l’utilisateur a quitté le bilan pour choisir d’autres demandes

function showError(text) {
  const box = $('error');
  box.textContent = text || '';
  box.hidden = !text;
}

async function order(msg) {
  showError('');
  let res = null;
  try {
    res = await api.runtime.sendMessage(msg);
  } catch { /* l’arrière-plan se réveille ou ne répond pas */ }
  if (!res) showError('L’extension ne répond pas. Recharge cette page.');
  else if (res.ok === false) showError(res.error || 'Action impossible (la file a peut-être changé).');
  return res;
}

// ---------- sélection ----------

// Ignorer une demande (réversible depuis la popup, section « Ignorées ») : retirée tout de suite de la liste et du badge,
// puis vérification complète demandée à l'arrière-plan.
async function ignore(request) {
  selected.delete(request.id);
  try {
    await ignoreRequest(request);
  } catch (e) {
    showError(`Impossible d’ignorer cette demande : ${(e && e.message) || e}`);
  }
  await render();
  try {
    await api.runtime.sendMessage({ type: 'refresh', fresh: true });
  } catch { /* l’arrière-plan se réveille ; l’état sera relu */ }
}

function syncSelection(requests) {
  const defaults = Q.defaultSelection(requests);
  const ids = new Set(requests.map((r) => r.id));
  for (const r of requests) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    if (defaults.has(r.id)) selected.add(r.id);
  }
  for (const id of [...selected]) if (!ids.has(id)) selected.delete(id);
}

function renderSelection(state) {
  const root = $('root');
  const requests = Q.sortRequests(state?.requests || []);
  syncSelection(requests);
  root.replaceChildren();

  if (!requests.length) {
    root.append(el('p', { text: 'Aucune demande sans réponse de l’équipe FR pour le moment.' }));
    return;
  }

  const start = el('button', { type: 'button', className: 'primary' });
  const refreshStart = () => {
    start.textContent = `Commencer (${selected.size})`;
    start.disabled = selected.size === 0;
  };
  const boxes = [];
  const setAll = (on) => {
    for (const { box, id } of boxes) {
      box.checked = on;
      if (on) selected.add(id);
      else selected.delete(id);
    }
    refreshStart();
  };

  root.append(
    el('p', { text: `${requests.length} demande${requests.length > 1 ? 's' : ''} sans réponse, de la plus ancienne à la plus récente. Les demandes « à vérifier » (un commentateur n’a pas pu être identifié) ne sont pas cochées.` }),
    el('div', { className: 'toolbar' },
      el('button', { type: 'button', text: 'Tout', onclick: () => setAll(true) }),
      el('button', { type: 'button', text: 'Rien', onclick: () => setAll(false) }),
      el('span', { className: 'spacer' }),
      start),
  );

  const list = el('ul', { className: 'list' });
  for (const r of requests) {
    const box = el('input', { type: 'checkbox', id: `req-${r.id}`, checked: selected.has(r.id) });
    box.addEventListener('change', () => {
      if (box.checked) selected.add(r.id);
      else selected.delete(r.id);
      refreshStart();
    });
    boxes.push({ box, id: r.id });
    const meta = el('div', { className: 'meta' }, dtf.format(new Date(r.date)), ` · par ${r.authorSlug ? `@${r.authorSlug}` : 'pseudo inconnu'}`, ` · ${r.commentCount} commentaire${r.commentCount > 1 ? 's' : ''}`);
    if (r.uncertain) meta.append(' · ', el('span', { className: 'flag', text: 'à vérifier', title: 'Un commentateur n’a pas pu être identifié' }));
    list.append(el('li', {}, box,
      el('label', { className: 'body', htmlFor: box.id },
        el('span', { className: 'title', text: r.title || `Demande ${r.id}` }), meta),
      el('button', {
        type: 'button',
        className: 'row-btn',
        text: 'Ignorer',
        title: 'Ne plus afficher cette demande',
        onclick: () => ignore(r),
      })));
  }
  root.append(list);

  start.addEventListener('click', async () => {
    start.disabled = true;
    // L’ordre de la file est celui de la liste (le plus ancien d’abord) ; l’arrière-plan relit l’état.
    const res = await order({ type: 'queue:start', ids: requests.filter((r) => selected.has(r.id)).map((r) => r.id) });
    if (res && res.ok) newSelection = false;
    refreshStart();
  });
  refreshStart();
}

// ---------- session et bilan ----------

function itemsList(session) {
  const list = el('ul', { className: 'list' });
  session.items.forEach((it, i) => {
    const current = Q.isActive(session) && i === session.index;
    const meta = el('div', { className: 'meta' }, it.author ? `@${it.author}` : 'pseudo inconnu');
    if (it.note) meta.append(` · ${it.note}`);
    list.append(el('li', { className: current ? 'current' : '' },
      el('div', { className: 'body' },
        el('a', { className: 'title', href: it.link, target: '_blank', rel: 'noopener', text: it.title }), meta),
      el('span', { className: 'badge', text: STATUS_LABELS[it.status] || it.status, 'data-status': it.status })));
  });
  return list;
}

function bilanText(session) {
  const s = Q.summary(session);
  const parts = [
    `${s.published} publiée${s.published > 1 ? 's' : ''}`,
    `${s.skipped} passée${s.skipped > 1 ? 's' : ''}`,
    `${s.alreadyAnswered} déjà répondue${s.alreadyAnswered > 1 ? 's' : ''}`,
    `${s.error} erreur${s.error > 1 ? 's' : ''}`,
  ];
  if (s.remaining) parts.push(`${s.remaining} non traitée${s.remaining > 1 ? 's' : ''}`);
  return parts.join(' · ');
}

function renderSession(session) {
  const root = $('root');
  const s = Q.summary(session);
  root.replaceChildren();
  root.append(el('h2', { text: `File en cours : ${s.done}/${s.total} traitée${s.done > 1 ? 's' : ''}` }));

  if (session.status === 'paused') {
    root.append(el('div', { className: 'banner' },
      el('p', {}, el('strong', { text: 'File en pause. ' }), PAUSE_REASONS[session.pauseReason] || 'Raison inconnue.'),
      el('p', { text: '« Reprendre » rouvre la demande en cours dans l’onglet de travail (un nouveau si l’ancien a disparu).' })));
  }

  const buttons = el('div', { className: 'toolbar' });
  if (session.status === 'paused') {
    buttons.append(el('button', {
      type: 'button',
      className: 'primary',
      text: 'Reprendre',
      onclick: () => order({ type: 'queue:resume', sessionId: session.id }),
    }));
  }
  buttons.append(el('button', {
    type: 'button',
    text: 'Arrêter',
    onclick: () => order({ type: 'queue:stop', sessionId: session.id }),
  }));
  root.append(buttons, itemsList(session));
}

function renderReport(session) {
  const root = $('root');
  root.replaceChildren(
    el('h2', { text: session.status === 'finished' ? 'File terminée' : 'File arrêtée' }),
    el('p', { className: 'bilan', text: bilanText(session) }),
    el('div', { className: 'toolbar' },
      el('button', {
        type: 'button',
        className: 'primary',
        text: 'Nouvelle sélection',
        onclick: () => { newSelection = true; render(); },
      })),
    itemsList(session),
  );
}

async function render() {
  const { queue, state } = await getLocal(['queue', 'state']);
  if (Q.isActive(queue)) {
    newSelection = false;
    renderSession(queue);
  } else if (queue && !newSelection) {
    renderReport(queue);
  } else {
    renderSelection(state);
  }
}

api.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.queue || changes.state)) render();
});

// Ouverture de la page : l'arrière-plan évalue l'échéance de sa veille (minuteur peut-être perdu), puis on affiche.
Promise.resolve(api.runtime.sendMessage({ type: 'queue:status' })).catch(() => {}).then(render);
