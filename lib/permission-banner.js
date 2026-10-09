// Bannière « autoriser l'accès à make.wordpress.org » partagée par la popup et la page de la file de réponse.
// Le bouton appelle `permissions.request` DIRECTEMENT dans le gestionnaire de clic, sans rien attendre avant :
// Firefox exige que la demande parte d'une action de l'utilisateur.
import { MISSING_TEXT, deniedText, currentIsFirefox } from './permissions.js';

// `box` : conteneur (div) de la bannière. `onGranted` : appelée quand l'accès est accordé (relancer la vérification).
// Retourne { show(visible) }.
export function mountPermissionBanner(box, { extApi, origins, onGranted }) {
  const text = document.createElement('p');
  text.textContent = MISSING_TEXT;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = 'Autoriser l’accès';
  const denied = document.createElement('p');
  denied.hidden = true;
  denied.setAttribute('role', 'status');
  box.replaceChildren(text, btn, denied);

  const deny = () => {
    denied.textContent = deniedText(currentIsFirefox(extApi)); // l'endroit à indiquer dépend du navigateur
    denied.hidden = false;
  };

  btn.addEventListener('click', () => {
    denied.hidden = true;
    let pending;
    try {
      pending = extApi.permissions.request({ origins }); // appel direct, avant tout await
    } catch (e) {
      pending = Promise.reject(e);
    }
    Promise.resolve(pending)
      .then((granted) => {
        if (granted) {
          box.hidden = true;
          if (onGranted) onGranted();
        } else {
          deny();
        }
      })
      .catch(deny);
  });

  return {
    show(visible) {
      box.hidden = !visible;
      if (!visible) denied.hidden = true;
    },
  };
}
