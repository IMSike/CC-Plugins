# ADR 0006 — Coller dans une note : un bouton qui lit le presse-papiers du système

- **Statut** : accepté
- **Date** : 2026-11-11

## Contexte

L'éditeur des notes est un `Client` du panneau latéral. Un collage fait dans le terminal (Ctrl+V, un clic droit) n'est pas une touche : Claude Code l'envoie à la zone de prompt, même quand une note a le clavier. L'API des hooks de fonction écrit le presse-papiers (`$.ui.copy`) mais n'a aucun appel qui le lise.

Une première tentative reprenait le collage à la zone de prompt avec un hook `prompt.edit`, tant que la note était censée avoir le clavier. Elle a été rejetée : un plugin ne peut pas savoir où est le clavier. Rien ne signale Échap qui le rend au prompt, ni un clic dans la zone de prompt ; le `isFocused` du moteur dit que le panneau l'a, pas laquelle de ses parties. Un collage destiné au prompt pouvait finir dans une note, ou l'inverse. Et le collage clignote visiblement dans la zone de prompt avant qu'un hook réponde.

Les règles du dépôt n'admettent aucune dépendance à l'exécution hors de Claude Code ; un outil fourni par le système peut être lancé par `$.process.run` quand l'API n'offre pas d'autre moyen, avec un ADR qui dit pourquoi ([ADR 0003](0003-system-process-list.md)).

Options étudiées :

| Option | Avantages | Inconvénients |
|---|---|---|
| Reprendre le collage à la zone de prompt (`prompt.edit`) | Ctrl+V comme partout ailleurs | Devine où est le clavier, à tort après Échap ou un clic dans le prompt ; le collage clignote dans la zone de prompt |
| Pas de collage dans les notes | Rien à lancer, rien à deviner | Recopier un texte dans une note oblige à le retaper |
| Un bouton **Coller** qui lit le presse-papiers avec les outils du système | Ne devine jamais : le clic dit où va le texte ; rien n'est lancé avant le clic | Un processus par clic ; des outils Linux peuvent manquer ; par SSH, le presse-papiers est celui de la machine distante |
| Un script ou un utilitaire natif | Lectures plus rapides | Une dépendance à l'exécution, contraire aux règles |

## Décision

Un collage dans le terminal reste celui du prompt, comme sans dx. Sous la feuille de chaque note, en bas à droite, un bouton **Coller** (un élément cliquable de `press.tsx`, [ADR 0005](0005-panel-presses.md)) lit le presse-papiers du système et donne son texte à l'éditeur de la note, qui l'insère à son curseur avec le même nettoyage et les mêmes limites que la saisie. Il n'est dessiné qu'avec l'éditeur.

- **Windows** : `powershell -NoProfile -NonInteractive -EncodedCommand <script>`, le script lisible dans `clipboard.ts` et encodé à l'exécution comme celui de l'ADR 0003. Il écrit `Get-Clipboard -Raw` en base64 de ses octets UTF-8, pour qu'aucune page de code de la console n'abîme un accent ; dx le décode (`atob`, `TextDecoder`). Sans texte dans le presse-papiers, il n'écrit rien.
- **Ailleurs** : le premier de ceux-ci qui se lance : `pbpaste` (macOS), `wl-paste --no-newline` (Wayland), `xclip -selection clipboard -o`, `xsel --clipboard --output` (X11). Aucun ne se lançant, le panneau indique quoi installer.
- **Par SSH** (`SSH_CONNECTION`, `SSH_CLIENT` ou `SSH_TTY` défini) : rien n'est lu, et le panneau dit pourquoi, plutôt que de coller le presse-papiers de la machine distante.

Chaque lecture dure 5 s au plus. Un clic pendant une lecture ne fait rien. La raison d'une lecture échouée est indiquée dans le panneau, avec la note, comme pour une modification refusée.

## Conséquences

- Rien n'est lancé tant que le bouton n'est pas cliqué. Sous Windows, chaque clic lance un PowerShell : environ 0,3 à 0,5 s avant que le texte s'affiche ; ailleurs, quelques millisecondes.
- Sous Linux, `wl-clipboard`, `xclip` ou `xsel` peuvent manquer : le bouton le dit alors et ne colle rien.
- Par SSH, coller dans une note oblige à taper le texte : le presse-papiers de la machine devant laquelle vous êtes est hors d'atteinte.
- Le presse-papiers n'est lu qu'au clic, gardé nulle part ailleurs que dans la note où il est collé, et envoyé nulle part.
- À réévaluer si l'API lit le presse-papiers, ou dit quelle partie d'un panneau a le clavier : le bouton pourrait alors céder la place à Ctrl+V.
