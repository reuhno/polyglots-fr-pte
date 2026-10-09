# 🔔 Plus aucune demande PTE sans réponse de l'équipe FR

**Les demandes de droits PTE en français restent parfois sans réponse, et l'équipe Polyglots globale finit par accorder les droits sans l'avis de l'équipe FR.**
Cette extension de navigateur vous prévient dès qu'une demande fr_FR attend une réponse, et vous prépare la réponse type en un clic.

> Projet communautaire, non officiel : il n'est ni produit ni approuvé par la WordPress Foundation, ni par l'équipe Polyglots.

---

## ✨ Ce que ça fait

- 📋 **La liste des demandes en attente** : un clic sur l'icône de l'extension, et vous voyez les demandes fr_FR du blog [make.wordpress.org/polyglots](https://make.wordpress.org/polyglots/) auxquelles personne de l'équipe FR n'a encore répondu (date, titre, auteur, lien).
- 🔴 **Un badge** sur l'icône : le nombre de demandes en attente.
- 🔔 **Une notification** quand une nouvelle demande arrive. Au premier lancement, une seule notification groupée, jamais une rafale. Un clic sur la notification ouvre la demande.
- 💬 **Un bouton « Réponse FR »** sur la page d'une demande : il prépare la réponse type de l'équipe dans le formulaire de commentaire, avec le pseudo du demandeur déjà inséré.
- ✋ **Rien n'est jamais publié sans vous** : l'extension remplit le champ, c'est tout. Vous relisez, vous corrigez si besoin, et c'est vous qui cliquez sur « Reply ».

L'extension vérifie le blog toutes les 30 minutes (réglable) et ne regarde que les 14 derniers jours (réglable aussi).

---

## 🚀 Installer dans Chrome (et Edge, Brave, Arc)

**Étape 1.** Téléchargez le fichier : [polyglots-fr-pte-chrome.zip](https://github.com/reuhno/polyglots-fr-pte/releases/latest/download/polyglots-fr-pte-chrome.zip)

**Étape 2.** Dézippez-le. Vous obtenez un dossier `polyglots-fr-pte`. Rangez-le à un endroit où il restera (Documents, par exemple) et **ne le supprimez pas ensuite** : le navigateur le relit à chaque démarrage, et sans lui l'extension disparaît.

**Étape 3.** Ouvrez la page des extensions : copiez `chrome://extensions` dans la barre d'adresse (`edge://extensions` sous Edge, `brave://extensions` sous Brave). Activez **« Mode développeur »**, en haut à droite.

**Étape 4.** Cliquez sur **« Charger l'extension non empaquetée »** et choisissez le dossier `polyglots-fr-pte`.

**Étape 5.** Épinglez l'icône pour voir le badge : cliquez sur la pièce de puzzle 🧩 dans la barre d'outils, puis sur la punaise à côté de « Polyglots FR – demandes PTE ».

Il reste une dernière chose à faire : le « Premier réglage », plus bas.

---

## 🦊 Installer dans Firefox

**Étape 1.** Téléchargez le fichier : [polyglots-fr-pte-firefox.zip](https://github.com/reuhno/polyglots-fr-pte/releases/latest/download/polyglots-fr-pte-firefox.zip). **Ne le dézippez pas.**

**Étape 2.** Copiez `about:debugging#/runtime/this-firefox` dans la barre d'adresse.

**Étape 3.** Cliquez sur **« Charger un module complémentaire temporaire… »** et choisissez le fichier zip tel quel.

**Étape 4.** Si Firefox demande l'accès aux sites : ouvrez `about:addons`, cliquez sur l'extension, onglet **Permissions**, et autorisez l'accès à make.wordpress.org.

> ⚠️ **Firefox retire ce type de module à chaque redémarrage.** Il faut le recharger (étapes 2 et 3) à chaque fois que vous relancez Firefox. Chrome n'a pas ce défaut.

Il reste une dernière chose à faire : le « Premier réglage », juste en dessous.

---

## ⚙️ Premier réglage, indispensable

L'extension ne sait pas, au départ, qui fait partie de l'équipe FR. Tant que vous ne le lui dites pas, **une demande qui a déjà reçu une réponse reste dans la liste**.

**Étape 1.** Cliquez sur l'icône de l'extension, puis sur ⚙ (ou sur le lien du bandeau jaune).

**Étape 2.** Dans « Équipe FR », saisissez les pseudos WordPress.org de l'équipe, **un par ligne**.

**Étape 3.** Cliquez sur **Enregistrer**. La liste se met à jour toute seule.

Où trouver les pseudos ?

- Les Locale Managers et les General Translation Editors fr_FR sont sur la page [make.wordpress.org/polyglots/teams/?locale=fr_FR](https://make.wordpress.org/polyglots/teams/?locale=fr_FR).
- Pour les autres membres de l'équipe, demandez-les sur le canal Slack **#traductions**.
- Le pseudo, c'est la fin de l'adresse du profil : pour `profiles.wordpress.org/exemple`, le pseudo est `exemple`.

Une demande est considérée comme répondue dès qu'un de ces pseudos y a commenté. Les commentaires des autres personnes ne comptent pas, et un article publié par un membre de l'équipe n'est pas listé. Si l'extension n'arrive pas à identifier un commentateur, la demande reste listée, marquée « à vérifier ».

Dans le même écran, vous pouvez modifier le texte de la réponse type, la fréquence de vérification, le nombre de jours surveillés et les notifications.

---

## ✍️ Répondre à une demande

**Étape 1.** Cliquez sur l'icône de l'extension, puis sur une demande de la liste : elle s'ouvre sur make.wordpress.org.

**Étape 2.** Vérifiez que vous êtes **connecté·e à WordPress.org**. Sinon, le formulaire de réponse n'existe pas et l'extension vous le dira.

**Étape 3.** Cliquez sur le bouton bleu **« Réponse FR »**, en bas à droite de la page. Le formulaire de commentaire s'ouvre, rempli avec la réponse type.

**Étape 4.** Relisez, modifiez si besoin.

**Étape 5.** Publiez vous-même, avec le bouton **« Reply »** de la page. Tant que vous ne le faites pas, rien n'est envoyé.

---

## 🔄 Mettre à jour

Quand une nouvelle version existe, un bandeau apparaît dans la fenêtre de l'extension (l'extension consulte le numéro de version au plus une fois par jour).

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
| Accès à make.wordpress.org | Lire les articles et les commentaires du blog Polyglots, qui sont publics, et ajouter le bouton « Réponse FR » sur les pages du blog Polyglots. |

Pour savoir si une mise à jour existe, l'extension lit une fois par jour, au plus, la dernière release publiée sur l'API publique de GitHub (`api.github.com`). Cette lecture n'exige aucune autorisation supplémentaire et n'envoie aucune donnée vous concernant.

Ce qu'elle ne fait pas :

- elle **ne publie, n'envoie et ne modifie rien** sur WordPress.org ;
- elle n'utilise pas votre compte et ne lit pas vos mots de passe ;
- elle n'a pas accès à votre historique ni à vos autres onglets ;
- elle **n'envoie aucune donnée ailleurs** : elle lit make.wordpress.org (lecture seule) et l'API publique de GitHub (le numéro de la dernière release).

Le code est ouvert : vous pouvez le lire dans ce dépôt.

---

## 🛠️ Pour les développeurs

- **Charger le dépôt directement dans Chrome** : `chrome://extensions` → Mode développeur → « Charger l'extension non empaquetée » → le dossier du dépôt (celui qui contient `manifest.json`). Aucune étape de construction.
- **Version Firefox** : `python3 tools/build-firefox.py` fabrique `dist/firefox/` (Python 3, sans dépendance), à charger depuis `about:debugging`. `--out <dossier>` choisit un autre emplacement. Le script dépose un fichier témoin (`.polyglots-fr-pte-build`) dans le dossier produit et ne vide un dossier existant que s'il est vide ou porte ce témoin ; sinon il refuse (code de sortie 1). Dans le projet, seuls les sous-dossiers de `dist/` sont admis. Le `manifest.json` de la racine est la version Chrome et la source du numéro de version ; le script en dérive le manifeste Firefox.
- **Zips de release** : `python3 tools/build-zips.py` produit dans `dist/` (ou `--out <dossier>`) `polyglots-fr-pte-chrome.zip` et `polyglots-fr-pte-firefox.zip`. Montez d'abord `version` dans `manifest.json` (format `x.y.z`), puis joignez les deux zips à la release GitHub.
- **Contrôle de version** : la version annoncée aux utilisateurs est celle de la **dernière release publiée** sur GitHub (`tag_name`, préfixe `v` facultatif ; constante `LATEST_RELEASE_API_URL` de `lib/config.js`), pas celle de `main` : un changement de version dans `manifest.json` n'est annoncé qu'une fois la release publiée avec ses deux zips. Tant qu'aucune release n'existe (404), aucun bandeau n'apparaît.
- **Logique de filtrage** : `lib/requests.js` est un module pur, sans API d'extension, utilisable sous Node 18 ou plus.
- **Icônes** : `python3 tools/make-icons.py`.

---

## 🤝 Contribuer

Un bogue, une idée, un pseudo d'équipe mal reconnu ? Ouvrez une [issue](https://github.com/reuhno/polyglots-fr-pte/issues).

## Licence

GPL-2.0-or-later. Texte complet dans le fichier [LICENSE](LICENSE).
