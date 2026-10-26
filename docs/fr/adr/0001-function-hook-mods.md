# ADR 0001 — Plugins en mods à hooks de fonction ; le bandeau d'état au-dessus du prompt

- **Statut** : accepté
- **Date** : 2026-10-25

## Contexte

OS-Setup installe une barre d'état Claude Code (élément `claude-statusline`) : un script bash, exécuté par Git Bash, qui lit avec `jq` le JSON que Claude Code lui passe sur l'entrée standard et suit une description `statusline-config.json`. Elle coûte deux dépendances (`jq`, bash), deux fichiers à déployer et une fusion dans `settings.json`, et ne peut pas connaître la largeur du terminal. L'objectif est un remplaçant sans `jq`, distribué comme plugin de cette marketplace, qui dessine quatre lignes : modèle et effort à gauche, répertoire courant à droite, puis trois jauges (contexte, limites sur 5 heures et sur 7 jours) colorées selon leur niveau, les deux dernières suivies du temps restant avant leur réinitialisation.

Options étudiées :

| Option | Avantages | Inconvénients |
|---|---|---|
| Commande `statusLine` livrée dans un plugin (script Node) | Reste sous le prompt, à la place de la barre d'état ; API stable | Un plugin ne peut pas définir `statusLine` : OS-Setup devrait toujours la fusionner dans `settings.json` ; demande Node ; pas de largeur de terminal, donc ni jauges pleine largeur ni chemin aligné à droite |
| Mod, `$.ui.status(texte)` | Aucun réglage à modifier ; sous le prompt | Une ligne de texte brut : ni couleurs, ni mise en page |
| Mod, `ui.render` sur `AbovePrompt` | Un arbre de `Box`/`Text` mis en page dans la largeur exacte du bandeau (`bodyColumns`) ; couleurs du thème ; données lues directement dans le moteur (`$.session.usage()`, `$.session.model()`) ; rien à déployer au-delà de l'installation du plugin | Au-dessus du prompt, pas en dessous ; API en accès anticipé, susceptible de changer d'une version à l'autre ; demande un Claude Code récent |

## Décision

- Les plugins de cette marketplace sont des **mods à hooks de fonction** : un module de hooks TypeScript désigné par `hooks/hooks.json`, sans dépendance à l'exécution.
- Le plugin `dx` dessine le bandeau d'état par **`ui.render` sur `AbovePrompt`**, seul emplacement qui permet la mise en page prévue sur quatre lignes.

## Conséquences

- Ni `jq`, ni bash, ni fichier à copier : l'élément `claude-statusline` d'OS-Setup est remplacé par `claude-dx`, qui lance `claude plugin install dx --marketplace IMSike/CC-Plugins` (la commande ajoute la marketplace et écrit `extraKnownMarketplaces` et `enabledPlugins` dans `settings.json`). Fusionner ces deux clés ne suffit pas : Claude Code ne télécharge pas le plugin pour autant. `jq` n'est plus nécessaire.
- Le bandeau est **au-dessus** du prompt. Le réglage `statusLine` n'est pas modifié : qui passe au bandeau le retire lui-même pour ne pas afficher deux fois les mêmes chiffres.
- L'utilisateur peut replier le bandeau (`ctrl+x ctrl+a`, ou `[-]`) ; un sondage prend sa place le temps de son affichage.
- L'API est en accès anticipé : chaque mise à jour de Claude Code peut demander un ajustement. `claude plugin validate` et `claude plugin test` en CI détectent ce que la nouvelle version refuse.
- Claude Code 2.1.310 ou plus récent est nécessaire ; les versions antérieures ignorent le module de hooks.
