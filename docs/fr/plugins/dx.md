# dx — confort de développement

[English](../../en/plugins/dx.md) · **Français**

Installation : `/plugin install dx@cc-plugins` (après `/plugin marketplace add IMSike/CC-Plugins`). Demande Claude Code 2.1.310 ou plus récent.

## Bandeau d'état

```text
╭─ ✻ Opus 5.5 ─ ▰▰▰▰▱ xhigh ────────────────── ~/repo/app ⎇ dev ─╮
│ ctx  22% ◎◎◎◎◎◎◎◎◎◎···································         │
│ 5h   12% ◎◎◎◎◎◉◉◉◉◉◉◉◉◉·······························  ↻ 3h24 │
│ 7d   71% ◎◎◎◎◎◎◎◎◎◎◎◎◎◎◎◎◎◎◎◎◉◉◉◉◉◉◉◉◉◉◉◉············· ↻ 1j15h │
╰─ ✻ ✻ ▣ ▣ ──────────────────────────── 24k/200k · session 1h12 ─╯
```

À l'écran, les couleurs distinguent ce que le texte brut ne peut pas montrer : sur `5h`, les `◉` sont le budget, pâle ; sur `7d`, ils sont consommés en avance sur l'allure, en pleine couleur. Dans la bordure du bas, `▣` tient la place de l'icône de terminal, un glyphe Nerd Font.

- **Effet** : un tableau de bord juste au-dessus du prompt, encadré et mis en page dans la largeur du terminal.
  - **Bordure du haut** : l'étincelle `✻`, allumée à la couleur de Claude pendant qu'il travaille et grise au repos ; le modèle (`claude-opus-5-5` s'affiche `Opus 5.5`, une fenêtre de contexte de 1M ajoute `(1M)`) ; l'effort de raisonnement en jauge à cinq crans (`low` ▰▱▱▱▱ à `max` ▰▰▰▰▰) suivi de son nom ; le répertoire courant, le dossier personnel affiché `~`, tronqué par la gauche quand la place manque ; la branche Git après `⎇` (un commit abrégé en HEAD détachée).
  - **Jauges** : `ctx`, part de la fenêtre de contexte occupée par la dernière requête ; `5h` et `7d`, part consommée des limites d'utilisation sur 5 heures et sur 7 jours. Chaque jauge est un chapelet de perles : des doubles cercles `◎` pour ce qui est consommé, sur une piste de petits points `·`, dessiné en **dégradé de chaleur** : chaque cellule prend la couleur de sa position, vert, jaune, orange, puis rouge, chaque couleur se fondant dans la suivante, à mi-chemin entre elles à 25 %, 50 % et 75 %, si bien qu'une jauge rougit en s'allongeant. Le pourcentage prend la couleur atteinte par sa valeur.
  - **Allure** sur `5h` et `7d` : l'allure est l'endroit où en serait une consommation régulière à ce moment de la fenêtre (la part de la fenêtre déjà écoulée). L'écart entre elle et la consommation est dessiné en cercles pointés `◉`. Derrière la consommation, des `◉` pâles la prolongent : le budget, ce qui peut encore être consommé sans prendre d'avance. Devant elle, les perles consommées au-delà de l'allure deviennent des `◉` en pleine couleur : la consommation va plus vite que ce que la fenêtre permet en moyenne, d'autant de perles.
  - **Navette** : une lueur, qui s'estompe sur les perles derrière elle, glisse le long des perles consommées de la première à la dernière, en accélérant puis en ralentissant, en 0,4 s plus 22 ms par perle (2,6 s au plus : une jauge courte est un trajet rapide), puis se repose 3,5 s ; les trois jauges partent à tour de rôle. Elle avance par fractions de perle, sa lumière partagée entre deux voisines. Elle est dessinée par le terminal lui-même (un élément `Client` et son horloge d'images) : le bandeau n'est pas recalculé pour elle, et rien ne bouge pendant son repos.
  - **Compte à rebours** : `↻ 3h24`, temps restant avant la réinitialisation de la fenêtre. Quand, au rythme observé depuis son début, la fenêtre sera épuisée avant, le compte à rebours laisse place à `⚠ 1h10` en rouge : le temps restant avant épuisement (pas de prévision pendant les premiers 2 % de la fenêtre).
  - **Cadre** : jaune. Deux reflets en font le tour, à un demi-tour l'un de l'autre, un tour toutes les 18 s, chacun un tronçon du trait plus clair, qui se fond sur 4 cellules devant lui et s'estompe sur 10 cellules derrière lui ; comme la navette, ils sont dessinés par le terminal lui-même.
  - **Bordure du bas** : à gauche, ce qui tourne à côté de la conversation (ci-dessous) ; à droite, tokens du contexte sur la taille de la fenêtre, et durée de la session.
- **Données** : lues dans Claude Code lui-même (`$.session.usage()`, `$.session.model()`, le réglage `effortLevel`, l'effort réellement envoyé avec chaque requête) et dans le fichier `.git/HEAD` du dépôt (en lecture seule) ; rien n'est envoyé nulle part. Rafraîchi à la fin de chaque tour et toutes les 30 secondes.
- **Implications** :
  - Les lignes `5h` et `7d` n'apparaissent qu'avec un abonnement Claude (l'API ne signale pas de limites sinon) ; `ctx` affiche `—` jusqu'à la première réponse.
  - Le bandeau occupe cinq lignes. Il est dessiné dans le terminal et l'application de bureau ; les autres surfaces (VS Code, mobile) ne l'affichent pas.
  - Ce n'est pas la barre d'état : il se place **au-dessus** du prompt, et une `statusLine` configurée dans `settings.json` reste affichée en dessous. Retirer `statusLine` pour ne pas voir deux fois les mêmes chiffres.
  - Le cadre, les jauges, la jauge d'effort et la branche utilisent des caractères (`╭ ◎ ◉ ▰ ⎇`) présents dans les polices de terminal courantes (Cascadia, Nerd Fonts) ; les icônes de robot et de terminal demandent une [Nerd Font](https://www.nerdfonts.com).
  - Quand Claude Code affiche un sondage dans ce bandeau, le sondage prend sa place.
- **Replier / déplier** : `ctrl+x ctrl+a`, ou cliquer sur `[-]`.

## Sous-agents et tâches en arrière-plan

La gauche de la bordure du bas porte une icône par sous-agent et par tâche en arrière-plan de la session, jusqu'à cinq d'un même genre, puis un nombre (`+3`).

- **Effet** :
  - **Sous-agent** : `✻` à la couleur de Claude, qui tourne comme le spinner de Claude Code (`· ✢ * ✶ ✻ ✽`, aller et retour, 200 ms par image) pendant qu'il travaille, immobile et pâle pendant qu'il attend.
  - **Agent en ligne de commande** lancé dans un shell en arrière-plan : un robot, à la couleur de Claude pour Claude Code, gris pour Cursor.
  - **Shell en arrière-plan** (`run_in_background`) : une icône de terminal, grise ; un `Monitor` : `◉`.
  - **Clic sur un sous-agent** : sa conversation prend la vue principale, comme depuis la liste des tâches ; son icône est soulignée pendant ce temps. Un nouveau clic ramène à la conversation principale.
  - **Clic sur un shell ou un agent en ligne de commande** : un panneau s'ouvre avec sa commande, entière, repliée sur autant de lignes qu'il faut, puis la fin de sa sortie, relue chaque seconde. Un nouveau clic sur l'icône referme le panneau.
  - Une icône quitte la bordure quand son sous-agent termine, ou que sa tâche est arrêtée ou se termine.
- **Données** : les agents de la session (`$.agent.list()`) ; les tâches en arrière-plan, d'après les appels d'outils qui les lancent et les arrêtent et les lignes de notification de Claude Code ; leur sortie, lue dans le fichier où Claude Code l'écrit. Pour reconnaître un agent en ligne de commande dans un shell et rattraper une fin que Claude Code n'a pas signalée, dx lit la liste des processus du système ([ADR 0003](../adr/0003-system-process-list.md)) : PowerShell sous Windows, `ps` ailleurs, lancés sans shell, seulement quand une tâche est due pour une vérification (2 s après son démarrage, puis après 10 s, 1 min, 5 min, puis toutes les 15 min). Il n'en garde que l'identifiant des shells et la présence d'un agent en ligne de commande sous eux ; rien n'est envoyé nulle part.
- **Implications** :
  - Sous Windows, une vérification coûte environ 0,3 s de CPU sur un cœur et 80 Mo de mémoire le temps qu'elle dure, en arrière-plan ; sans tâche en arrière-plan, rien n'est lu. Si la lecture échoue, les icônes suivent les seuls signaux de Claude Code.
  - Un shell est reconnu aux mots de sa commande : deux shells en arrière-plan qui lancent la même commande peuvent chacun être rattachés au processus de l'autre, l'agent en ligne de commande ou la fin qu'il révèle étant alors ceux de l'autre ; la sortie affichée reste juste.
  - Pendant qu'un sous-agent travaille, le bandeau est redessiné à chaque image du spinner.
  - Recharger le plugin oublie les tâches en cours : seules les tâches lancées ensuite ont une icône.
- **Désactiver** : `/plugin` > Installed > `dx` > Disable, ou `claude plugin disable dx@cc-plugins` ; désinstaller avec `claude plugin uninstall dx@cc-plugins`.
