# Retours arrière : ordre de démontage

Les fichiers `*_down.sql` de ce dossier défont une migration de `supabase/migrations/`. Supabase ne les applique jamais de lui-même : chacun se lance à la main dans l'éditeur SQL, sur décision de Maxence, après avoir lu son en-tête (ce qu'il faut couper avant, ce qui est effacé, ce qui est mis de côté).

## Règle

**Toujours de la migration la plus récente vers la plus ancienne.** Cet ordre est le seul vérifié marche par marche par `tests/sql/rollback_nuit_check.sh`, qui compare après chaque retour arrière le `pg_dump` complet (schéma, droits, politiques, déclencheurs et données) avec celui d'une base où la migration n'a jamais été appliquée.

| # | Retour arrière | Dépend de (à démonter avant) | Peut se lancer seul sur la pile complète |
|---|---|---|---|
| −7 | `20261107000000_photos_bilan_down.sql` (vider d'abord le compartiment `coach-photos` par l'API Storage : il refuse sinon ; il retire lui-même la tâche pg_cron `coach-photos-purge` et le secret Vault `photos_purge_secret` ; restent à la main `supabase functions delete coach-photos-purge` et `supabase secrets unset PHOTOS_PURGE_SECRET`) | rien | oui (vérifié) |
| −6 | `20261106200000_plans_diete_coach_down.sql` | rien | oui (vérifié) |
| −5 | `20261106100000_seance_publique_intensif_prise_down.sql` | rien | oui (vérifié) |
| −4 | `20261106000000_coach_progression_down.sql` | rien | oui (vérifié) |
| −3 | `20261105010000_partage_mensurations_down.sql` | plans diète du coach (−6) : il réécrit après lui la contrainte de `coach_shares.kind`, `share_kind_open` et `student_shares` | oui pour les autres lots (vérifié) ; l'accord des plans diète ne marche plus alors : défaire −6 avant |
| −2 | `20261105000000_coach_planning_down.sql` | rien | oui (vérifié) |
| −1 | `20261101000000_parrainage_payant_down.sql` | rien | oui (vérifié) |
| 0a | `20261031910000_notifications_messages_down.sql` | rien | oui (vérifié) |
| 0 | `20261031900000_notifications_push_down.sql` | notifications des messages et commentaires (0a) : elles remplacent ses fonctions | non |
| 1 | `20261031620000_strava_down.sql` (Strava en sommeil : migration à ne pas appliquer au lancement, docs/STRAVA.md) | rien | oui (vérifié) |
| 2 | `20261031510000_chat_coach_down.sql` | notifications des messages (0a) : son déclencheur lit coach_messages | non |
| 3 | `20261031500000_commentaires_down.sql` | notifications des messages (0a) : elles s'appuient sur les commentaires ; le chat (2) avant, conseillé par son en-tête | non |
| 4 | `20261031400000_parrainage_down.sql` | parrainage du payant (−1) : la table des paiements référence les attributions | non, refuse sans rien changer |
| 5 | `20261031300000_partage_coach_down.sql` | mensurations partagées (−3) : leur table s'appuie sur `coach_shares` ; plans diète du coach (−6) : son accord et son déclencheur sont sur `coach_shares` | non |
| 6 | `20261031230000_newsletter_down.sql` | rien | oui (vérifié) |
| 7 | `20261031200000_reactions_profil_down.sql` | commentaires (3) | non |
| 8 | `20261031100000_records_series_down.sql` | progression des élèves (−4) : `coach_progress` lit `private.session_records` ; séance publique (−5) de préférence avant (seul, il remplace aussi son `session_public`) | non (seul, tout le reste marche : vérifié sans les tests de la progression ni de la séance publique) |
| 9 | `20261031000000_payant_plus_down.sql` | rien | oui (vérifié) |
| 10 | `20261030000000_payant_tarifs_down.sql` | payant plus (9) | non, refuse sans rien changer |
| 11 | `20261029000000_payant_modele_b_down.sql` | tarifs (10) | non, refuse sans rien changer |

« Dépend de » : la migration plus récente réécrit des fonctions de celle-ci (my_activity, réécrite par les commentaires, pour 7 ; access_json, access_refresh, access_claim, srv_access_* pour 10 et 11). Les retours arrière 4, 10 et 11 s'arrêtent d'eux-mêmes (exception, transaction annulée) si la migration du dessus est encore en place. Pour 7, suivre l'ordre : lancé avant 3, il retire mark_activity_seen et my_shown_sessions que les commentaires utilisent.

Les retours arrière marqués « oui (vérifié) » ont été lancés seuls sur la pile complète, puis les tests SQL de tous les autres lots ont été relancés et sont verts : ils ne cassent aucune migration postérieure restée en place.

## En production : ordre de la mise en production, et son inverse

La production a reçu toutes les migrations de `main` (lot 3, notifications push et notifications des messages compris) et `20261028000000_payant.sql`. Les migrations du payant datées d'avant le lot 3 y arrivent donc **après** des migrations plus récentes qu'elles. Ordre de mise en production, vérifié par `tests/sql/prod_order_test.sh` (production simulée avec des données, schéma obtenu identique à une base neuve, tests de tous les lots, puis retours arrière dans l'ordre inverse, état d'avant retrouvé à chaque marche) :

1. `20261029000000_payant_modele_b.sql`
2. `20261030000000_payant_tarifs.sql`
3. `20261031000000_payant_plus.sql`
4. `20261031230000_newsletter.sql`
5. `20261101000000_parrainage_payant.sql`
6. `20261105000000_coach_planning.sql`
7. `20261105010000_partage_mensurations.sql`
8. `20261106000000_coach_progression.sql`
9. `20261106100000_seance_publique_intensif_prise.sql` (séance vue par un ami ou un coach : techniques d'intensification et prise ; indépendante, peut aussi passer seule)
10. `20261106200000_plans_diete_coach.sql` (après l'OTA qui demande l'accord de l'élève : sinon les coachs ne peuvent plus envoyer de plan diète tant que leurs élèves n'ont pas la version qui sait accepter ; et après les mensurations, dont il garde la donnée)
11. `20261107000000_photos_bilan.sql` (photos de bilan chiffrées de bout en bout, docs/PHOTOS_BILAN.md : indépendante ; avant l'OTA, avec la fonction `coach-photos-purge` et sa planification)

Jamais `20261031620000_strava.sql` au lancement (Strava en sommeil, docs/STRAVA.md).

**En deux temps : les neuf fichiers 1 à 9 AVANT l'OTA, le 10e (`20261106200000_plans_diete_coach.sql`) APRÈS l'OTA**, une fois la version qui sait demander l'accord des plans diète installée chez les élèves. Le 11e (photos de bilan) est indépendant : voir « Vague 2 » ci-dessous.

Chaque fichier se colle dans l'éditeur SQL, dans cet ordre, l'un après l'autre. Pas de `supabase db push` : il refuse ces fichiers, plus anciens que la dernière migration appliquée ; et **jamais `supabase db push --include-all`**, qui pousserait d'un coup tout ce qui manque, le 10e fichier compris (et Strava), avant l'OTA.

**État de la production au 08/11/2026** : 6 à 9 appliqués le 07/11 vers 20 h (avant l'OTA 2026.11.7-2633219), 10 (plans diète) appliqué juste après cette OTA, chacun dans une transaction par l'éditeur SQL (API de gestion). **1 à 5 (payant, lettre d'information) PAS appliqués** : en attente de l'accord de Maxence ; essai vérifié : 6 à 10 passent sans eux sur la production simulée (seul `coach_test.sql` « équipe pleine » dépend des tarifs).

### Vague 2 (Social V2 + photos de bilan) : une seule migration

Pour cette vague, **appliquer seulement `20261107000000_photos_bilan.sql`** (11e de la liste), avant l'OTA, avec la fonction `coach-photos-purge`, son secret et sa planification (docs/PHOTOS_BILAN.md). Elle ne s'appuie que sur des migrations déjà en production (coach du 27/10) : `tests/sql/prod_order_test.sh` (étape 6) la passe seule sur la production simulée, lance ses tests, puis son retour arrière, qui rend la base à l'identique.

Les cinq migrations du payant (1 à 5 : modèle B, tarifs, payant plus, lettre d'information, parrainage du payant) **ne font pas partie de cette vague** : elles attendent l'accord de Maxence.

Pour défaire en production : l'ordre inverse de cette liste (11 → 1), avant tout retour arrière plus ancien.

## Ce qui est mis de côté, pas effacé

- `private.parrainage_archive_*` (parrainage : partenaires, conditions des coachs, attributions, virements) ;
- `private.tarifs_archive_*` (demandes de rôle coach, codes d'offre Apple) ;
- `private.parrainage_payant_archive_payments` (paiements d'Apple notés pour les commissions) ;
- `private.modele_b_archive_*` (offre de lancement et environnement de chaque transaction, plafonds d'élèves gratuits) ;
- `private.payant_plus_*` (accès à vie offerts puis retirés).

Aucun rôle de l'API n'y a accès. Les effacer à la main quand ils ne servent plus. Une nouvelle montée de la migration ne les relit pas.

## Ce qui ne revient pas

- Modèle B : la date de début de l'essai maison (recréée à maintenant pour chaque compte, qui repart pour 90 jours) et les transactions « Accès offert » d'Apple, effacées par la migration. La colonne `entitlements.trial_started_at` revient en dernière position : seule différence de forme avec le 28/10, sans effet.
- Tarifs : les codes permanents des coachs (12 caractères, refusés par la contrainte d'avant).

## Vérifier

```sh
bash tests/sql/rollback_nuit_check.sh     # tous les retours arrière : seuls, puis démontage complet
bash tests/sql/prod_order_test.sh         # mise en production dans l'ordre réel, puis son inverse
bash tests/sql/rollback_lot3_check.sh     # lot 3 : démontage complet et chaque marche seule
bash tests/sql/rollback_check.sh          # réactions, avec données
bash tests/sql/rollback_social_check.sh   # commentaires et chat, avec données
bash tests/sql/rollback_push_check.sh     # notifications push
bash tests/sql/photos_bilan_rollback_test.sh   # photos de bilan : planification et secret de la purge retirés
```

Postgres local jetable, rien n'est envoyé au projet Supabase.
