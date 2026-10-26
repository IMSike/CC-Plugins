# ADR 0002 — Versions des plugins : aucune, les copies installées suivent les commits

- **Statut** : accepté
- **Date** : 2026-10-25

## Contexte

Claude Code ne fournit une nouvelle copie d'un plugin installé que lorsque sa version calculée change : la `version` de son `plugin.json`, à défaut celle de son entrée de marketplace, à défaut le commit du dépôt de la marketplace. Le dépôt est lui-même versionné comme OS-Setup : chaque push sur `main` est étiqueté d'après les messages de commit (`v0.0.0`, puis mineure pour un `feat`, correctif sinon).

Options étudiées :

| Option | Avantages | Inconvénients |
|---|---|---|
| Une `version` dans chaque `plugin.json`, incrémentée à la main | Explicite ; les utilisateurs voient un numéro | Un oubli laisse les utilisateurs sur leur ancienne copie ; un second schéma de version à côté des étiquettes du dépôt |
| Une `version` écrite par le workflow de publication | Automatique | Le workflow committe sur `main` ; l'incrément touche tous les plugins, modifiés ou non |
| Pas de `version` | Chaque push sur `main` atteint les utilisateurs ; un seul schéma de version, les étiquettes du dépôt | `claude plugin validate` émet un avertissement ; la version vue par les utilisateurs est un commit |

## Décision

Pas de `version` dans `plugin.json` ni dans les entrées de la marketplace. `main` ne reçoit que ce qui est publié : ses commits sont les versions des plugins ; les étiquettes du dépôt nomment les publications.

## Conséquences

- `claude plugin validate` signale `No version specified` pour chaque plugin : attendu, à ne pas « corriger ».
- Les utilisateurs reçoivent les changements par `/plugin marketplace update cc-plugins`, `claude plugin update dx@cc-plugins`, ou la mise à jour automatique une fois activée pour la marketplace.
- À réexaminer si un autre plugin vient à dépendre de l'un des nôtres : une plage de versions se résout sur des étiquettes `<plugin>--v<version>`.
