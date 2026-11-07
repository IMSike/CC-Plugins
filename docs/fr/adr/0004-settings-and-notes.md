# ADR 0004 — Réglages et notes : des panneaux, gardés dans le store du plugin

- **Statut** : accepté
- **Date** : 2026-10-31

## Contexte

dx se dote d'un panneau de réglages (ce que le bandeau affiche, anime et quelles couleurs il prend) et d'un panneau de notes réservé à la personne, avec trois notes : globale, projet et session. Les deux doivent survivre à la session, et les notes doivent rester hors du contexte du modèle.

L'API des hooks de fonction offre deux endroits pour garder des valeurs d'une session à l'autre : le `$.store` du plugin, un fichier JSON à lui dans le répertoire de configuration Claude Code de l'utilisateur (`~/.claude/plugins/store/`), et les champs `userConfig` du manifeste, gardés dans `settings.json` sous `pluginConfigs` et listés dans `/config`. Un panneau est dessiné pour la personne : le modèle ne voit jamais ce qu'il affiche.

Options étudiées :

| Option | Avantages | Inconvénients |
|---|---|---|
| `userConfig` | Modifiable aussi dans `/config` ; un changement recharge le module | Champs plats seulement ; écrit dans le `settings.json` de la personne ; inadapté aux notes |
| `$.store` | N'importe quelle valeur JSON ; rien d'écrit dans `settings.json` ; un seul endroit pour les réglages et les notes | Seuls les panneaux de dx le modifient ; un fichier par copie du plugin |
| Des fichiers dans le projet (`.dx/notes.md`) | Lisibles et versionnés avec le projet | Écrits dans le dépôt de la personne ; le modèle les lit comme n'importe quel fichier |

## Décision

Les réglages et les notes sont gardés dans `$.store`, et lus dans `$.state` au démarrage de la session, pour que le bandeau et les panneaux s'en servent. Une autre session peut les écrire entre-temps : un changement de réglage part de ce que le store contient et le panneau des réglages les recharge à son ouverture ; une note est lue dans le store à l'ouverture de sa feuille, la dernière écrite l'emportant. Depuis, la note affichée est aussi relue chaque seconde tant que le panneau Notes est ouvert, si bien que la modification d'une autre session apparaît en une seconde environ.

- **Réglages** : une clé, `settings`. Une valeur enregistrée par une version précédente est lue champ par champ : un champ absent ou invalide prend sa valeur par défaut.
- **Notes** : `notes.global`, `notes.project.<racine du projet>`, `notes.session.<id de session>`, chacune `{ text, updatedAt }`. Les notes s'éditent dans un `Client` du panneau (un bloc-notes ordinaire : Entrée passe à la ligne, là où un `Input` validerait et se viderait), qui poste chaque modification au module de hooks ; chacune est écrite aussitôt. Une note vidée supprime sa clé ; rien n'est supprimé de soi-même, notes de session comprises : l'onglet Session liste les notes des autres sessions, pour les ouvrir ou les supprimer. Une clé de plus, `notesTab`, garde le dernier onglet ouvert, que le panneau suivant reprend si le réglage le demande. Depuis, un `/clear` ajoute une clé, `notes.link.<id de session>`, qui contient la session dont le nouvel identifiant de session poursuit la note ; **Supprimer cette note** supprime les liens vers la session qu'elle supprime.
- Les notes ne sont ni injectées dans la conversation ni protégées : le modèle ne les voit pas, mais peut lire le fichier du store s'il va le chercher.

## Conséquences

- Les notes restent sur la machine, en clair ; elles ne suivent la personne sur une autre machine que si `~/.claude` est synchronisé.
- Le fichier du store porte le nom de la copie du plugin : le dx installé, une copie chargée avec `--plugin-dir` et un mod en développement ont chacun leurs réglages et leurs notes.
- Le fichier grossit avec les notes de session, quelques kilo-octets chacune, et il est réécrit en entier à chaque enregistrement. Depuis, il est plafonné : une note contient au plus 95 000 caractères et le store au plus 3,8 Mio de texte JSON (Claude Code refuse d'écrire au-delà de 4 Mio) ; une modification qui dépasserait l'un ou l'autre est refusée pendant la frappe, un enregistrement qui dépasserait celui du store aussi, le panneau disant pourquoi.
- À réévaluer si l'API offre un stockage partagé entre les copies d'un plugin, ou une synchronisation.
