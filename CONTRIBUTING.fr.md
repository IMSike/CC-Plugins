# Contribuer

[English](CONTRIBUTING.md) · **Français**

## Pour commencer

Prérequis : Git et [Claude Code](https://code.claude.com) (une version qui gère les hooks de fonction : 2.1.310 ou plus récente).

```sh
git clone https://github.com/IMSike/CC-Plugins.git
cd CC-Plugins
git config core.hooksPath .githooks       # vérifie les messages de commit en local
claude plugin validate .                  # la marketplace
claude plugin validate plugins/dx         # un plugin
claude plugin test plugins/dx             # ses tests, sans effet sur le système
claude --plugin-dir plugins/dx            # une session avec le plugin chargé depuis le disque
```

Une session lancée avec `--plugin-dir` recharge le plugin à chaque enregistrement d'un fichier ; rien n'est installé. Lisez d'abord [Ajouter un plugin](docs/fr/adding-plugins.md).

## Principes

- **Aucune dépendance à l'exécution** : un plugin n'a besoin que de Claude Code (ni Node, ni `jq`, ni script shell) ; il atteint la session, les réglages et l'environnement par `$`. Seul un outil fourni par le système lui-même peut être lancé, par `$.process.run`, quand l'API n'offre pas d'autre moyen et qu'un ADR dit pourquoi ([ADR 0003](docs/fr/adr/0003-system-process-list.md)).
- **Discret par défaut** : un plugin ne bloque ni ne ralentit jamais la session ; un hook en échec est ignoré par le moteur, et un hook passe la main (`next(e)`) dès qu'il n'a rien à ajouter.
- **Aucun secret, aucune donnée personnelle, aucun chemin propre à une machine** dans le dépôt.
- **Documenté** : chaque fonctionnalité est expliquée (ce qu'elle affiche ou fait, implications, comment la désactiver), dans les deux langues.

## Conventions de code

- Modules de hooks en TypeScript (`.ts`, `.tsx` pour le JSX), en mode strict ; un module par plugin (`hooks/register.ts`), chaque fonctionnalité dans son propre dossier sous `hooks/`, qui enregistre ses propres hooks.
- La logique pure (mise en forme, calculs) dans des fichiers à part, sans `$`, testés seuls.
- Les valeurs lues par un dessin vivent dans `$.state`, déclarées dans le contrat du plugin `types/index.d.ts`, avec une étiquette `shape` changée dès que leurs champs changent.
- Indentation de 2 espaces, apostrophes simples, pas de points-virgules, comme les exemples du moteur.
- Identifiants et commentaires en anglais ; textes affichés à l'utilisateur en français pour l'instant.
- Encodage : UTF-8 sans BOM, LF. Imposé par `.gitattributes` et `.editorconfig`.

## Documentation

La documentation existe en **anglais** (`docs/en/`) et en **français** (`docs/fr/`), avec les mêmes noms de fichiers. Tout changement de comportement met à jour la documentation **dans le même commit**, dans **les deux langues**.

## Messages de commit

Les messages de commit et les titres de pull request suivent la [convention Angular](https://github.com/angular/angular/blob/main/contributing-docs/commit-message-guidelines.md) :

```
<type>(<portée>): <sujet>
```

| Type | Usage |
|---|---|
| `feat` | Nouvelle fonctionnalité (nouveau plugin, nouvelle fonctionnalité d'un plugin) |
| `fix` | Correction de bug |
| `docs` | Documentation seule |
| `refactor` | Changement de code qui ne corrige pas de bug et n'ajoute pas de fonctionnalité |
| `perf` | Amélioration des performances |
| `test` | Tests seuls |
| `build` | Build, dépendances, outillage |
| `ci` | Workflows GitHub Actions |
| `revert` | Annule un commit précédent |

Portées usuelles : le nom du plugin (`dx`), `marketplace`. Le sujet est à l'impératif, en minuscules, sans point final. Un commit = un changement cohérent, sur un seul plugin.

Les messages sont vérifiés par le hook `.githooks/commit-msg` et par le workflow [Commit messages](.github/workflows/commit-lint.yml) ; le workflow [Plugins](.github/workflows/validate.yml) valide et teste chaque plugin.

## Versions

Chaque push sur `main` (direct ou pull request fusionnée) est étiqueté et publié par le workflow [Version](.github/workflows/release.yml), selon le [versionnage sémantique](https://semver.org/lang/fr/) :

| Commits depuis la dernière version | Incrément |
|---|---|
| au moins un `feat` | mineur : `0.1.0` → `0.2.0` |
| tout le reste | correctif : `0.1.0` → `0.1.1` |
| décision du mainteneur uniquement | majeur : lancer le workflow à la main avec `major` |

La première version est `v0.0.0`. Pas de changelog pour l'instant. Les plugins ne portent pas de `version` propre : les copies installées suivent les commits de `main` ([ADR 0002](docs/fr/adr/0002-plugin-versions.md)).

## Pull requests

1. Partir de `main`.
2. `claude plugin validate` et `claude plugin test` passent, et le changement a été essayé dans une session `--plugin-dir`.
3. Documentation à jour dans les deux langues.
4. Titre conforme à la convention de commit (il devient le message du commit lors d'un squash merge).

## Licence

En contribuant, vous acceptez que vos contributions soient publiées sous [licence MIT](LICENSE).
