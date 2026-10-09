// Script de contenu : bouton « Réponse FR » sur la page d'une demande du blog Polyglots, et barre de la file de réponse.
// Il préremplit le champ de commentaire. Il ne soumet JAMAIS le formulaire : l'humain relit et publie.
// Les écouteurs posés sur le bouton d'envoi d'o2 sont passifs (ils n'accélèrent que la détection).
(() => {
  'use strict';
  const api = globalThis.browser ?? globalThis.chrome;
  const BTN_ID = 'pfr-reply-button';
  const BTNS_ID = 'pfr-buttons';
  const IGNORE_ID = 'pfr-ignore-button';
  const MSG_ID = 'pfr-reply-message';
  const BAR_ID = 'pfr-queue-bar';

  // ---------- pseudo de l'auteur de la demande ----------

  function slugFromProfileUrl(href) {
    const m = /profiles\.wordpress\.org\/([^/?#]+)/i.exec(href || '');
    return m ? decodeURIComponent(m[1]) : null;
  }

  function getMainArticle() {
    return document.querySelector('article.post[id^="post-"], article[id^="post-"], article.post');
  }

  function getAuthorSlug() {
    const article = getMainArticle();
    if (article) {
      // 1. lien de l'auteur dans l'en-tête de l'article
      const link = article.querySelector('a.entry-author[href*="profiles.wordpress.org"], a.author-avatar[href*="profiles.wordpress.org"]');
      const fromLink = slugFromProfileUrl(link && link.href);
      if (fromLink) return fromLink;
      // 2. classe « author-<pseudo> » de l'article
      const m = /(?:^|\s)author-([^\s]+)/.exec(article.className || '');
      if (m) return m[1];
      // 3. « @pseudo » de l'en-tête
      const abbr = article.querySelector('.entry-author-meta .wporg-username');
      const t = abbr && /^@?(.+)$/.exec(abbr.textContent.trim());
      if (t) return t[1];
    }
    // 4. données JSON de o2
    const data = document.querySelector('script.o2-data');
    if (data) {
      try {
        const post = JSON.parse(data.textContent).find((x) => x.type === 'post');
        if (post && post.userNicename) return post.userNicename;
      } catch { /* ignoré */ }
    }
    return null;
  }

  // Id numérique de l'article affiché (« post-<id> »), ou null.
  function getPostId() {
    const article = getMainArticle();
    const m = article && /^post-(\d+)$/.exec(article.id || '');
    return m ? Number(m[1]) : null;
  }

  // Pseudo de l'utilisateur connecté : classe « current-user-<pseudo> » de #content, à défaut lien de profil
  // de la barre d'admin.
  function getCurrentUser() {
    const content = document.getElementById('content');
    const m = content && /(?:^|\s)current-user-(\S+)/.exec(content.className || '');
    if (m) return m[1];
    const link = document.querySelector('#wp-admin-bar-my-account a[href*="profiles.wordpress.org"]');
    return slugFromProfileUrl(link && link.href);
  }

  // ---------- formulaire de commentaire ----------

  // Plusieurs sélecteurs : éditeur de réponse de o2 (P2), puis formulaire WordPress classique.
  // o2 double son champ d'un clone caché « .autosizejs » (mesure de hauteur) : à exclure.
  const TEXTAREA_SELECTORS = [
    '#respond textarea.o2-editor-text:not(.autosizejs)',
    'textarea.o2-editor-text:not(.autosizejs)',
    '#respond textarea.o2-editor',
    '#commentform textarea#comment',
    'form#commentform textarea',
    'textarea#comment',
    'textarea[name="comment"]',
    '#comments textarea.o2-editor',
    '.o2-app-new-comment textarea',
    'textarea.o2-editor',
  ];

  function isVisible(el) {
    return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  }

  function findCommentTextarea() {
    for (const sel of TEXTAREA_SELECTORS) {
      const list = [...document.querySelectorAll(sel)].filter(isVisible);
      if (list.length) return list[list.length - 1];
    }
    return null;
  }

  function findReplyOpener() {
    const candidates = document.querySelectorAll(
      'a[data-action="reply"], .o2-post-footer-actions a.genericon-reply, a.comment-reply-link',
    );
    return [...candidates].find((a) => a.dataset.action !== 'login-to-reply') || null;
  }

  function isLoggedOut() {
    return !!document.querySelector('.must-log-in, a[data-action="login-to-reply"]');
  }

  function waitForTextarea(timeoutMs) {
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        const ta = findCommentTextarea();
        if (ta) return resolve(ta);
        if (Date.now() - start > timeoutMs) return resolve(null);
        setTimeout(tick, 150);
      };
      tick();
    });
  }

  function dispatchChange(ta) {
    // Prévenir o2 / WordPress du changement, sans jamais déclencher l'envoi.
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.dispatchEvent(new Event('keyup', { bubbles: true }));
    ta.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function fillTextarea(ta, text) {
    ta.focus();
    ta.value = text;
    dispatchChange(ta);
    ta.setSelectionRange(ta.value.length, ta.value.length);
    ta.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  // Vide le champ avant de quitter la page : sans cela, le navigateur demande « quitter la page ? ».
  function clearField() {
    const ta = findCommentTextarea();
    if (ta && ta.value) {
      ta.value = '';
      dispatchChange(ta);
    }
  }

  // ---------- modèle ----------

  // Retourne { template } ou, en cas d'échec, { error } (message de l'arrière-plan) ou {} (pas de réponse).
  async function getTemplate() {
    try {
      const res = await api.runtime.sendMessage({ type: 'getSettings' });
      if (res && typeof res.template === 'string' && res.template) return { template: res.template };
      if (res && res.error) return { error: String(res.error) };
    } catch { /* l'arrière-plan ne répond pas */ }
    return {};
  }

  function applyTemplate(template, author) {
    return template.replace(/\{author\}/g, author);
  }

  // ---------- interface ----------

  function showMessage(text, kind = 'info') {
    let box = document.getElementById(MSG_ID);
    if (!box) {
      box = document.createElement('div');
      box.id = MSG_ID;
      box.setAttribute('role', 'status');
      box.setAttribute('aria-live', 'polite');
      document.body.appendChild(box);
    }
    box.textContent = text;
    box.dataset.kind = kind;
    box.hidden = false;
    clearTimeout(showMessage.timer);
    showMessage.timer = setTimeout(() => { box.hidden = true; }, 9000);
  }

  // Prépare le champ avec le modèle de réponse ; partagé par le bouton « Réponse FR » et la file.
  // `auto` (file) : pas de boîte de confirmation, un champ déjà rempli est laissé tel quel (`kept`).
  // Retourne { ok: true, ta, author, kept } ou { ok: false, message } (message null : l'utilisateur a annulé).
  async function prefill({ auto = false, fallbackAuthor = null } = {}) {
    const author = getAuthorSlug() || fallbackAuthor;
    if (!author) {
      return { ok: false, message: "Impossible de déterminer le pseudo wordpress.org de l'auteur de cette demande." };
    }
    const { template, error } = await getTemplate();
    if (!template) {
      return {
        ok: false,
        message: error
          ? `Modèle de réponse indisponible : ${error}`
          : "Modèle de réponse indisponible (l'extension ne répond pas). Recharge la page.",
      };
    }

    let ta = findCommentTextarea();
    if (!ta) {
      const opener = findReplyOpener();
      if (opener) {
        opener.click(); // ouvre l'éditeur de réponse de o2 ; ne l'envoie pas
        ta = await waitForTextarea(4000);
      }
    }
    if (!ta) {
      const retry = auto ? '' : ' puis reclique sur « Réponse FR »';
      return {
        ok: false,
        message: isLoggedOut()
          ? `Formulaire de commentaire absent : connecte-toi à WordPress.org (« Login to Reply »)${retry}.`
          : `Formulaire de commentaire introuvable sur cette page. Ouvre-le (« Reply »)${retry}.`,
      };
    }
    if (ta.value.trim()) {
      if (auto) return { ok: true, ta, author, kept: true };
      if (!window.confirm('Le champ de commentaire contient déjà du texte. Le remplacer par le modèle ?')) {
        return { ok: false, message: null };
      }
    }
    fillTextarea(ta, applyTemplate(template, author));
    return { ok: true, ta, author, kept: false };
  }

  async function onClick() {
    const r = await prefill();
    if (!r.ok) {
      if (r.message) showMessage(r.message, 'error');
      return;
    }
    showMessage(`Modèle inséré pour @${r.author}. Relis-le, puis publie toi-même : rien n'a été envoyé.`, 'ok');
  }

  // « Ignorer » hors file : la demande disparaît de l'extension (liste, badge, notifications, file). Réversible (popup,
  // section « Ignorées »). Ne touche pas au champ de commentaire.
  // Cause d'un échec : l'erreur renvoyée par l'arrière-plan si elle existe, sinon il ne répond pas.
  const failCause = (res) => (res && res.error ? res.error : "l'extension ne répond pas");

  // Après « Ignorer » réussi, le bouton devient « Rétablir », actif, comme sur une demande déjà ignorée au chargement.
  async function onIgnoreClick(btn) {
    const postId = getPostId();
    if (!postId) return;
    btn.dataset.acted = '1'; // la réponse tardive de `isIgnored` ne doit plus modifier le bouton
    btn.disabled = true;
    const wasIgnored = btn.dataset.state === 'ignored';
    try {
      let res;
      if (wasIgnored) {
        res = await send({ type: 'unignore', postId });
      } else {
        const article = getMainArticle();
        const title = article && article.querySelector('.entry-title');
        res = await send({
          type: 'ignore',
          postId,
          link: location.href.split('#')[0],
          title: title ? title.textContent.trim() : undefined,
        });
      }
      if (res && res.ok) {
        setIgnoreButton(btn, !wasIgnored);
        showMessage(
          wasIgnored
            ? 'Demande rétablie : elle réapparaîtra dans l’extension.'
            : 'Demande ignorée : elle n’apparaît plus dans l’extension. Pour la rétablir : popup, section Ignorées.',
          'ok',
        );
      } else {
        btn.disabled = false;
        showMessage(`Impossible de ${wasIgnored ? 'rétablir' : 'ignorer'} cette demande (${failCause(res)}).`, 'error');
      }
    } catch (e) {
      btn.disabled = false; // le bouton reste utilisable
      showMessage(`Impossible de ${wasIgnored ? 'rétablir' : 'ignorer'} cette demande (${(e && e.message) || e}).`, 'error');
    }
  }

  function setIgnoreButton(btn, ignored) {
    btn.dataset.state = ignored ? 'ignored' : 'idle';
    btn.disabled = false;
    btn.textContent = ignored ? 'Rétablir' : 'Ignorer';
    btn.title = ignored
      ? 'Cette demande est ignorée : la remettre dans la liste de l’extension'
      : "Ne plus afficher cette demande dans l'extension";
  }

  function injectButton() {
    if (document.getElementById(BTN_ID)) return;
    // Les deux boutons sont dans un conteneur fixe en bas à droite (qui remonte avec la barre de la file).
    const box = document.createElement('div');
    box.id = BTNS_ID;
    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.textContent = 'Réponse FR';
    btn.title = "Préremplir le commentaire avec le modèle de réponse de l'équipe FR (rien n'est envoyé)";
    btn.addEventListener('click', onClick);
    const ignoreBtn = document.createElement('button');
    ignoreBtn.id = IGNORE_ID;
    ignoreBtn.type = 'button';
    setIgnoreButton(ignoreBtn, false);
    ignoreBtn.addEventListener('click', () => onIgnoreClick(ignoreBtn));
    box.append(ignoreBtn, btn);
    document.body.appendChild(box);
    // Demande déjà ignorée ? Le bouton devient « Rétablir ».
    const postId = getPostId();
    if (postId) {
      send({ type: 'isIgnored', postId })
        .then((res) => {
          // Réponse tardive : sans effet si l'utilisateur a déjà cliqué sur le bouton.
          if (res && res.ok && res.ignored && !ignoreBtn.dataset.acted) setIgnoreButton(ignoreBtn, true);
        })
        .catch(() => { /* le bouton reste « Ignorer » */ });
    }
  }

  // Uniquement sur la page d'un article (pas sur les listes).
  function isSinglePost() {
    return document.body.classList.contains('single') || document.body.classList.contains('single-post');
  }

  // Uniquement sur un article étiqueté fr_FR : l'article porte la classe « tag-fr_fr » (vérifié sur le HTML réel),
  // et son pied d'article un lien d'étiquette « …/teams/?locale=fr_FR » (repli).
  function isFrenchRequest() {
    const article = getMainArticle();
    if (!article) return false;
    if ([...article.classList].some((c) => c.toLowerCase() === 'tag-fr_fr')) return true;
    return !!article.querySelector('a[rel="tag"][href*="locale=fr_FR" i]');
  }

  // ---------- file de réponse ----------
  // L'arrière-plan pilote la session (onglet de travail, ordre des demandes). Ce script : barre d'état, préremplissage,
  // détection de la publication. La publication elle-même reste un clic du bénévole sur le bouton d'envoi d'o2.
  // Les sélecteurs reposent sur des classes ou des ids, jamais sur un libellé (« Reply » change selon la langue du compte).

  const FINAL_STATUSES = ['published', 'skipped', 'alreadyAnswered', 'error'];
  let q = null; // état du mode file sur cette page, null hors session

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Réponse de l'arrière-plan, ou null s'il ne répond pas.
  async function send(msg) {
    try {
      return await api.runtime.sendMessage(msg);
    } catch {
      return null;
    }
  }

  const sessionMsg = (type, extra = {}) => ({ type, sessionId: q.info.sessionId, postId: q.info.postId, ...extra });

  function h(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'text') node.textContent = v;
      else if (k in node) node[k] = v;
      else node.setAttribute(k, v);
    }
    node.append(...children);
    return node;
  }

  // Commentaires rendus par o2 : « div#comment-<id>.comment.o2-comment.comment-author-<pseudo> ».
  // Le formulaire (#respond) porte aussi la classe « o2-comment » : à écarter.
  function isRealComment(n) {
    return n.id !== 'respond' && !n.classList.contains('comment-new') && !n.closest('#respond');
  }
  const commentScope = () => getMainArticle() || document;
  const realComments = (root) => [...root.querySelectorAll('.o2-comment')].filter(isRealComment);
  const commentIdOf = (n) => (/^comment-(\d+)$/.exec(n.id || '') || [])[1] || null;
  const commentAuthorOf = (n) => (/(?:^|\s)comment-author-(\S+)/.exec(n.className || '') || [])[1] || null;

  // Auteurs lus en direct dans la page connectée, pour les commentaires absents du relevé initial.
  function collectLive() {
    const live = {};
    for (const n of realComments(commentScope())) {
      const id = commentIdOf(n);
      const slug = commentAuthorOf(n);
      if (id && slug && !q.known.has(id)) live[id] = slug;
    }
    return live;
  }

  // ----- barre -----

  // La marge basse de la page suit la hauteur réelle de la barre (qui passe sur plusieurs lignes en fenêtre étroite).
  let barObserver = null;
  const syncBarHeight = () => {
    const bar = document.getElementById(BAR_ID);
    if (bar) document.documentElement.style.setProperty('--pfr-bar-h', `${bar.offsetHeight}px`);
  };

  function setBarRaw(line, text, actions = [], kind = 'info') {
    let bar = document.getElementById(BAR_ID);
    if (!bar) {
      bar = h('div', { id: BAR_ID, role: 'region', 'aria-label': 'File de réponse Polyglots FR' },
        h('div', { className: 'pfr-bar-text' }, h('strong', { className: 'pfr-bar-line' }), h('span', { className: 'pfr-bar-detail', 'aria-live': 'polite' })),
        h('div', { className: 'pfr-bar-actions' }));
      document.body.appendChild(bar);
      if (typeof ResizeObserver === 'function') {
        barObserver = new ResizeObserver(syncBarHeight);
        barObserver.observe(bar);
      }
    }
    bar.dataset.kind = kind;
    bar.querySelector('.pfr-bar-line').textContent = line;
    bar.querySelector('.pfr-bar-detail').textContent = text;
    // Les boutons ne sont reconstruits que s'ils changent : le compte à rebours ne leur fait pas perdre le focus.
    const box = bar.querySelector('.pfr-bar-actions');
    const key = actions.map((a) => a.label).join('|');
    if (box.dataset.key !== key) {
      box.dataset.key = key;
      box.replaceChildren(...actions.map((a) => h('button', { type: 'button', className: a.primary ? 'pfr-primary' : '', text: a.label })));
    }
    [...box.children].forEach((btn, i) => { btn.onclick = actions[i].onClick; });
    syncBarHeight();
  }

  function floodWaitSec() {
    const last = q.info.lastPublishedAt;
    if (!last) return 0;
    return Math.max(0, Math.ceil((q.cfg.antiFloodMs - (Date.now() - last)) / 1000));
  }

  const FINAL_TEXT = {
    published: 'Déjà publiée ✓',
    alreadyAnswered: 'Déjà répondue',
    skipped: 'Demande passée',
    error: 'Erreur',
  };

  function render() {
    if (!q) return;
    const { info } = q;
    const line = `Demande ${info.index + 1}/${info.total} · ${info.author ? `@${info.author}` : 'auteur inconnu'}`;
    const stop = { label: 'Arrêter', onClick: doStop };
    const ignoreAction = { label: 'Ignorer', onClick: doIgnore };
    // Avertissement d'une action qui a échoué (avancée, arrêt, « Marquer publiée ») : ajouté au texte de la phase.
    const setBar = (l, text, actions, kind) => (
      q.alert ? setBarRaw(l, `${text} ⚠ ${q.alert}`, actions, 'warn') : setBarRaw(l, text, actions, kind)
    );
    switch (q.phase) {
      case 'preparing':
        setBar(line, 'Préparation du champ de réponse…', [stop]);
        break;
      case 'armed': {
        const wait = floodWaitSec();
        let text = wait > 0
          ? `Attends ${wait} s avant de publier. Rien n'est envoyé par l'extension.`
          : "Relis, puis publie toi-même avec le bouton d'envoi : l'extension n'envoie rien.";
        if (q.kept) text += ' Le champ contenait déjà du texte : il est conservé.';
        if (!q.user) text += " Pseudo connecté non identifié : seule l'équipe sera reconnue.";
        setBar(line, text, [{ label: 'Passer', onClick: doSkip }, ignoreAction, stop]);
        break;
      }
      case 'nodetect':
        setBar(
          line,
          'Publication non détectée : vérifie que le commentaire apparaît (modération, erreur o2).',
          [{ label: 'Marquer publiée', onClick: doMarkPublished, primary: true }, { label: 'Passer', onClick: doSkip }, ignoreAction, stop],
          'warn',
        );
        break;
      case 'published':
        setBar(line, `Publiée ✓${q.publishedNote ? ` (${q.publishedNote})` : ''} · suivante dans ${q.left} s`, [{ label: 'Rester', onClick: doStay, primary: true }, stop], 'ok');
        break;
      case 'stay':
        setBar(line, `Publiée ✓${q.publishedNote ? ` (${q.publishedNote})` : ''}`, [{ label: 'Suivante', onClick: goNext, primary: true }, stop], 'ok');
        break;
      case 'answered':
        setBar(line, `Déjà répondue par @${q.by}.`, [{ label: 'Suivante', onClick: goNext, primary: true }, stop], 'ok');
        break;
      case 'final':
        setBar(line, q.finalText, [{ label: 'Suivante', onClick: goNext, primary: true }, stop], q.finalKind || 'info');
        break;
      case 'moving':
        setBar(line, q.finalText || 'Ouverture de la suite…', []);
        break;
      case 'ended':
        setBar(line, q.finalText, [{ label: 'Fermer', onClick: closeBar }], 'warn');
        break;
      default:
    }
  }

  // Signal de vie léger : tant que la barre est active, quelle que soit sa phase, l'arrière-plan sait que la page est là.
  // Sans lui, une navigation interne d'o2 (pushState) qui provoque un « loading » dans les phases où aucune vérification
  // ne part (publiée, « Rester », erreur…) mettrait la file en pause à tort.
  function sendAlive() {
    if (q && q.info) send({ type: 'queue:hello', light: true, sessionId: q.info.sessionId, postId: q.info.postId });
  }

  function closeBar() {
    if (q) clearInterval(q.heartbeat);
    const bar = document.getElementById(BAR_ID);
    if (bar) bar.remove();
    if (barObserver) barObserver.disconnect();
    barObserver = null;
    document.documentElement.style.removeProperty('--pfr-bar-h');
    document.documentElement.classList.remove('pfr-queue-active', 'pfr-queue-live');
    q = null;
  }

  // ----- surveillance -----

  function watching() {
    return !!q && (q.phase === 'armed' || q.phase === 'nodetect');
  }

  // Prochaine vérification dans `delayMs`, sauf si une plus proche est déjà prévue.
  function scheduleCheck(delayMs) {
    const due = Date.now() + Math.max(0, delayMs);
    if (q.timer && q.dueAt <= due) return;
    clearTimeout(q.timer);
    q.dueAt = due;
    q.timer = setTimeout(() => { q.timer = null; runCheck(); }, Math.max(0, delayMs));
  }

  // Confirmation par l'arrière-plan (API). Cadence : 2 s pendant 30 s après un clic d'envoi ou un signal du DOM,
  // 15 s sinon, espacée progressivement en cas d'erreur.
  async function runCheck() {
    const cur = q;
    if (!watching() || cur.checking || cur.busy) return;
    cur.checking = true;
    cur.lastCheckAt = Date.now();
    const res = await send(sessionMsg('queue:check', { live: collectLive() }));
    cur.checking = false;
    if (q !== cur || !watching()) return;
    const status = res && res.status;
    if (status === 'published') return onPublished(res.note);
    if (status === 'alreadyAnswered') return onAnswered(res.by);
    if (status === 'stale') return endMode("La file a été arrêtée ou a changé. Cette page n'est plus pilotée par l'extension.");
    if (status === 'skipped' || status === 'error') return endMode('Cette demande est déjà réglée dans la file.');
    cur.errors = status === 'pending' ? 0 : cur.errors + 1; // « failed » ou pas de réponse
    const base = Date.now() < cur.fastUntil ? cur.cfg.fastPollMs : cur.cfg.slowPollMs;
    scheduleCheck(Math.min(cur.cfg.maxBackoffMs, base * 2 ** cur.errors));
  }

  // Un nouveau commentaire apparaît dans le DOM : simple déclencheur, c'est l'API qui décide.
  function onSignal() {
    if (!watching()) return;
    q.fastUntil = Date.now() + q.cfg.fastWindowMs;
    scheduleCheck(q.lastCheckAt + q.cfg.fastPollMs - Date.now());
  }

  function evaluateNode(n) {
    if (!n || n.nodeType !== 1 || !n.matches('.o2-comment') || !isRealComment(n)) return false;
    const id = commentIdOf(n);
    if (id) return !q.known.has(id);
    if (q.nodes.has(n)) return false;
    q.nodes.add(n); // nœud sans id numérique (inséré avant la réponse du serveur ?) : un seul signal
    return true;
  }

  function onMutations(list) {
    if (!q) return;
    let fresh = false;
    for (const m of list) {
      if (m.type === 'attributes') {
        if (evaluateNode(m.target)) fresh = true;
        continue;
      }
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (evaluateNode(node)) fresh = true;
        for (const c of node.querySelectorAll('.o2-comment')) if (evaluateNode(c)) fresh = true;
      }
    }
    if (fresh) onSignal();
  }

  // Clic sur le bouton d'envoi (ou Ctrl/Cmd+Entrée) : écouteurs PASSIFS, ils ne font qu'accélérer la détection.
  function onSendIntent() {
    if (!watching()) return;
    q.fastUntil = Date.now() + q.cfg.fastWindowMs;
    clearTimeout(q.nodetectTimer);
    q.nodetectTimer = setTimeout(() => {
      if (q && q.phase === 'armed') { q.phase = 'nodetect'; render(); }
    }, q.cfg.fastWindowMs);
    if (q.phase === 'nodetect') { q.phase = 'armed'; render(); }
    scheduleCheck(q.cfg.fastPollMs);
  }

  function armWatching() {
    const scope = commentScope();
    q.observer = new MutationObserver(onMutations);
    // Tout l'article, pas seulement .o2-post-comments : o2 peut remplacer cette zone en cours de route.
    q.observer.observe(scope, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['id', 'class'],
    });
    q.onDocClick = (e) => {
      if (e.target instanceof Element && e.target.closest('a.o2-comment-save')) onSendIntent();
    };
    q.onKey = (e) => {
      // Seulement dans le champ de commentaire d'o2 (pas dans une autre zone de texte de la page).
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.target instanceof Element
        && e.target.matches('textarea.o2-editor-text:not(.autosizejs)')) onSendIntent();
    };
    document.addEventListener('click', q.onDocClick, { capture: true, passive: true });
    document.addEventListener('keydown', q.onKey, { capture: true, passive: true });
    // Décompte « Attends N s avant de publier » : la barre se met à jour chaque seconde tant qu'il court.
    q.floodTimer = setInterval(() => {
      if (!q || q.phase !== 'armed') return;
      const wait = floodWaitSec();
      if (wait !== q.lastFloodShown) {
        q.lastFloodShown = wait;
        render();
      }
    }, 1000);
  }

  function stopWatching() {
    if (!q) return;
    clearTimeout(q.timer);
    q.timer = null;
    clearTimeout(q.nodetectTimer);
    clearInterval(q.floodTimer);
    if (q.observer) q.observer.disconnect();
    if (q.onDocClick) document.removeEventListener('click', q.onDocClick, { capture: true });
    if (q.onKey) document.removeEventListener('keydown', q.onKey, { capture: true });
  }

  // ----- transitions -----

  // Idempotent : seule une demande encore surveillée peut devenir « publiée » (un seul compte à rebours).
  function onPublished(note = null) {
    if (!watching()) return;
    stopWatching();
    q.phase = 'published';
    q.alert = null;
    q.publishedNote = note;
    q.left = Math.max(1, Math.round(q.cfg.nextDelayMs / 1000));
    render();
    // C'est la barre qui demande l'avancée, à la fin du compte à rebours ; « Rester » l'annule.
    q.countdown = setInterval(() => {
      q.left -= 1;
      if (q.left <= 0) {
        clearInterval(q.countdown);
        goNext();
      } else {
        render();
      }
    }, 1000);
  }

  function onAnswered(by) {
    if (!watching()) return;
    stopWatching();
    q.phase = 'answered';
    q.alert = null;
    q.by = by || '?';
    render();
  }

  function doStay() {
    clearInterval(q.countdown);
    q.phase = 'stay';
    render();
  }

  // Le champ doit être vide avant que l'arrière-plan change de page (sinon : « quitter la page ? »), et l'arrière-plan
  // navigue avant même de répondre. On le vide donc juste avant l'ordre, en gardant le texte : il est rendu tel quel
  // si l'ordre échoue. La détection reste en place pendant l'attente (`busy` suspend seulement les vérifications).
  function takeDraft() {
    const ta = findCommentTextarea();
    return ta && ta.value ? { ta, value: ta.value } : null;
  }

  function restoreDraft(draft) {
    if (!draft) return;
    const ta = findCommentTextarea() || draft.ta;
    if (ta && !ta.value) {
      ta.value = draft.value;
      dispatchChange(ta);
    }
  }

  // Échec d'un ordre (pas de réponse, refus) : texte rendu, phase d'avant (le compte à rebours annulé laisse « Rester »),
  // détection rétablie, avertissement affiché. Les boutons de la phase servent à réessayer.
  function recoverFrom(cur, prevPhase, draft, text) {
    cur.busy = false;
    restoreDraft(draft);
    cur.phase = prevPhase === 'published' ? 'stay' : prevPhase;
    cur.alert = text;
    render();
    if (watching()) scheduleCheck(cur.cfg.fastPollMs);
  }

  async function advanceWith(type) {
    const cur = q;
    if (!cur || cur.busy) return;
    cur.busy = true;
    cur.alert = null;
    const prev = cur.phase;
    clearInterval(cur.countdown);
    const draft = takeDraft();
    clearField();
    const res = await send(sessionMsg(type));
    if (q !== cur) return;
    if (res && res.ok) {
      cur.busy = false;
      stopWatching();
      cur.phase = 'moving';
      cur.finalText = res.finished ? 'File terminée : le bilan est dans cet onglet.' : 'Ouverture de la suite…';
      render();
    } else if (res && res.reason === 'stale') {
      cur.busy = false;
      restoreDraft(draft);
      endMode("La file a été arrêtée ou a changé. Cette page n'est plus pilotée par l'extension.");
    } else {
      const verb = {
        'queue:next': 'passer à la suite',
        'queue:skip': 'passer cette demande',
        'queue:ignore': 'ignorer cette demande',
      }[type] || 'continuer';
      recoverFrom(cur, prev, draft, `Impossible de ${verb} (${failCause(res)}) : réessaie.`);
    }
  }

  const goNext = () => advanceWith('queue:next');
  const doSkip = () => advanceWith('queue:skip');
  // « Ignorer » : comme « Passer » (champ vidé juste avant l'ordre, texte rendu si l'ordre échoue), mais la demande
  // est aussi retirée de l'extension. Sans confirmation : réversible depuis la popup.
  const doIgnore = () => advanceWith('queue:ignore');

  async function doStop() {
    const cur = q;
    if (!cur || cur.busy) return;
    cur.busy = true;
    cur.alert = null;
    const prev = cur.phase;
    clearInterval(cur.countdown);
    const draft = takeDraft();
    clearField();
    const res = await send(sessionMsg('queue:stop'));
    if (q !== cur) return;
    if (res && res.ok) {
      cur.busy = false;
      endMode('File arrêtée.');
    } else if (res && res.reason === 'stale') {
      cur.busy = false;
      restoreDraft(draft);
      endMode('La file est déjà arrêtée ou terminée.');
    } else {
      recoverFrom(cur, prev, draft, "L'arrêt n'a pas pu être confirmé : réessaie, ou utilise la page de la file.");
    }
  }

  // « Marquer publiée » : le bénévole constate lui-même la publication. Rien n'est envoyé nulle part.
  async function doMarkPublished() {
    const cur = q;
    if (!cur || cur.busy) return;
    cur.alert = null;
    const res = await send(sessionMsg('queue:published'));
    if (q !== cur) return;
    if (res && res.ok) {
      onPublished();
    } else if (watching()) {
      cur.alert = "La demande n'a pas pu être marquée publiée (l'extension ne répond pas, ou la file a changé) : réessaie.";
      render();
    }
  }

  function endMode(text) {
    stopWatching();
    clearInterval(q.countdown);
    clearInterval(q.heartbeat); // la file n'est plus pilotée : plus de signal de vie
    document.documentElement.classList.remove('pfr-queue-live'); // les boutons de page réapparaissent
    q.phase = 'ended';
    q.finalText = text;
    render();
  }

  // La page ne permet pas de répondre : la demande est notée en erreur, le bénévole peut passer à la suivante.
  async function failRequest(message) {
    stopWatching();
    await send(sessionMsg('queue:error', { message }));
    if (!q) return;
    q.phase = 'final';
    q.finalKind = 'warn';
    q.finalText = message;
    render();
  }

  // ----- démarrage -----

  // Laisse o2 finir d'afficher les commentaires déjà publiés avant de relever leurs ids.
  async function waitForCommentsZone() {
    const scope = commentScope();
    const start = Date.now();
    while (!scope.querySelector('.o2-post-comments') && Date.now() - start < 4000) await sleep(200);
    let last = -1;
    let stableSince = Date.now();
    while (Date.now() - start < 8000) {
      const n = realComments(scope).length;
      if (n !== last) {
        last = n;
        stableSince = Date.now();
      } else if (Date.now() - stableSince >= 600) {
        break;
      }
      await sleep(150);
    }
  }

  async function startQueueMode(info) {
    const cur = {
      info,
      cfg: info.cfg,
      phase: 'preparing',
      known: new Set(),
      nodes: new WeakSet(),
      errors: 0,
      fastUntil: 0,
      lastCheckAt: 0,
      timer: null,
      dueAt: 0,
      user: null,
      kept: false,
    };
    q = cur;
    // « pfr-queue-active » : marge basse de la page pour la barre. « pfr-queue-live » : file pilotée, boutons de page
    // (« Ignorer », « Réponse FR ») masqués (la barre a ses propres actions) ; retiré par endMode et closeBar.
    document.documentElement.classList.add('pfr-queue-active', 'pfr-queue-live');
    cur.heartbeat = setInterval(sendAlive, 10000); // toutes les 10 s, quelle que soit la phase

    // Page rechargée alors que la demande est déjà réglée : rien à préremplir.
    if (FINAL_STATUSES.includes(info.itemStatus)) {
      cur.phase = 'final';
      cur.finalText = info.note || FINAL_TEXT[info.itemStatus];
      render();
      return;
    }
    render();

    await waitForTextarea(6000); // o2 rend le champ côté client, après le chargement
    if (q !== cur) return;
    const r = await prefill({ auto: true, fallbackAuthor: info.author });
    if (q !== cur) return;
    if (!r.ok) {
      await failRequest(r.message || 'Champ de réponse introuvable.');
      return;
    }
    cur.kept = !!r.kept;

    // Seulement après le préremplissage : relever les commentaires présents, puis armer la détection.
    await waitForCommentsZone();
    if (q !== cur) return;
    for (const n of realComments(commentScope())) {
      cur.nodes.add(n);
      const id = commentIdOf(n);
      if (id) cur.known.add(id);
    }
    cur.user = getCurrentUser();
    const ready = await send(sessionMsg('queue:ready', { user: cur.user, ids: [...cur.known] }));
    if (q !== cur) return;
    if (!ready || !ready.ok) {
      endMode("L'extension n'a pas confirmé la file. Recharge la page ou utilise la page de la file.");
      return;
    }
    for (const id of ready.known || []) cur.known.add(String(id));

    cur.phase = 'armed';
    armWatching();
    render();
    scheduleCheck(500);
  }

  async function initQueue() {
    const postId = getPostId();
    if (!postId) return;
    let info = null;
    try {
      info = await api.runtime.sendMessage({ type: 'queue:hello', postId });
    } catch { return; }
    if (info && info.active) startQueueMode(info);
  }

  // « Arrêter » depuis la page de la file (ou nouvelle file) : cette page, si elle est pilotée, vide son champ prérempli
  // et clôt sa barre. Pas d'effet pendant un ordre de la barre elle-même (`busy`), qui gère sa propre fin.
  function onQueueStorage(changes, area) {
    if (area !== 'local' || !changes.queue || !q || q.busy || q.phase === 'ended' || q.phase === 'moving') return;
    const s = changes.queue.newValue;
    if (s && s.id === q.info.sessionId && s.status !== 'stopped') return;
    stopWatching();
    clearField();
    endMode(s && s.id === q.info.sessionId ? 'File arrêtée depuis la page de la file.' : "Cette file n'est plus active.");
  }

  // Navigation interne (ancre, historique) ou retour sur l'onglet : signal de vie immédiat (en plus de celui, périodique,
  // de startQueueMode), au cas où l'onglet émettrait un « loading » sans recharger le script.
  const onVisible = () => { if (document.visibilityState === 'visible') sendAlive(); };

  if (isSinglePost() && isFrenchRequest()) {
    injectButton();
    initQueue();
    api.storage.onChanged.addListener(onQueueStorage);
    window.addEventListener('hashchange', sendAlive);
    window.addEventListener('popstate', sendAlive);
    document.addEventListener('visibilitychange', onVisible);
  }
})();
