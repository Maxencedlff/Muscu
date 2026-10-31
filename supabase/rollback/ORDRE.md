# Retours arrière : ordre de démontage

Les fichiers `*_down.sql` de ce dossier défont une migration de `supabase/migrations/`. Supabase ne les applique jamais de lui-même : chacun se lance à la main dans l'éditeur SQL, sur décision de Maxence, après avoir lu son en-tête (ce qu'il faut couper avant, ce qui est effacé, ce qui est mis de côté).

## Règle

**Toujours de la migration la plus récente vers la plus ancienne.** Cet ordre est vérifié marche par marche par `tests/sql/rollback_lot3_check.sh`, qui compare le `pg_dump` complet (schéma, droits, politiques, déclencheurs et données) avec celui d'une base où la migration n'a jamais été appliquée.

| # | Retour arrière | Dépend de (à démonter avant) |
|---|---|---|
| 1 | `20261031510000_chat_coach_down.sql` | rien |
| 2 | `20261031500000_commentaires_down.sql` | rien (son en-tête conseille quand même le chat avant) |
| 3 | `20261031400000_parrainage_down.sql` | rien |
| 4 | `20261031300000_partage_coach_down.sql` | rien |
| 5 | `20261031200000_reactions_profil_down.sql` | commentaires (2) : ils réécrivent my_activity et utilisent mark_activity_seen et my_shown_sessions |
| 6 | `20261031100000_records_series_down.sql` | rien |

## Ce qui est mis de côté, pas effacé

`private.parrainage_archive_*` (parrainage : partenaires, conditions des coachs, attributions, virements). Aucun rôle de l'API n'y a accès. Les effacer à la main quand les comptes sont soldés. Une nouvelle montée de la migration ne les relit pas.

## Vérifier

```sh
bash tests/sql/rollback_lot3_check.sh     # démontage complet et chaque marche seule
bash tests/sql/rollback_check.sh          # réactions, avec données
bash tests/sql/rollback_social_check.sh   # commentaires et chat, avec données
```

Postgres local jetable, rien n'est envoyé au projet Supabase.
