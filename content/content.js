// Script de contenu : bouton « Réponse FR » sur la page d'une demande du blog Polyglots.
// Il préremplit le champ de commentaire. Il ne soumet JAMAIS le formulaire : l'humain relit et publie.
(() => {
  'use strict';
  const api = globalThis.browser ?? globalThis.chrome;
  const BTN_ID = 'pfr-reply-button';
  const MSG_ID = 'pfr-reply-message';

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

  function fillTextarea(ta, text) {
    ta.focus();
    ta.value = text;
    // Prévenir o2 / WordPress du changement, sans jamais déclencher l'envoi.
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.dispatchEvent(new Event('keyup', { bubbles: true }));
    ta.dispatchEvent(new Event('change', { bubbles: true }));
    ta.setSelectionRange(ta.value.length, ta.value.length);
    ta.scrollIntoView({ block: 'center', behavior: 'smooth' });
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

  async function onClick() {
    const author = getAuthorSlug();
    if (!author) {
      showMessage("Impossible de déterminer le pseudo wordpress.org de l'auteur de cette demande.", 'error');
      return;
    }
    const { template, error } = await getTemplate();
    if (!template) {
      showMessage(
        error
          ? `Modèle de réponse indisponible : ${error}`
          : "Modèle de réponse indisponible (l'extension ne répond pas). Recharge la page.",
        'error',
      );
      return;
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
      showMessage(
        isLoggedOut()
          ? 'Formulaire de commentaire absent : connecte-toi à WordPress.org (« Login to Reply »), puis reclique sur « Réponse FR ».'
          : 'Formulaire de commentaire introuvable sur cette page. Ouvre-le (« Reply ») puis reclique sur « Réponse FR ».',
        'error',
      );
      return;
    }
    if (ta.value.trim() && !window.confirm('Le champ de commentaire contient déjà du texte. Le remplacer par le modèle ?')) {
      return;
    }
    fillTextarea(ta, applyTemplate(template, author));
    showMessage(`Modèle inséré pour @${author}. Relis-le, puis publie toi-même : rien n'a été envoyé.`, 'ok');
  }

  function injectButton() {
    if (document.getElementById(BTN_ID)) return;
    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.textContent = 'Réponse FR';
    btn.title = "Préremplir le commentaire avec le modèle de réponse de l'équipe FR (rien n'est envoyé)";
    btn.addEventListener('click', onClick);
    document.body.appendChild(btn);
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

  if (isSinglePost() && isFrenchRequest()) injectButton();
})();
