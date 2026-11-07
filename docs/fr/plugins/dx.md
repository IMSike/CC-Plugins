# dx — confort de développement

[English](../../en/plugins/dx.md) · **Français**

Installation : `/plugin install dx@cc-plugins` (après `/plugin marketplace add IMSike/CC-Plugins`). Demande Claude Code 2.1.310 ou plus récent.

## Bandeau d'état

```text
╭─ ✻ Opus 5.5 ─ ▰▰▰▰▱ xhigh ────────── ~/repo/app ⎇ dev ─ ✎  ⚙  ─╮
│ ctx  22% ◎◎◎◎◎◎◎◎◎◎···································         │
│ 5h   12% ◎◎◎◎◎◉◉◉◉◉◉◉◉◉·······························  ↻ 3h24 │
│ 7j   71% ◎◎◎◎◎◎◎◎◎◎◎◎◎◎◎◎◎◎◎◎◉◉◉◉◉◉◉◉◉◉◉◉············· ↻ 1j15h │
╰─ ✻  ✻  ▣  ▣  ─ durée 1m04 · fin 14:32 · total 1h12 · 24k/200k ─╯
```

À l'écran, les couleurs distinguent ce que le texte brut ne peut pas montrer : sur `5h`, les `◉` sont le budget, pâle ; sur `7j`, ils sont consommés en avance sur l'allure, en pleine couleur. Dans la bordure du bas, `▣` tient la place de l'icône de terminal, un glyphe Nerd Font ; dans la bordure du haut, `✎` et `⚙` tiennent celle des icônes de notes et de réglages, deux autres (nf-fa-edit et nf-oct-gear par défaut).

- **Effet** : un tableau de bord juste au-dessus du prompt, encadré et mis en page dans la largeur du terminal.
  - **Bordure du haut** : l'étincelle `✻`, allumée à la couleur de Claude pendant qu'il travaille et grise au repos ; le modèle (`claude-opus-5-5` s'affiche `Opus 5.5`, une fenêtre de contexte de 1M ajoute `(1M)`) ; l'effort de raisonnement en jauge à cinq crans (`low` ▰▱▱▱▱ à `max` ▰▰▰▰▰) suivi de son nom ; le répertoire courant, le dossier personnel affiché `~`, tronqué par la gauche quand la place manque ; la branche Git après `⎇` (un commit abrégé en HEAD détachée) ; tout à droite, `✎` et `⚙` ouvrent les panneaux de notes et de réglages (ci-dessous).
  - **Jauges** : `ctx`, part de la fenêtre de contexte occupée par la dernière requête ; `5h` et `7j` (`7d` si réglé ainsi, ci-dessous), part consommée des limites d'utilisation sur 5 heures et sur 7 jours. Chaque jauge est un chapelet de perles : des doubles cercles `◎` pour ce qui est consommé, sur une piste de petits points `·`, dessiné en **dégradé de chaleur** : chaque cellule prend la couleur de sa position, vert, jaune, orange, puis rouge, chaque couleur se fondant dans la suivante, à mi-chemin entre elles à 25 %, 50 % et 75 %, si bien qu'une jauge rougit en s'allongeant. Le pourcentage prend la couleur atteinte par sa valeur.
  - **Allure** sur `5h` et `7j` : l'allure est l'endroit où en serait une consommation régulière à ce moment de la fenêtre (la part de la fenêtre déjà écoulée). L'écart entre elle et la consommation est dessiné en cercles pointés `◉`. Derrière la consommation, des `◉` pâles la prolongent : le budget, ce qui peut encore être consommé sans prendre d'avance. Devant elle, les perles consommées au-delà de l'allure deviennent des `◉` en pleine couleur : la consommation va plus vite que ce que la fenêtre permet en moyenne, d'autant de perles.
  - **Navette** : une lueur, qui s'estompe sur les perles derrière elle, glisse le long des perles consommées de la première à la dernière, en accélérant puis en ralentissant, en 0,4 s plus 22 ms par perle (2,6 s au plus : une jauge courte est un trajet rapide), puis se repose 3,5 s. Les navettes des jauges partent à 1,4 s d'écart, puis chacune garde son propre rythme (son trajet dépend de sa longueur), si bien qu'elles peuvent se chevaucher ; une jauge de moins de 6 perles consommées n'en a pas. Elle avance par fractions de perle, sa lumière partagée entre deux voisines. Elle est dessinée par le terminal lui-même (un élément `Client` et son horloge d'images) : le bandeau n'est pas recalculé pour elle, et rien ne bouge pendant son repos.
  - **Compte à rebours** : `↻ 3h24`, temps restant avant la réinitialisation de la fenêtre. Quand, au rythme observé depuis son début, la fenêtre sera épuisée avant, le compte à rebours laisse place à `⚠ 1h10` en rouge : le temps restant avant épuisement (pas de prévision pendant les premiers 2 % de la fenêtre).
  - **Cadre** : jaune. Deux reflets en font le tour, à un demi-tour l'un de l'autre, un tour toutes les 18 s, chacun un tronçon du trait plus clair, qui se fond sur 4 cellules devant lui et s'estompe sur 10 cellules derrière lui ; comme la navette, ils sont dessinés par le terminal lui-même.
  - **Bordure du bas** : à gauche, ce qui tourne à côté de la conversation (ci-dessous) ; à droite, la durée du dernier tour (`durée`, qui défile pendant que Claude travaille) et l'heure à laquelle il s'est terminé (`fin`), la durée totale de la session (`total`), et les tokens du contexte sur la taille de la fenêtre.
- **Données** : lues dans Claude Code lui-même (`$.session.usage()`, `$.session.model()`, le réglage `effortLevel`, l'effort réellement envoyé avec chaque requête), dans les tours de la boucle principale (`turn.start`, `turn.complete`) et dans le fichier `.git/HEAD` du dépôt (en lecture seule) ; rien n'est envoyé nulle part. Rafraîchi à la fin de chaque tour et toutes les 30 secondes ; la durée du tour chaque seconde pendant qu'il tourne.
- **Implications** :
  - Les lignes `5h` et `7j` n'apparaissent qu'avec un abonnement Claude (l'API ne signale pas de limites sinon) ; `ctx` affiche `—` jusqu'à la première réponse.
  - Le bandeau occupe jusqu'à cinq lignes : une par jauge affichée, et ses deux bordures. Il est dessiné dans le terminal et l'application de bureau ; les autres surfaces (VS Code, mobile) ne l'affichent pas.
  - Ce n'est pas la barre d'état : il se place **au-dessus** du prompt, et une `statusLine` configurée dans `settings.json` reste affichée en dessous. Retirer `statusLine` pour ne pas voir deux fois les mêmes chiffres.
  - Le cadre, les jauges, la jauge d'effort et la branche utilisent des caractères (`╭ ◎ ◉ ▰ ⎇`) présents dans les polices de terminal courantes (Cascadia, Nerd Fonts) ; les icônes de robot et de terminal, et les icônes de notes, de réglages et de moniteur par défaut, demandent une [Nerd Font](https://www.nerdfonts.com).
  - Quand Claude Code affiche un sondage dans ce bandeau, le sondage prend sa place.
- **Replier / déplier** : `ctrl+x ctrl+a`, ou cliquer sur `[-]`.

## Sous-agents et tâches en arrière-plan

La gauche de la bordure du bas porte une icône par sous-agent et par tâche en arrière-plan de la session, jusqu'à cinq d'un même genre (selon le réglage, ci-dessous), puis un nombre (`+3`). Les sous-agents qui travaillent et ceux qui attendent sont deux genres, plafonnés chacun de son côté : jusqu'à dix icônes de sous-agents par défaut. Les agents en ligne de commande pour Claude Code, ceux pour Cursor, les shells et les moniteurs sont chacun un genre.

- **Effet** :
  - **Sous-agent** : `✻` à la couleur de Claude, qui tourne comme le spinner de Claude Code (`· ✢ * ✶ ✻ ✽`, aller et retour, 200 ms par image) pendant qu'il travaille, immobile et pâle pendant qu'il attend.
  - **Agent en ligne de commande** lancé dans un shell en arrière-plan : un robot, à la couleur de Claude pour Claude Code, gris pour Cursor.
  - **Shell en arrière-plan** (`run_in_background`) : une icône de terminal, grise ; un `Monitor` : un pouls (nf-oct-pulse), gris, ou le glyphe choisi dans les réglages.
  - **Clic sur un sous-agent** : sa conversation prend la vue principale, comme depuis la liste des tâches ; son icône est soulignée pendant ce temps. Un nouveau clic ramène à la conversation principale.
  - **Clic sur un shell, un agent en ligne de commande ou un moniteur** : le panneau latéral affiche sa commande, entière, repliée sur autant de lignes qu'il faut, puis la fin de sa sortie, relue chaque seconde. Un nouveau clic sur l'icône referme le panneau latéral.
  - Une icône quitte la bordure quand son sous-agent termine, ou que sa tâche est arrêtée ou se termine.
- **Données** : les agents de la session (`$.agent.list()`) ; les tâches en arrière-plan, d'après les appels d'outils qui les lancent et les arrêtent et les lignes de notification de Claude Code ; leur sortie, lue dans le fichier où Claude Code l'écrit. Pour reconnaître un agent en ligne de commande dans un shell et rattraper une fin que Claude Code n'a pas signalée, dx lit la liste des processus du système ([ADR 0003](../adr/0003-system-process-list.md)) : PowerShell sous Windows, `ps` par `sh -c` ailleurs, seulement quand une tâche est due pour une vérification (2 s après son démarrage, puis après 10 s, 1 min, 5 min, puis toutes les 15 min). Il n'en garde que l'identifiant des shells et la présence d'un agent en ligne de commande sous eux ; rien n'est envoyé nulle part.
- **Implications** :
  - Sous Windows, une vérification coûte environ 0,3 s de CPU sur un cœur et 80 Mo de mémoire le temps qu'elle dure, en arrière-plan ; sans tâche en arrière-plan, rien n'est lu. Si la lecture échoue, les icônes suivent les seuls signaux de Claude Code.
  - Un shell est reconnu aux mots de sa commande : deux shells en arrière-plan qui lancent la même commande peuvent chacun être rattachés au processus de l'autre, l'agent en ligne de commande ou la fin qu'il révèle étant alors ceux de l'autre ; la sortie affichée reste juste.
  - Pendant qu'un sous-agent travaille, le bandeau est redessiné à chaque image du spinner ; pendant un tour, chaque seconde.
  - Recharger le plugin oublie les tâches en cours : seules les tâches lancées ensuite ont une icône.

## Réglages

L'icône `⚙` affiche les réglages dans le panneau latéral ; un second clic le referme. Un changement s'applique aussitôt et est gardé d'une session à l'autre.

- **Effet** :
  - **Affichage** : chaque élément du bandeau, affiché ou non : modèle, effort, répertoire, branche Git, chaque jauge, comptes à rebours, sous-agents et tâches ; le libellé de la jauge 7 jours (**Libellé de la jauge 7 j**), `7j` (par défaut) ou `7d` (en anglais).
  - **Bordure du bas** : la durée du tour, son heure de fin, le total de la session et les tokens du contexte, chacun affiché ou non et déplacé avec `↑` `↓` ; le nombre d'icônes de sous-agents, et celui d'icônes de terminaux, d'un même type avant un compte `+N` (5 chacun par défaut, de 1 à 10).
  - **Animations** : les reflets du cadre, la navette des jauges, le spinner des sous-agents, chacun activé (par défaut) ou non ; la vitesse des reflets et de la navette (lente, deux fois moins vite ; normale, par défaut ; rapide, deux fois plus vite). Le spinner garde le rythme de Claude Code quelle que soit la vitesse.
  - **Couleurs**, chacune choisie dans une liste de couleurs nommées ou saisie en hex (`#58a6ff`) : le cadre (la couleur d'avertissement du thème, jaune, par défaut), la jauge d'effort et la branche (la couleur de Claude par défaut), les jauges (le dégradé de chaleur par défaut, ou une couleur), le texte de la bordure du bas (discret par défaut). Le bandeau montre un changement aussitôt.
  - **Seuils des jauges** : où le dégradé de chaleur passe à l'orange (50 % par défaut) et au rouge (75 %), par pas de 5, entre 10 % et 95 % ; le jaune se place à mi-chemin de l'orange.
  - **Icônes** : les glyphes des icônes de notes et de réglages (nf-fa-edit et nf-oct-gear par défaut), et celui d'un moniteur (nf-oct-pulse par défaut ; aussi un œil, un radar, une antenne, une cloche), parmi quelques glyphes Unicode et Nerd Font ; un glyphe absent de la police du terminal s'affiche vide ou en carré.
  - **Notes** : l'onglet sur lequel le panneau s'ouvre (**Global** par défaut) ; s'il reprend plutôt le dernier onglet ouvert (activé par défaut) ; le nombre de notes d'autres sessions listées à la fois (8 par défaut, de 0 à 20).
  - **Comportement** : masquer la jauge `5h` tant que sa fenêtre n'a pas commencé (activé par défaut) ; désactivé, sa ligne est dessinée vide. Animer seulement pendant que Claude travaille (désactivé par défaut) : les reflets et les navettes sont au repos le reste du temps ; avec **… ou qu'un sous-agent ou un shell est actif** (coché avec lui par défaut), ils tournent aussi pendant qu'un sous-agent travaille ou qu'une tâche en arrière-plan tourne. Le spinner des sous-agents ne tourne de toute façon que pendant que son sous-agent travaille.
  - **Réinitialiser** remet chaque réglage à sa valeur par défaut.
- **Données** : gardées dans le store de dx, un fichier sous `~/.claude/plugins/store/` ([ADR 0004](../adr/0004-settings-and-notes.md)).
- **Implications** :
  - Le panneau latéral se range à côté du transcript en mode plein écran à partir de 110 colonnes, au-dessus du prompt sinon. C'est un seul panneau dont le contenu change (notes, réglages ou un terminal) sans se refermer, donc sans scintillement ; une ligne d'onglets en haut mène de l'un à l'autre et au terminal de chaque tâche en arrière-plan.
  - Un clic dans le panneau (ses onglets, les onglets et liens des notes, les contrôles des réglages) ne sélectionne jamais de texte, quels que soient les mouvements du pointeur ; ils s'activent au pointeur seulement, pas au clavier, et à son relâchement, sauf les compteurs numériques, qui agissent dès l'appui. La couleur hex personnalisée s'écrit au clavier, dans un simple champ. Les icônes du bandeau restent de simples boutons ([ADR 0005](../adr/0005-panel-presses.md)).
  - Un changement fait dans une session apparaît dans une autre à la prochaine ouverture de ses réglages.
  - Chaque copie du plugin (installée, chargée avec `--plugin-dir`) garde ses propres réglages.

## Notes

L'icône `✎` affiche les notes dans le panneau latéral, rien que pour vous (un second clic le referme), avec trois onglets : **Global** (toutes les sessions), **Projet** (le projet de la session) et **Session**.

- **Effet** : une feuille par onglet, qui s'écrit comme un bloc-notes ordinaire : un clic pour écrire, Entrée passe à la ligne, Tab insère deux espaces, les flèches, Début, Fin et Page préc./suiv. déplacent le curseur, Ctrl+← / Ctrl+→ d'un mot à la fois, Ctrl+Retour arrière efface le mot précédent et Ctrl+Suppr le suivant, Échap rend le clavier au prompt. Ce qui est écrit reste affiché et est enregistré à chaque modification. Sous l'onglet Session, les notes des autres sessions, les plus récentes d'abord, autant de lignes à la fois que réglé ; quand il y en a davantage, la ligne de titre de la liste indique où elle en est (`9–16 / 23`) avec deux flèches, `▲` et `▼`, qui la déplacent d'une page, et la molette de la souris au-dessus de la liste la déplace d'une ligne (ailleurs dans le panneau, la molette fait ce qu'elle fait toujours). Un clic en ouvre une, puis **Supprimer cette note** la supprime, ou **← Session actuelle** ramène à celle de la session.
- **Données** : gardées dans le store de dx ([ADR 0004](../adr/0004-settings-and-notes.md)) à chaque modification ; la note de projet sous la racine du projet de la session, la note de session sous son identifiant. Une note vidée est supprimée ; rien n'est supprimé autrement. **Supprimer cette note** supprime aussi les liens vers cette session (`/clear`, ci-dessous).
- **Chargement** : les notes sont chargées au démarrage de la session. Si cela échoue, elles sont rechargées à chaque affichage du panneau ; tant qu'elles ne peuvent pas l'être, le panneau affiche **Notes indisponibles** avec la raison et un bouton **↻ Réessayer**, et le journal de débogage (`claude --debug-file <fichier>`) contient une ligne `dx : notes non chargées`.
- **`/clear`** : un `/clear` vide la conversation, pas la session : l'onglet **Session** garde sa note, et le panneau reste sur l'onglet affiché. Claude Code poursuit sous un nouvel identifiant de session ; dx le relie à l'ancien (une petite entrée `notes.link.<id>` dans son store) au premier chargement qui suit, uniquement dans le processus Claude Code qui a exécuté le `/clear`, dont dx se souvient en mémoire, jamais dans une autre conversation ouverte en parallèle. Si dx est rechargé, ou une autre conversation reprise (`/resume`), entre le `/clear` et ce chargement, le lien n'est pas fait : l'ancienne note reste dans la liste des autres sessions. Supprimer la note d'une autre session avec **Supprimer cette note** supprime aussi les liens qui pointent vers cette session ; vider une note dans sa feuille, celle de la session en cours ou d'une autre, les garde.
- **Implications** :
  - Les notes ne sont pas envoyées à Claude : ce qu'affiche un panneau n'entre jamais dans son contexte. Elles ne lui sont pas cachées pour autant : le store est un fichier en clair sous `~/.claude`, que Claude pourrait lire s'il allait le chercher.
  - Une note ouverte dans deux sessions à la fois : ce que l'une écrit apparaît dans l'autre en une seconde environ, sans changer d'onglet (dx relit la note affichée chaque seconde tant que le panneau Notes est ouvert). Si les deux écrivent dans la même seconde, la dernière écrite l'emporte.
  - Elles restent sur la machine, ne vous suivent ailleurs que si `~/.claude` est synchronisé, et appartiennent à la copie du plugin qui les a écrites.
  - Une note contient au plus 95 000 caractères (ce que Claude Code laisse l'éditeur recevoir et envoyer, 100 000, moins une marge). Au-delà, une modification qui allonge la note n'est pas appliquée : une touche est ignorée, un collage refusé en entier, jamais coupé ; raccourcir la note reste toujours possible.
  - Le store de dx contient en tout au plus 3,8 Mio de texte JSON (Claude Code refuse d'écrire au-delà de 4 Mio ; la marge est pour les réglages). dx garde une estimation de sa taille, mesurée au premier enregistrement après le chargement des notes et suivie à chaque enregistrement, puis mesurée à nouveau avant de refuser : un enregistrement qui dépasserait la limite est refusé, le texte restant dans l'éditeur. Supprimer d'anciennes notes d'autres sessions libère de la place.
  - Un enregistrement n'échoue jamais en silence : une modification refusée, un enregistrement refusé ou rejeté par Claude Code affiche **⚠ non enregistré** en rouge à la place de l'heure d'enregistrement (`✓ jj/mm hh:mm`, ou `vide` quand la note est vide), la raison sur la ligne du dessous (**note trop longue (95 000 caractères au plus)**, **store presque plein : supprimez d'anciennes notes**, **notes non chargées : …** si les notes n'ont pas pu être chargées pour l'enregistrer, ou le message de Claude Code après `store : `), jusqu'à ce qu'un enregistrement réussisse. L'avertissement reste quand un autre onglet ou une autre note est affiché, mais le texte non enregistré est alors perdu.

## Désactiver

`/plugin` > Installed > `dx` > Disable, ou `claude plugin disable dx@cc-plugins` ; désinstaller avec `claude plugin uninstall dx@cc-plugins`.
