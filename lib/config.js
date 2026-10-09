// Constantes et valeurs par défaut. Un seul endroit à modifier.

// Dépôt de l'extension (tant que le dépôt est absent ou privé, un 404 est géré proprement).
export const REPO_URL = 'https://github.com/reuhno/polyglots-fr-pte';
// Page de la dernière release (les deux zips à télécharger).
export const RELEASES_URL = `${REPO_URL}/releases/latest`;
// Dernière release publiée, lue sur l'API publique de GitHub pour savoir si une version plus
// récente existe (même source que le lien du bandeau). L'API répond avec « Access-Control-Allow-Origin: * » :
// aucune permission d'hôte n'est nécessaire.
export const LATEST_RELEASE_API_URL =
  'https://api.github.com/repos/reuhno/polyglots-fr-pte/releases/latest';

export const SITE_URL = 'https://make.wordpress.org/polyglots';
export const API_BASE = `${SITE_URL}/wp-json/wp/v2`;

// Étiquette « fr_FR » du blog Polyglots. L'étiquette « editor requests » (1453)
// n'est volontairement pas exigée : sur les 100 derniers articles fr_FR, 99 la portent,
// mais celui qui ne la porte pas était bien une demande.
export const TAG_FR_FR = 123;
export const REQUEST_TAG_IDS = [TAG_FR_FR];

export const ALARM_CHECK = 'pfr-check';
export const VERSION_CHECK_EVERY_MS = 24 * 60 * 60 * 1000;

// Pseudos wordpress.org (user_nicename) des membres de l'équipe FR : liste vide par défaut,
// chaque utilisateur la renseigne dans les options. Tant qu'elle est vide, aucune demande
// n'est considérée comme répondue (la popup le signale).
export const DEFAULT_TEAM = [];

export const DEFAULT_TEMPLATE = `Bonjour @{author}

The French translation team will do its best to get your request accepted ASAP. You can have more info <a href="https://fr.wordpress.org/2015/12/18/how-french-community-handles-pte-requests/">how we handle PTE requests</a>.

@{author} can you also get in touch on the French Slack #traductions channel using our <a href="https://join.slack.com/t/wordpressfr/shared_invite/zt-b7l3dbj4-vxEUcxPBX~6TuUG0cwIemA">direct invitation link</a>.
We have a few recommendations before giving PTE's access.

Please keep in mind the French Glossary and Guidelines available in our <a href="https://fr.wordpress.org/team/handbook/">Handbook</a> as well.

Merci`;

export const DEFAULT_SETTINGS = {
  team: DEFAULT_TEAM,
  template: DEFAULT_TEMPLATE,
  intervalMinutes: 30,
  windowDays: 14,
  notify: true,
};

export const LIMITS = {
  intervalMinutes: { min: 5, max: 1440 },
  windowDays: { min: 1, max: 365 },
};
