# ADR 0003 — Tâches en arrière-plan : suivies par le moteur, vérifiées dans la liste des processus du système

- **Statut** : accepté
- **Date** : 2026-10-26

## Contexte

dx affiche une icône par tâche en arrière-plan (un shell lancé avec `run_in_background`, un `Monitor`) et reconnaît un agent en ligne de commande (Claude Code, Cursor) qui tourne dans l'une d'elles. L'API des hooks de fonction liste les agents de la session (`$.agent.list()`), pas ses tâches en arrière-plan : un mod voit une tâche démarrer (le `backgroundTaskId` du résultat de `Bash`, le `taskId` de celui de `Monitor`) et, la plupart du temps, finir (un appel à `TaskStop`, la ligne de notification d'une tâche terminée), mais rien ne dit ce qui tourne dans une tâche, et une fin peut passer inaperçue (ligne de notification non dessinée, rechargement).

Les règles du dépôt n'admettent aucune dépendance à l'exécution hors de Claude Code : un module de hooks atteint tout par `$`. `$.process.run(argv)` lance un programme sans shell ; ce qui est toujours présent, c'est l'outil du système qui liste les processus : PowerShell et CIM sous Windows, `ps` ailleurs.

Options étudiées :

| Option | Avantages | Inconvénients |
|---|---|---|
| Signaux du moteur seuls | Aucun processus lancé ; rien à maintenir selon le système | Pas de détection des agents en ligne de commande ; une fin manquée laisse une icône pour toujours |
| Liste des processus du système, lue à chaque tic | Exact | Un PowerShell toutes les quelques secondes sous Windows : environ 300 ms de CPU et 80 Mo de mémoire à chaque fois |
| Signaux du moteur, liste des processus lue selon un calendrier | Agents en ligne de commande reconnus ; fins manquées rattrapées ; une lecture seulement quand une tâche est due | Une lecture des processus par vérification ; une tâche rattachée à son shell par sa commande |
| Un script ou un utilitaire natif | Lectures plus rapides | Une dépendance à l'exécution, contraire aux règles |

## Décision

Une tâche est suivie par les signaux du moteur : ajoutée à son démarrage, retirée sur `TaskStop` ou sa ligne de notification. La liste des processus du système n'est lue que lorsqu'une tâche est due pour une vérification : 2 s après son démarrage (pour reconnaître un agent en ligne de commande), puis après 10 s, 1 min, 5 min, et toutes les 15 min. Une lecture sert toutes les tâches dues.

- **Windows** : `powershell -NoProfile -NonInteractive -EncodedCommand <script>`, le script lisible dans `tasks.ts` et encodé à l'exécution. Il liste les processus une fois (`Get-CimInstance Win32_Process`) et renvoie, en JSON, le processus de Claude Code (le parent de PowerShell) et tous les processus sous lui.
- **Ailleurs** : `sh -c 'echo $PPID; ps -A -o pid=,ppid=,args='`.

Le shell d'une tâche est le shell enfant direct de Claude Code dont la ligne de commande contient au moins 60 % des mots de la commande de la tâche (mots ASCII de trois caractères ou plus) : un hook PreToolUse peut réécrire la commande, le shell la cite à sa façon, Windows abîme ce qui n'est pas ASCII. Sous ce shell, `claude` ou `@anthropic-ai/claude-code` en fait un Claude en ligne de commande, `cursor-agent` un Cursor en ligne de commande. Une tâche dont le shell a été trouvé puis a disparu est terminée ; une tâche dont le shell n'a jamais été trouvé reste jusqu'à ce que le moteur signale sa fin.

## Conséquences

- Mesuré sous Windows : environ 320 ms par lecture (450 ms la première), environ 300 ms de CPU sur un cœur, environ 80 Mo de mémoire le temps de la lecture ; la session ne l'attend pas. Sans tâche en arrière-plan, rien n'est lu.
- Quand la lecture échoue (pas de PowerShell, une stratégie), dx s'en tient aux signaux du moteur et repousse les vérifications suivantes.
- La liste des processus contient les lignes de commande d'autres programmes : dx ne garde que l'identifiant du shell des tâches et la présence d'un agent en ligne de commande sous lui, dans l'état de la session, et n'envoie rien nulle part.
- À réévaluer quand l'API listera les tâches en arrière-plan : la liste des processus pourrait alors disparaître.
