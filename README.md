# 🔔 Plus aucune demande PTE sans réponse de l'équipe FR

**Les demandes de droits PTE en français restent parfois sans réponse, et l'équipe Polyglots globale finit par accorder les droits sans l'avis de l'équipe FR.**
Cette extension de navigateur vous prévient dès qu'une demande fr_FR attend une réponse, et vous prépare la réponse type en un clic.

> Projet communautaire, non officiel : il n'est ni produit ni approuvé par la WordPress Foundation, ni par l'équipe Polyglots.

---

## ✨ Ce que ça fait

- 📋 **La liste des demandes en attente** : un clic sur l'icône de l'extension, et vous voyez les demandes fr_FR du blog [make.wordpress.org/polyglots](https://make.wordpress.org/polyglots/) auxquelles personne de l'équipe FR n'a encore répondu (date, titre, auteur, lien). Les plus anciennes sont en tête, car ce sont les plus prioritaires ; le bouton ⇅ de la fenêtre bascule vers « Plus récentes d'abord », et le navigateur retient votre choix.
- ✅ **Les demandes déjà traitées sont masquées** : si la ligne `#fr_FR` de la liste de tâches de l'article est barrée (par Tobi, par l'équipe ou par le demandeur), la demande est considérée comme traitée et n'apparaît plus. La fenêtre indique discrètement combien sont masquées ; la file de réponse les saute aussi.
- 🙈 **« Ignorer » une publication qui n'est pas une demande** (par exemple un appel à relecture de traductions) : le bouton **Ignorer** de chaque ligne la retire de la liste, du badge, des notifications et de la file. Elle reste visible dans la section repliable **« Ignorées (N) »** sous la liste, où **Rétablir** la fait revenir. Ce n'est pas une suppression : rien n'est modifié sur le blog. Le même bouton **Ignorer** existe sur la page d'une demande (à côté de « Réponse FR » ; une fois la demande ignorée, ou si elle l'était déjà à l'ouverture de la page, il devient **Rétablir**) et dans la barre de la file de réponse, à côté de « Passer ». Pendant une file, les boutons de la page sont masqués : la barre a les siens.
- 🔴 **Un badge** sur l'icône : le nombre de demandes en attente.
- 🔔 **Une notification** quand une nouvelle demande arrive. Au premier lancement, une seule notification groupée, jamais une rafale. Un clic sur la notification ouvre la demande.
- 💬 **Un bouton « Réponse FR »** sur la page d'une demande : il prépare la réponse type de l'équipe dans le formulaire de commentaire, avec le pseudo du demandeur déjà inséré.
- 📬 **Une file de réponse** : vous cochez les demandes à traiter, l'extension les ouvre l'une après l'autre, réponse préremplie, et passe à la suivante dès que vous avez publié.
- ✋ **Rien n'est jamais publié sans vous** : l'extension remplit le champ, c'est tout. Vous relisez, vous corrigez si besoin, et c'est vous qui cliquez sur « Reply ».

L'extension vérifie le blog toutes les 30 minutes (réglable) et ne regarde que les 14 derniers jours (réglable aussi).

---

## 🚀 Installer dans Chrome (et Edge, Brave, Arc)

**Étape 1.** Téléchargez le fichier : [polyglots-fr-pte-chrome.zip](https://github.com/reuhno/polyglots-fr-pte/releases/latest/download/polyglots-fr-pte-chrome.zip)

**Étape 2.** Dézippez-le. Vous obtenez un dossier `polyglots-fr-pte`. Rangez-le à un endroit où il restera (Documents, par exemple) et **ne le supprimez pas ensuite** : le navigateur le relit à chaque démarrage, et sans lui l'extension disparaît.

**Étape 3.** Ouvrez la page des extensions : copiez `chrome://extensions` dans la barre d'adresse (`edge://extensions` sous Edge, `brave://extensions` sous Brave). Activez **« Mode développeur »**, en haut à droite.

**Étape 4.** Cliquez sur **« Charger l'extension non empaquetée »** et choisissez le dossier `polyglots-fr-pte`.

**Étape 5.** Épinglez l'icône pour voir le badge : cliquez sur la pièce de puzzle 🧩 dans la barre d'outils, puis sur la punaise à côté de « Polyglots FR – demandes PTE ».

Il vous reste à vérifier la liste de l'équipe FR, dans « Équipe FR : à vérifier au premier lancement », plus bas.

---

## 🦊 Installer dans Firefox

**Étape 1.** Téléchargez le fichier : [polyglots-fr-pte-firefox.zip](https://github.com/reuhno/polyglots-fr-pte/releases/latest/download/polyglots-fr-pte-firefox.zip). **Ne le dézippez pas.**

**Étape 2.** Copiez `about:debugging#/runtime/this-firefox` dans la barre d'adresse.

**Étape 3.** Cliquez sur **« Charger un module complémentaire temporaire… »** et choisissez le fichier zip tel quel.

**Étape 4.** Si Firefox demande l'accès aux sites : ouvrez `about:addons`, cliquez sur l'extension, onglet **Permissions**, et autorisez l'accès à make.wordpress.org.

> ⚠️ **Firefox retire ce type de module à chaque redémarrage.** Il faut le recharger (étapes 2 et 3) à chaque fois que vous relancez Firefox. Chrome n'a pas ce défaut.

Il vous reste à vérifier la liste de l'équipe FR, dans « Équipe FR : à vérifier au premier lancement », juste en dessous.

---

## ⚙️ Équipe FR : à vérifier au premier lancement

L'extension doit savoir qui fait partie de l'équipe FR pour reconnaître les demandes déjà traitées. La liste est **préremplie avec quatre pseudos** (`wolforg`, `fxbenard`, `audrasjb`, `jdy68`), **tant que vous n'avez jamais enregistré de liste** dans les options. Dès que vous enregistrez les options, votre liste fait foi, même vide : pour retrouver la liste par défaut, utilisez « Rétablir les valeurs par défaut » ; sinon, complétez-la à la main avec les autres membres. Tant qu'un membre actif n'y figure pas, **une demande à laquelle il a répondu reste dans la liste**.

**Étape 1.** Cliquez sur l'icône de l'extension, puis sur ⚙.

**Étape 2.** Dans « Équipe FR », ajoutez ou retirez des pseudos WordPress.org, **un par ligne**.

**Étape 3.** Cliquez sur **Enregistrer**. La liste se met à jour toute seule.

Où trouver les pseudos ?

- Les Locale Managers et les General Translation Editors fr_FR sont sur la page [make.wordpress.org/polyglots/teams/?locale=fr_FR](https://make.wordpress.org/polyglots/teams/?locale=fr_FR).
- Pour les autres membres de l'équipe, demandez-les sur le canal Slack **#traductions**.
- Le pseudo, c'est la fin de l'adresse du profil : pour `profiles.wordpress.org/exemple`, le pseudo est `exemple`.

Une demande est considérée comme répondue dès qu'un de ces pseudos y a commenté. Les commentaires des autres personnes ne comptent pas, et un article publié par un membre de l'équipe n'est pas listé. Si l'extension n'arrive pas à identifier un commentateur, la demande reste listée, marquée « à vérifier ».

Dans le même écran, vous pouvez modifier le texte de la réponse type, la fréquence de vérification, le nombre de jours surveillés et les notifications.

**Demandes ignorées** : elles ne se gèrent pas dans les options, mais dans la fenêtre de l'extension (section « Ignorées », bouton **Rétablir**). La liste est synchronisée par le navigateur, limitée à 500 demandes ; une demande qui sort de la période surveillée est retirée toute seule de la liste. « Rétablir les valeurs par défaut », dans les options, ne la vide pas.

---

## ✍️ Répondre à une demande

**Étape 1.** Cliquez sur l'icône de l'extension, puis sur une demande de la liste : elle s'ouvre sur make.wordpress.org.

**Étape 2.** Vérifiez que vous êtes **connecté·e à WordPress.org**. Sinon, le formulaire de réponse n'existe pas et l'extension vous le dira.

**Étape 3.** Cliquez sur le bouton bleu **« Réponse FR »**, en bas à droite de la page. Le formulaire de commentaire s'ouvre, rempli avec la réponse type.

**Étape 4.** Relisez, modifiez si besoin.

**Étape 5.** Publiez vous-même, avec le bouton **« Reply »** de la page. Tant que vous ne le faites pas, rien n'est envoyé.

---

## 📬 Répondre en file

Pour traiter plusieurs demandes d'affilée, sans rouvrir la liste à chaque fois.

**Étape 1.** Cliquez sur l'icône de l'extension, puis sur **« Répondre en file (N) »**. Une page s'ouvre avec les demandes en attente, de la plus ancienne à la plus récente.

**Étape 2.** Décochez celles que vous ne voulez pas traiter. Les demandes marquées « à vérifier » (un commentateur n'a pas pu être identifié) ne sont pas cochées par défaut. **« Tout »** et **« Rien »** cochent ou décochent toute la liste.

**Étape 3.** Cliquez sur **« Commencer »**. L'extension ouvre la première demande dans un onglet de travail, avec la réponse déjà dans le champ. Une barre en bas de la page indique « Demande 3/12 », le pseudo du demandeur et rappelle que rien n'est envoyé.

**Étape 4.** Relisez, puis publiez **vous-même** avec le bouton d'envoi de la page. L'extension détecte la publication en interrogeant le blog (quelques secondes), affiche « Publiée ✓ » et ouvre la demande suivante au bout de 2 secondes. **« Rester »** annule l'avancée.

À savoir :

- **« Passer »** abandonne la demande en cours (le champ est vidé, pour éviter l'avertissement « quitter la page ? ») ; **« Arrêter »** met fin à la file.
- Avant d'ouvrir chaque demande, l'extension vérifie qu'un membre de l'équipe n'y a pas déjà répondu : si c'est le cas, elle la saute (« déjà répondue par @pseudo »).
- Si le blog n'affiche pas votre commentaire dans les 30 secondes (modération, erreur), la barre le dit et propose **« Marquer publiée »** (qui n'envoie rien) ou **« Passer »**.
- Un délai de 15 secondes entre deux publications est conseillé par la barre, pour ne pas déclencher l'anti-flood de WordPress.
- Si vous fermez l'onglet de travail, ou si vous naviguez vers une autre page dedans, ou si le navigateur redémarre, la file se met en pause. La page de la file propose alors **« Reprendre »**.
- À la fin, la page de la file affiche le bilan (publiées, passées, déjà répondues, erreurs).
- Une seule file à la fois. Votre propre pseudo (celui du compte connecté) est reconnu comme auteur de la réponse, même s'il ne figure pas dans la liste de l'équipe.

---

## 🔄 Mettre à jour

Quand une nouvelle version existe, un bandeau apparaît dans la fenêtre de l'extension (l'extension consulte le numéro de version au plus une fois par jour). Si les notifications sont activées dans les options, une notification système vous prévient aussi, **une seule fois par version** ; un clic dessus ouvre la page de téléchargement.

**Étape 1.** Cliquez sur le lien du bandeau et téléchargez le zip de votre navigateur (Chrome ou Firefox).

**Étape 2.** Chrome : dézippez, puis remplacez le contenu de l'ancien dossier `polyglots-fr-pte` par celui du nouveau, **au même endroit**.

**Étape 3.** Chrome : sur la page `chrome://extensions`, cliquez sur la flèche circulaire ↻ de la carte de l'extension. Firefox : rechargez le module comme à l'installation (zip tel quel).

---

## 🔒 Ce que l'extension peut faire, et ne fait pas

Voici ce que le navigateur lui autorise, une permission après l'autre.

| Autorisation | À quoi elle sert |
|---|---|
| Stockage (`storage`) | Garder vos réglages, la dernière liste et les demandes déjà signalées. |
| Alarmes (`alarms`) | Se réveiller à intervalle régulier (30 minutes par défaut) pour vérifier le blog. |
| Notifications (`notifications`) | Afficher la notification d'une nouvelle demande. |
| Accès à make.wordpress.org | Lire les articles et les commentaires du blog Polyglots, qui sont publics, et ajouter le bouton « Réponse FR » et la barre de la file de réponse sur les pages du blog Polyglots. |

La file de réponse ouvre et réutilise **un seul onglet de travail**, créé par l'extension : cela ne demande aucune autorisation supplémentaire, et l'extension ne lit ni ne modifie vos autres onglets.

Pour savoir si une mise à jour existe, l'extension lit une fois par jour, au plus, la dernière release publiée sur l'API publique de GitHub (`api.github.com`). Cette lecture n'exige aucune autorisation supplémentaire et n'envoie aucune donnée vous concernant.

Ce qu'elle ne fait pas :

- elle **ne publie, n'envoie et ne modifie rien** sur WordPress.org : elle ne clique jamais sur le bouton d'envoi, y compris dans la file de réponse, et n'appelle aucune interface d'écriture du blog ;
- elle n'utilise pas votre compte et ne lit pas vos mots de passe. Seule exception : la file de réponse lit, dans la page, le pseudo du compte connecté, uniquement pour reconnaître votre propre réponse. Ce pseudo reste dans le stockage local de l'extension et n'est envoyé nulle part ;
- elle n'a pas accès à votre historique ni à vos autres onglets ;
- elle **n'envoie aucune donnée ailleurs** : elle lit make.wordpress.org (lecture seule) et l'API publique de GitHub (le numéro de la dernière release).

Le code est ouvert : vous pouvez le lire dans ce dépôt.

---

## 🛠️ Pour les développeurs

- **Charger le dépôt directement dans Chrome** : `chrome://extensions` → Mode développeur → « Charger l'extension non empaquetée » → le dossier du dépôt (celui qui contient `manifest.json`). Aucune étape de construction.
- **Version Firefox** : `python3 tools/build-firefox.py` fabrique `dist/firefox/` (Python 3, sans dépendance), à charger depuis `about:debugging`. `--out <dossier>` choisit un autre emplacement. Le script dépose un fichier témoin (`.polyglots-fr-pte-build`) dans le dossier produit et ne vide un dossier existant que s'il est vide ou porte ce témoin ; sinon il refuse (code de sortie 1). Dans le projet, seuls les sous-dossiers de `dist/` sont admis. Le `manifest.json` de la racine est la version Chrome et la source du numéro de version ; le script en dérive le manifeste Firefox.
- **Zips de release** : `python3 tools/build-zips.py` produit dans `dist/` (ou `--out <dossier>`) `polyglots-fr-pte-chrome.zip` et `polyglots-fr-pte-firefox.zip`. Montez d'abord `version` dans `manifest.json` (format `x.y.z`), puis joignez les deux zips à la release GitHub.
- **Contrôle de version** : la version annoncée aux utilisateurs est celle de la **dernière release publiée** sur GitHub (`tag_name`, préfixe `v` facultatif ; constante `LATEST_RELEASE_API_URL` de `lib/config.js`), pas celle de `main` : un changement de version dans `manifest.json` n'est annoncé qu'une fois la release publiée avec ses deux zips. Tant qu'aucune release n'existe (404), aucun bandeau n'apparaît.
- **Logique de filtrage** : `lib/requests.js` est un module pur, sans API d'extension, utilisable sous Node 18 ou plus. `lib/queue.js` (machine d'états de la file de réponse) l'est aussi.
- **Tests** : `node --test tests/*.test.mjs` (Node 20 ou plus, sans dépendance, `fetch` simulé). Le dossier `tests/` n'est pas inclus dans les zips.
- **File de réponse** : la session est stockée dans `storage.local.queue` et pilotée par `background.js` ; `content/content.js` affiche la barre et demande la confirmation de publication par l'API REST (le DOM d'o2 ne sert que de déclencheur). Les durées (anti-flood, cadence des vérifications) sont dans `QUEUE`, `lib/config.js`.
- **Icônes** : `python3 tools/make-icons.py`.

---

## 🤝 Contribuer

Un bogue, une idée, un pseudo d'équipe mal reconnu ? Ouvrez une [issue](https://github.com/reuhno/polyglots-fr-pte/issues).

## Licence

GPL-2.0-or-later. Texte complet dans le fichier [LICENSE](LICENSE).
