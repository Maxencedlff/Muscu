# Retours arrière : ordre de démontage

Les fichiers `*_down.sql` de ce dossier défont une migration de `supabase/migrations/`. Supabase ne les applique jamais de lui-même : chacun se lance à la main dans l'éditeur SQL, sur décision de Maxence, après avoir lu son en-tête (ce qu'il faut couper avant, ce qui est effacé, ce qui est mis de côté).

## Règle

**Toujours de la migration la plus récente vers la plus ancienne.** Cet ordre est le seul vérifié marche par marche par `tests/sql/rollback_nuit_check.sh`, qui compare après chaque retour arrière le `pg_dump` complet (schéma, droits, politiques, déclencheurs et données) avec celui d'une base où la migration n'a jamais été appliquée.

| # | Retour arrière | Dépend de (à démonter avant) | Peut se lancer seul sur la pile complète |
|---|---|---|---|
| 0 | `20261031900000_notifications_push_down.sql` | rien | oui (vérifié) |
| 1 | `20261031620000_strava_down.sql` (Strava en sommeil : migration à ne pas appliquer au lancement, docs/STRAVA.md) | rien | oui (vérifié) |
| 2 | `20261031510000_chat_coach_down.sql` | rien | oui (vérifié) |
| 3 | `20261031500000_commentaires_down.sql` | rien (son en-tête conseille quand même le chat avant) | oui (vérifié) |
| 4 | `20261031400000_parrainage_down.sql` | rien | oui (vérifié) |
| 5 | `20261031300000_partage_coach_down.sql` | rien | oui (vérifié) |
| 6 | `20261031230000_newsletter_down.sql` | rien | oui (vérifié) |
| 7 | `20261031200000_reactions_profil_down.sql` | commentaires (3) | non |
| 8 | `20261031100000_records_series_down.sql` | rien | oui (vérifié) |
| 9 | `20261031000000_payant_plus_down.sql` | rien | oui (vérifié) |
| 10 | `20261030000000_payant_tarifs_down.sql` | payant plus (9) | non, refuse sans rien changer |
| 11 | `20261029000000_payant_modele_b_down.sql` | tarifs (10) | non, refuse sans rien changer |

« Dépend de » : la migration plus récente réécrit des fonctions de celle-ci (my_activity, réécrite par les commentaires, pour 7 ; access_json, access_refresh, access_claim, srv_access_* pour 10 et 11). Les retours arrière 10 et 11 s'arrêtent d'eux-mêmes (exception, transaction annulée) si la migration du dessus est encore en place. Pour 7, suivre l'ordre : lancé avant 3, il retire mark_activity_seen et my_shown_sessions que les commentaires utilisent.

Les retours arrière marqués « oui (vérifié) » ont été lancés seuls sur la pile complète, puis les tests SQL de tous les autres lots ont été relancés et sont verts : ils ne cassent aucune migration postérieure restée en place.

## Ce qui est mis de côté, pas effacé

- `private.parrainage_archive_*` (parrainage : partenaires, conditions des coachs, attributions, virements) ;
- `private.tarifs_archive_*` (demandes de rôle coach, attributions élève → coach, codes d'offre Apple) ;
- `private.modele_b_archive_*` (offre de lancement et environnement de chaque transaction, plafonds d'élèves gratuits) ;
- `private.payant_plus_*` (accès à vie offerts puis retirés).

Aucun rôle de l'API n'y a accès. Les effacer à la main quand ils ne servent plus. Une nouvelle montée de la migration ne les relit pas.

## Ce qui ne revient pas

- Modèle B : la date de début de l'essai maison (recréée à maintenant pour chaque compte, qui repart pour 90 jours) et les transactions « Accès offert » d'Apple, effacées par la migration. La colonne `entitlements.trial_started_at` revient en dernière position : seule différence de forme avec le 28/10, sans effet.
- Tarifs : les codes permanents des coachs (12 caractères, refusés par la contrainte d'avant).

## Vérifier

```sh
bash tests/sql/rollback_nuit_check.sh
```

Postgres local jetable, rien n'est envoyé au projet Supabase.
