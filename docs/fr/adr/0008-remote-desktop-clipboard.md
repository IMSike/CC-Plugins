# ADR 0008 — Copies pour le Bureau à distance : le presse-papiers réécrit, une fois, après chaque copie

- **Statut** : accepté
- **Date** : 2026-11-21

## Contexte

Sous Windows, chaque copie de Claude Code (une sélection à la souris, copiée dès qu'elle est faite ; Ctrl+Maj+C ; `/copy` ; le `$.ui.copy` d'un plugin) écrit deux fois le presse-papiers : une séquence OSC 52, que le terminal applique (Windows Terminal ; herdr l'écrit lui-même par Win32, `OpenClipboard(GetConsoleWindow())`), puis, environ 0,2 s plus tard, le `Set-Clipboard` de Windows PowerShell 5.1 (OLE : `OleSetClipboard`, `OleFlushClipboard`, puis le processus se termine).

Un collage dans une session Bureau à distance (RDP, TSE), session avancée de Hyper-V comprise, ne donne alors rien, et continue de ne rien donner jusqu'au prochain changement du presse-papiers. Reproduit sans Claude Code (`own` : une écriture Win32 dont la fenêtre propriétaire reste vivante, comme celle d'un terminal ; `OLE` : le `Set-Clipboard` de PowerShell ; `Win32` : `OpenClipboard(NULL)`, `EmptyClipboard`, `SetClipboardData(CF_UNICODETEXT)`, `CloseClipboard` depuis un processus qui se termine ensuite) :

| Essai | Écritures | Collage dans la session RDP |
|---|---|---|
| T0 | `own` seule | fonctionne |
| T1 | `own`, 0,15 s plus tard `OLE` (ce que fait Claude Code) | **rien** |
| T2 | `own`, 3 s plus tard `OLE` | fonctionne |
| T4 | `own`, puis `Win32` | fonctionne |
| O1 | `OLE` seule | fonctionne (10 sur 10) |
| T7 | `Win32`, environ 0,22 s plus tard `OLE` | **rien** (3 sur 3) |
| T3 | T1, puis, une seconde ou deux plus tard, le texte relu et réécrit par `Win32` | fonctionne |
| R1 | une vraie copie de Claude Code, puis la même réécriture environ 1 s plus tard | fonctionne (3 sur 3) |

Une écriture OLE qui arrive moins de 3 s environ après une autre écriture du presse-papiers casse la redirection du presse-papiers du Bureau à distance, quelle que soit l'origine de cette première écriture : sa fenêtre propriétaire, vivante (T1) ou absente (T7), n'y change rien. Aucune des deux écritures seule ne la casse (T0, O1), ni deux écritures Win32 rapprochées (T4). Une écriture Win32 après elle, une seconde plus tard environ, la répare. `clip.exe` a été écarté (il modifiait le texte : fins de ligne en CRLF, caractères ajoutés), de même que PowerShell 7 (non fourni avec Windows) et `$.ui.copy` (il refait la double écriture).

L'API des hooks de fonction ne lève aucun événement pour les copies de Claude Code lui-même : `ui.copy` n'est levé que pour le `$.ui.copy` d'un plugin (`$.ui.copy`, `UiCopyArgs` dans le fichier de déclarations). Rien n'annonce la fin d'une sélection à la souris, Ctrl+Maj+C, ni l'avis « copié » du moteur : `ui.pointer` n'est que pour l'arrière-plan, `ui.scroll` et `ui.focus` pour un panneau, les avis de Claude Code ne passent par aucun hook (`PromptHint` n'est pas demandé tant qu'un avis s'affiche), `ContextMenu` n'existe que dans l'application de bureau, et l'`action` d'un `Button` ne prend pas un raccourci que le moteur traite lui-même. Ce que l'API offre : `$.ui.selection()`, le texte que la personne a sélectionné en dernier, tel qu'une copie le prendrait, un appel interne qui ne lance aucun programme ; `command.run` intercepte `/copy` ; `$.config.list()` lit le `copyOnSelect` de Claude Code.

L'API ne lit pas le presse-papiers et ne l'écrit que par `$.ui.copy` ; un outil fourni par le système peut être lancé par `$.process.run` quand l'API n'offre pas d'autre moyen, avec un ADR qui dit pourquoi ([ADR 0003](0003-system-process-list.md)).

Options étudiées :

| Option | Avantages | Inconvénients |
|---|---|---|
| Rien ; `"compatibility.allowOSC52": false` dans Windows Terminal | Aucun processus ; le terminal n'écrit plus, l'écriture de PowerShell reste seule | Pas dans herdr, qui écrit lui-même le presse-papiers ; un réglage du terminal, pas de dx ; l'OSC 52 perdu pour tous les programmes qui y tournent |
| Une commande seule, `/dx-tse`, lancée après une copie | Rien ne tourne sans être demandé | Une commande à taper après chaque copie |
| Le presse-papiers lu chaque seconde par PowerShell, réécrit quand il a changé | Toutes les copies attrapées, de Claude Code et d'ailleurs | Un PowerShell par seconde (environ 300 ms de CPU, 80 Mo chacun, ADR 0003) : écarté |
| **Les copies que dx voit suivies d'une réécriture**, la sélection lue toutes les demi-secondes en interne, `/copy` intercepté, `/dx-tse` pour le reste | Aucun processus avant une copie ; une sélection coûte un PowerShell | Une sélection faite en gardant la souris immobile plus d'une seconde peut être attrapée tard ou manquée ; une copie que dx ne voit pas demande `/dx-tse` |
| Un utilitaire natif ou un script | Plus rapide | Une dépendance à l'exécution, contraire aux règles du dépôt |

## Décision

Un réglage, **Réparer les copies pour le Bureau à distance (TSE)**, désactivé par défaut, proposé sous Windows seulement (section **Presse-papiers** du panneau des réglages). Activé, une seconde (`REPAIR_DELAY_MS`, 1000 ms) après chaque copie que dx voit, dx commence à réécrire le texte du presse-papiers, une fois, par la seule API Win32 :

- **Une copie à la sélection** : tant que le réglage est activé, et alors seulement, dx lit `$.ui.selection()` toutes les 500 ms (`SELECTION_POLL_MS`), en interne ; l'horloge démarre quand le réglage est activé (ou quand la session démarre avec lui activé) et s'arrête quand il est désactivé. Une lecture est sautée tant que Claude Code ne dessine pas en plein écran, tel que le bandeau l'a vu en dernier (`viewport.isFullscreen`), car il n'y a pas de sélection hors de ce mode. Une nouvelle sélection, non vide, alors que le `copyOnSelect` de Claude Code est activé (absent ou illisible : activé), est prise pour une copie ; une sélection encore en cours repousse la réécriture, si bien que seule la dernière est réécrite. La sélection présente quand le réglage est activé, ou au démarrage de dx, n'en est pas une. La réécriture n'a lieu que si le presse-papiers contient alors ce texte (comparé avec les fins de ligne en LF, sans les blancs qui finissent ses lignes ni les sauts de ligne qui le terminent) ; sinon (le bouton encore enfoncé, une copie pas encore faite), elle est retentée une fois 2 s plus tard (`RETRY_DELAY_MS`), puis abandonnée.
- **`/copy`** : un hook `command.run` la laisse s'exécuter, puis demande la réécriture du texte brut que contient le presse-papiers, quel qu'il soit, dx ne connaissant pas le texte copié. La réponse de la commande est transmise telle quelle. Le `/copy` du moteur répond sans texte, qu'il ait copié ou affiché son sélecteur des blocs de code d'une réponse (son écriture du presse-papiers précède sa réponse), si bien que les deux ne se distinguent pas : après le sélecteur, l'ancien texte du presse-papiers est réécrit, inchangé, et la copie faite depuis le sélecteur n'est pas vue ; `/dx-tse` sert alors.
- **Le `$.ui.copy` d'un plugin** vers le terminal (celui des notes de dx compris) : réécrit si le presse-papiers contient alors son texte.
- **`/dx-tse`**, une commande que dx enregistre sous Windows, réglage activé ou non : réécrit le presse-papiers aussitôt et dit ce qu'il a fait, pour la personne seule (rien n'est envoyé au modèle). Pour les copies que dx ne voit pas.

Une copie plus récente remplace une réécriture encore en attente ; les réécritures s'exécutent l'une après l'autre.

La réécriture : `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -NonInteractive -EncodedCommand <script>`, lancé avec `%SystemRoot%` pour dossier de travail, pour qu'aucun `powershell.exe` du dossier de la session ne s'exécute à sa place, avec 10 s au plus. Le script, lisible dans `hooks/rdp/rewrite.ts`, déclare les appels Win32 en mémoire (`DefineDynamicAssembly`, `DefinePInvokeMethod` : aucun C# compilé, pas de `csc.exe`, rien d'écrit dans `%TEMP%`, contrairement à `Add-Type`), ouvre le presse-papiers une fois sans fenêtre propriétaire, et dans cette seule ouverture lit `CF_UNICODETEXT` et le réécrit par `EmptyClipboard` et `SetClipboardData` : le texte ne quitte jamais le processus et revient à l'unité UTF-16 près, ses fins de ligne telles quelles. Son entrée standard contient le texte attendu, en base64 de ses octets UTF-8, ou rien. Il n'écrit rien quand le presse-papiers contient autre chose que du texte brut (une image, des fichiers, du HTML, que la réécriture perdrait : seuls `CF_TEXT`, `CF_OEMTEXT`, `CF_UNICODETEXT`, `CF_LOCALE`, les `DataObject` et `Ole Private Data` d'OLE et le `System.String` de .NET sont admis ; les marques d'un gestionnaire de mots de passe, comme `ExcludeClipboardContentFromMonitorProcessing` ou `Clipboard Viewer Ignore`, ne le sont pas, si bien que ses copies sont laissées telles quelles), ne contient pas de texte, ou contient un autre texte que celui attendu ; la ligne de débogage liste alors tous les formats que contenait le presse-papiers. Un presse-papiers tenu par un autre programme est retenté pendant 1 s. Un `GlobalLock` ou un `EmptyClipboard` qui échoue arrête l'écriture, la mémoire libérée. La documentation de Microsoft avertit que `SetClipboardData` peut échouer après `OpenClipboard(NULL)` et `EmptyClipboard`, faute de fenêtre propriétaire du presse-papiers ; il a fonctionné dans tous les essais ci-dessus (T4, R1) et sur la machine vérifiée. Tout échec va dans le journal de débogage seulement (`dx : sélection, presse-papiers non réécrit : …`).

## Conséquences

- Réglage activé, un collage dans le Bureau à distance fonctionne après une copie à la sélection, `/copy` ou la copie d'un plugin, une fois la réécriture faite, environ 1,5 s après la copie (la seconde attendue, puis le démarrage de PowerShell), jusqu'à 2 s environ pour une sélection (lue toutes les demi-secondes). Un collage plus rapide peut encore ne rien donner ; `/dx-tse` le répare.
- Non vues, donc non réparées sans `/dx-tse` : Ctrl+Maj+C quand Claude Code ne copie pas à la sélection ; une copie faite depuis le sélecteur de `/copy` ; une deuxième sélection du même texte exactement ; une sélection faite en gardant la souris immobile plus d'une seconde environ et relâchée après la nouvelle tentative ; les autres copies que Claude Code fait de lui-même (`/export` vers le presse-papiers, la commande de reprise qu'il copie).
- Chaque copie vue lance un PowerShell (environ 0,6 à 0,8 s du lancement à la sortie, les déclarations en mémoire prenant quelques dizaines de millisecondes, avec le CPU et la mémoire mesurés par l'ADR 0003), deux quand le texte d'une sélection n'est pas encore là. Rien ne tourne et rien n'est lu réglage désactivé, ni hors de Windows ; la sélection est lue toutes les 500 ms en interne tant que le réglage est activé et que Claude Code dessine en plein écran, un appel qui ne lance rien.
- Un PowerShell en mode de langage restreint (Constrained Language Mode : AppLocker, WDAC) refuse les déclarations en mémoire : la réécriture échoue alors, ce que dit le seul journal de débogage, et le presse-papiers est laissé tel quel.
- L'historique du presse-papiers de Windows (Win+V) reçoit une entrée de plus par réécriture, le même texte à nouveau.
- Une copie faite entre la copie et sa réécriture : la réécriture d'une sélection ou d'un plugin est sautée (le texte diffère) ; celle de `/copy` réécrit le texte brut alors présent, le même texte réécrit, rien de perdu.
- Le hook `ui.copy` de dx voit les copies de tous les plugins au-dessus de lui ; qu'un plugin voie ses propres appels dans son propre hook dépend du moteur : les copies des notes de dx l'ont été dans le kit de test.
- Windows seulement : sous macOS et Linux, le réglage n'est pas proposé, rien ne tourne.
- Hors de herdr, `"compatibility.allowOSC52": false` dans les réglages de Windows Terminal (`settings.json`, valeurs par défaut des profils) fait ignorer l'OSC 52 au terminal : l'écriture de PowerShell reste seule, et le réglage n'est pas nécessaire.
- À réexaminer quand une copie n'écrira le presse-papiers qu'une fois (Claude Code qui ne l'écrit qu'une fois, ou herdr qui ne l'écrit plus : [herdr#5687](https://github.com/herdrdev/herdr/issues/5687) ; herdr qui l'écrirait autrement, sans fenêtre propriétaire par exemple, n'y suffirait pas, T7), ou quand l'API lèvera un événement pour ses copies ou lira le presse-papiers.
