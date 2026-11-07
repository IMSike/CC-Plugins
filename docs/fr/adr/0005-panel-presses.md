# ADR 0005 — Les éléments cliquables du panneau latéral : dessinés par un Client, pour qu'un clic ne sélectionne pas de texte

- **Statut** : accepté
- **Date** : 2026-11-07

## Contexte

Les onglets du panneau latéral, les onglets et liens des notes et les contrôles des réglages étaient des `Button`. Le terminal gère lui-même l'appui sur un `Button` : quand le pointeur glisse entre l'appui et le relâchement, ou que deux clics se suivent vite, il sélectionne du texte à la place, ce qui remplace le presse-papiers et oblige à recliquer.

Un `Client` (un module dessiné sur le fil de la surface elle-même) garde le pointeur de l'appui au relâchement : le terminal ne sélectionne rien par-dessus. Mais ce qu'un `Client` poste parvient au module de hooks au nom de personne (origine `client`) : ce que l'API n'accorde qu'à l'appui d'une personne lui est refusé, à savoir changer la vue principale (`$.ui.view`) et ouvrir un panneau non demandé à n'importe quelle largeur (`$.ui.open` ne place un panneau non demandé qu'à partir de 144 colonnes, 110 s'il a déjà été ouvert).

Options étudiées :

| Option | Avantages | Inconvénients |
|---|---|---|
| Garder les `Button` | Activation au clavier ; pas de module en plus | Un clic peut sélectionner du texte à la place |
| Tout dessiner par un `Client`, bandeau compris | Aucune sélection nulle part | Les icônes du bandeau ne pourraient plus ouvrir le panneau sur un terminal étroit |
| Seuls les éléments du panneau dessinés par un `Client` | Aucune sélection là où les clics sont nombreux ; le bandeau ouvre toujours le panneau à toute largeur | Les icônes du bandeau restent des `Button` |

## Décision

Chaque élément cliquable du panneau latéral (ses onglets, les onglets des notes, **← Session actuelle**, **Supprimer cette note**, les notes des autres sessions, **↻ Réessayer**, et chaque contrôle des réglages sauf les deux ci-dessous) est dessiné par un même module, `press.tsx` : un libellé dans le style donné, le pointeur au-dessus y ajoutant un style de survol ; un relâchement au-dessus, après un appui au-dessus, poste `{}`. Chaque panneau répond selon la clé de l'instance, qu'il associe à une action en dessinant.

Deux contrôles des réglages font exception : les compteurs numériques sont dessinés par un module à eux, `stepper.tsx`, qui garde lui aussi le pointeur mais change la valeur dès l'appui et poste le nombre atteint ; la couleur hex personnalisée est un `Input`, saisi au clavier. Sur une surface sans `Client`, les onglets du panneau se rabattent sur des `Button`.

Les icônes du bandeau (notes, réglages, sous-agents, agents en ligne de commande, shells, moniteurs) restent des `Button` : elles ouvrent le panneau ou changent la vue principale, ce que seul l'appui d'une personne peut faire.

## Conséquences

- Un clic dans le panneau ne sélectionne jamais de texte, quels que soient les mouvements du pointeur ou le rythme des clics.
- Les éléments du panneau ne s'atteignent plus au clavier (Tab, Entrée) : seul le pointeur les active. La feuille des notes et le champ de couleur hex gardent leur clavier.
- Un élément agit au relâchement au-dessus de son libellé, comme un `Button` ; un relâchement ailleurs ne fait rien. Un compteur agit à l'appui.
- À réévaluer si l'API permet à un `Button` de garder le pointeur, ou traite ce que poste un `Client` comme venant de la personne.
