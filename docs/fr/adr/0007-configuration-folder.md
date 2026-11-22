# ADR 0007 — Ouvrir le dossier de configuration de Claude Code depuis le panneau des réglages

- **Statut** : accepté
- **Date** : 2026-11-22

## Contexte

Le panneau des réglages de dx contient les réglages de dx. Ceux de Claude Code (`settings.json`, les agents, les commandes…) sont dans son dossier de configuration, `CLAUDE_CONFIG_DIR` quand il est défini, sinon `.claude` dans le dossier personnel, que l'on cherche souvent. L'API des function hooks lit les réglages de Claude Code (`$.settings.read`) mais n'ouvre aucun fichier ni dossier dans un autre programme.

Les règles absolues n'admettent aucune dépendance d'exécution hors de Claude Code ; un outil fourni par le système peut être lancé par `$.process.run` quand l'API n'offre pas d'autre moyen, avec un ADR qui dit pourquoi ([ADR 0003](0003-system-process-list.md)).

Claude Code refuse qu'un plugin lance un programme dont un argument nomme l'un de ses fichiers de réglages : un argument contenant `settings.json` sous un dossier `.claude` ou sous `CLAUDE_CONFIG_DIR` est refusé (sa politique intégrée, non documentée, telle qu'observée dans Claude Code 2.1.330).

Options étudiées :

| Option | Pour | Contre |
|---|---|---|
| Rien : le dossier cherché à la main | Rien à lancer | Le dossier est caché (`.claude`), ou placé ailleurs par `CLAUDE_CONFIG_DIR` |
| Ouvrir `settings.json` avec le programme que Windows lui associe | Un clic jusqu'au fichier | Claude Code le refuse ; contourner son refus est exclu |
| Afficher le chemin du dossier dans le panneau | Rien à lancer | Encore à copier et ouvrir à la main |
| **Ouvrir le dossier dans l'Explorateur de fichiers** | Un clic ; le fichier à un double-clic ; aucun fichier nommé | Un processus par clic ; Windows seulement |

Manières de l'ouvrir étudiées, Claude Code lançant les programmes d'un plugin fenêtre masquée (`windowsHide`, tel qu'observé dans Claude Code 2.1.330) :

| Manière | Pour | Contre |
|---|---|---|
| `explorer.exe <dossier>` | Un processus, pas de script | L'Explorateur de fichiers reprend la fenêtre masquée : le dossier s'ouvre dans une fenêtre masquée, rien ne s'affiche et rien n'est dit ; sa ligne de commande est coupée aux virgules |
| `cmd.exe /c start "" <dossier>` | Pas de script | Les guillemets de `cmd` : un dossier contenant `&`, `^` ou `%` doit être échappé |
| **Windows PowerShell, `Invoke-Item`** | Ouvre le dossier comme un double-clic, dans une fenêtre affichée ; le dossier passé dans une variable d'environnement, sans guillemets | Le démarrage de PowerShell, environ 0,3 s |

## Décision

Sous Windows, le pied du panneau dessine **`[ 📁 dossier .claude ]`** (le nom du dossier lui-même quand `CLAUDE_CONFIG_DIR` en définit un autre), à gauche de **Réinitialiser**, sur les deux onglets. Un clic ouvre le dossier dans l'Explorateur de fichiers :

- le dossier est `CLAUDE_CONFIG_DIR`, défini et non vide, sinon `.claude` dans le dossier personnel (`USERPROFILE`, sinon `HOME`), rendu chemin Windows absolu (barres obliques, le `/c/…` de Git Bash, `~`, un dossier relatif au répertoire de travail pris en compte) ;
- ce doit être un dossier ;
- Windows PowerShell (`%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`, par son chemin complet, avec `%SystemRoot%` pour répertoire de travail, pour qu'aucun programme du même nom du dossier de la session ne soit lancé à sa place) l'ouvre par `Invoke-Item -LiteralPath`, le dossier passé dans la variable `DX_OPEN_FOLDER` ; il a 15 s. Il se termine avec 1, sa première ligne d'erreur dite, quand le dossier ne s'ouvre pas ;
- seul le dossier est jamais nommé, jamais un fichier qu'il contient : dx ne contourne pas le refus de Claude Code.

Un clic pendant qu'une ouverture est en cours ne fait rien. La raison pour laquelle le dossier ne s'est pas ouvert est dite en rouge dans le panneau jusqu'à ce qu'il s'ouvre ou que le panneau soit affiché à nouveau. dx n'écrit jamais dans le dossier.

## Conséquences

- Rien n'est lancé tant que le bouton n'est pas cliqué ; chaque clic lance Windows PowerShell, qui confie le dossier à l'Explorateur de fichiers (ou au programme avec lequel Windows ouvre les dossiers).
- Hors de Windows, et avant que le dossier de Windows soit connu au début de la session, le bouton n'est pas dessiné.
- `settings.json` est à un double-clic dans l'Explorateur de fichiers, jamais ouvert par dx.
- Les tests reproduisent d'eux-mêmes le refus de Claude Code, pour que dx qui nommerait un fichier de réglages à un programme les fasse échouer, et sa fenêtre masquée, pour que dx qui lancerait `explorer.exe` directement les fasse échouer.
- À réexaminer si l'API ouvre un fichier ou un dossier, si le refus de Claude Code change, ou s'il affiche les fenêtres des programmes d'un plugin.
