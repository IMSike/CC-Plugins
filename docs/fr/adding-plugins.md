# Ajouter un plugin

[English](../en/adding-plugins.md) · **Français**

Un plugin de cette marketplace est un mod à hooks de fonction ([ADR 0001](adr/0001-function-hook-mods.md)) : un dossier sous `plugins/`, listé dans `.claude-plugin/marketplace.json`.

## Arborescence

```text
plugins/<nom>/
├── .claude-plugin/
│   └── plugin.json          manifeste
├── hooks/
│   ├── hooks.json           { "modules": ["./register.ts"] }
│   ├── register.ts          le module de hooks : appelle la fonction d'enregistrement de chaque fonctionnalité
│   └── <fonctionnalité>/
│       ├── <fonctionnalité>.tsx   les hooks de la fonctionnalité
│       ├── format.ts        sa logique pure, sans $
│       └── *.test.ts(x)     ses tests
├── types/
│   └── index.d.ts           contrat : les valeurs gardées dans $.state
└── README.md                résumé court, qui renvoie à docs/{en,fr}/plugins/<nom>.md
```

Un plugin a **un seul** module de hooks : une nouvelle fonctionnalité est un dossier sous `hooks/` dont `register.ts` appelle la fonction d'enregistrement, pas un nouveau plugin. Un nouveau plugin correspond à un thème distinct qu'on installerait séparément.

## Manifeste

`plugin.json` contient `name` (l'identifiant d'installation, identique à celui de l'entrée de marketplace), `description`, `author`, `homepage` (sa page de documentation), `repository`, `license`, `keywords` et, quand le plugin garde des valeurs dans `$.state`, `types`. **Pas de `version`** ([ADR 0002](adr/0002-plugin-versions.md)).

## Module de hooks

- `export const register: Register = on => { ... }`, le type importé de `'claude-code'`.
- Chaque hook est `($, e, next)` : renvoyer `next(e)` quand il n'y a rien à ajouter. Un événement en flux (`turn.step`) prend un générateur asynchrone : `async function* ($, e, next) { return yield* next(e) }`.
- `$` n'est passé qu'à des fonctions déclarées au niveau supérieur d'un fichier (ou importées) : `claude plugin validate` refuse une fermeture qui le reçoit.
- Ni DOM, ni Node : la session, les réglages, l'environnement, l'horloge passent par `$`. Un chemin n'est jamais écrit en dur : il est lu (`$.session.cwd()`, `$.env.get('USERPROFILE')`).
- Les valeurs lues par un dessin sont des atomes de `$.state` (`atom`, `read`, `update`), déclarés dans `types/index.d.ts` sous le nom du plugin, avec une étiquette `shape` changée dès que leurs champs changent.

L'API complète (événements, noms de `$`, propriétés des éléments) est le fichier de déclarations que le moteur écrit dans `plugins/<nom>/.claude-plugin/types/` quand il charge le plugin depuis le disque (ignoré par Git).

## Tests

```sh
claude plugin validate plugins/<nom>    # manifeste, module de hooks, contrat
claude plugin test plugins/<nom>        # *.test.ts(x), avec le moteur simulé en dessous
claude --plugin-dir plugins/<nom>       # l'essayer dans une vraie session, rechargé à chaque enregistrement
```

Un test monte ce que le plugin dessine sur la surface qu'il nomme (`$.ui.mount`) et répond lui-même aux appels au moteur (`on('session.usage', () => ({ value: ... }))`, `mock.clock`, `mock.env`).

## Entrée de marketplace et documentation

1. Ajouter l'entrée dans `.claude-plugin/marketplace.json` : `name`, `source` (`./plugins/<nom>`), `description`, `category`.
2. Écrire `docs/en/plugins/<nom>.md` et `docs/fr/plugins/<nom>.md` : chaque fonctionnalité, ce qu'elle affiche ou fait, ses implications, comment la désactiver.
3. Ajouter le plugin aux tableaux de `README.md`, `README.fr.md` et `docs/{en,fr}/README.md`.
4. `claude plugin validate .` passe.
