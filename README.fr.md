# CC-Plugins

[English](README.md) · **Français**

Une marketplace de plugins [Claude Code](https://code.claude.com) : les plugins qu'[OS-Setup](https://github.com/IMSike/OS-Setup) propose d'installer, utilisables aussi seuls.

> **Statut : début du projet.** Les plugins sont des mods à hooks de fonction, une API de Claude Code en accès anticipé : ils demandent Claude Code 2.1.310 ou plus récent. Les textes affichés sont en français pour l'instant.

## Plugins

| Plugin | Contenu |
|---|---|
| [`dx`](docs/fr/plugins/dx.md) | Confort de développement : un bandeau d'état au-dessus du prompt avec le modèle, l'effort, le répertoire courant, et des jauges pour le contexte et les limites d'utilisation sur 5 heures et 7 jours, colorées selon leur niveau ; une icône par sous-agent et par tâche en arrière-plan, à un clic de sa conversation ou de sa sortie |

## Installation

Dans une session Claude Code :

```text
/plugin marketplace add IMSike/CC-Plugins
/plugin install dx@cc-plugins
```

Ou depuis un shell :

```sh
claude plugin marketplace add IMSike/CC-Plugins
claude plugin install dx@cc-plugins
```

Mises à jour : `/plugin marketplace update cc-plugins`, ou activer la mise à jour automatique de la marketplace sous **Marketplaces** dans `/plugin`.

## Documentation

| | |
|---|---|
| [Plugins](docs/fr/README.md) | Ce que chaque plugin affiche ou fait, implications, comment le désactiver |
| [Ajouter un plugin](docs/fr/adding-plugins.md) | Arborescence, manifeste, module de hooks, tests |
| [Décisions d'architecture](docs/fr/adr/) | Pourquoi des mods, pourquoi pas de version de plugin, pourquoi lire la liste des processus |

## Contribuer

Voir [CONTRIBUTING.fr.md](CONTRIBUTING.fr.md) : conventions, messages de commit, tests.

## Licence

[MIT](LICENSE)
