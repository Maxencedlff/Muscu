# Sauvegardes de la base

L'offre gratuite de Supabase ne fait **aucune** sauvegarde (ni quotidienne, ni PITR). Le workflow
`.github/workflows/sauvegarde-base.yml` en fait une chaque nuit (02:41 UTC) et à la demande :

```sh
gh workflow run sauvegarde-base.yml -R Maxencedlff/Muscu
```

## Ce que contient une sauvegarde

Un artefact GitHub `mdlf-base-AAAAMMJJ-HHMM` gardé **90 jours**, qui contient un seul fichier
`mdlf-base-….tar.gpg` (archive tar chiffrée en AES-256, gpg symétrique). Déchiffrée, l'archive donne
`sauvegarde/` :

| Fichier | Contenu |
|---|---|
| `base.dump` | `pg_dump -Fc` de toute la base : `public`, `auth` (comptes, identités Apple/Google, sessions), `storage` (buckets et métadonnées des fichiers), `private`, `coach_photo_rls`, `cron` (tâches planifiées), `vault` (secrets **chiffrés**) |
| `roles.sql` | Rôles et appartenances (`pg_dumpall --roles-only`), **sans mots de passe** |
| `comptes.txt` | Nombre de lignes de chaque table au moment du dump |
| `comptes.sql` | La requête qui produit `comptes.txt` (à relancer après une restauration) |
| `infos.txt` | Date, version du serveur et de pg_dump, commit |

Chaque nuit, le workflow **restaure** le dump dans un Postgres jetable et compare les comptes de
lignes : il échoue si une table qui a des lignes en prod revient vide.

### Ce qui n'est PAS dans la sauvegarde

- **Les fichiers eux-mêmes** du Storage (photos de bilan, etc.) : seules leurs métadonnées
  (`storage.objects`) y sont. Les fichiers vivent dans le stockage objet de Supabase.
- **Les mots de passe des rôles** et les réglages du projet (Auth, SMTP, URL de redirection, secrets
  des fonctions Edge) : ils se règlent par la Management API ou le tableau de bord.
- **Les secrets du Vault** sont exportés chiffrés avec une clé propre au projet Supabase : sur un
  nouveau projet, ils sont illisibles. Les recréer à la main (`push_cron_secret`,
  `photos_purge_secret`, valeurs dans `~/.config/mdlf/`).
- **Le code des fonctions Edge** : il est dans le dépôt (`supabase/functions/`).

## Où sont les clés

- Phrase de déchiffrement : secret CI `SAUVEGARDE_CLE`, copie locale `~/.config/mdlf/sauvegarde_cle`
  (chmod 600). **Sans elle, les sauvegardes sont perdues** : en garder une copie hors du PC
  (gestionnaire de mots de passe).
- Mot de passe de la base : secret CI `SUPABASE_DB_PASSWORD`, copie locale
  `~/.config/mdlf/supabase_db_pass`. S'il est changé, mettre à jour le secret :
  `gh secret set SUPABASE_DB_PASSWORD -R Maxencedlff/Muscu < ~/.config/mdlf/supabase_db_pass`.

## Restaurer

Il faut `pg_restore` de la **même version majeure** que le serveur (Postgres 17 aujourd'hui, voir
`infos.txt`). Sous Ubuntu/WSL : dépôt PGDG puis `sudo apt install postgresql-17 postgresql-client-17`.

### 1. Télécharger et déchiffrer

```sh
mkdir -p ~/restauration && cd ~/restauration
gh run list -R Maxencedlff/Muscu -w sauvegarde-base.yml -L 5          # choisir une exécution réussie
gh run download <id> -R Maxencedlff/Muscu                             # donne mdlf-base-…/mdlf-base-….tar.gpg
gpg --batch --pinentry-mode loopback --passphrase-file ~/.config/mdlf/sauvegarde_cle \
    -d mdlf-base-*/mdlf-base-*.tar.gpg | tar -xf -
cat sauvegarde/infos.txt
```

### 2a. Vérifier dans un Postgres local jetable (sans toucher la prod)

```sh
B=/usr/lib/postgresql/17/bin; D=$PWD/pg
$B/initdb -D $D/data -U postgres -A trust
$B/pg_ctl -D $D/data -o "-p 55432 -k $D -c listen_addresses=''" -l $D/log start
psql "host=$D port=55432 user=postgres dbname=postgres" -q -f sauvegarde/roles.sql      # erreurs sur postgres/supabase_admin : normales
$B/pg_restore -d "host=$D port=55432 user=postgres dbname=postgres" sauvegarde/base.dump  # erreurs pg_cron/pg_net/vault : normales (extensions Supabase)
psql "host=$D port=55432 user=postgres dbname=postgres" -AtF' ' -f sauvegarde/comptes.sql > restaures.txt
diff sauvegarde/comptes.txt restaures.txt && echo "Comptes identiques"
$B/pg_ctl -D $D/data stop -m fast                                                      # puis rm -rf pg
```

### 2b. Remettre en production (base perdue ou abîmée)

1. **Nouveau projet Supabase** (recommandé) ou projet existant vidé, en Postgres 17, même région
   (eu-west-1). Sur un projet Supabase, les extensions pg_cron, pg_net et supabase_vault existent :
   les erreurs du test local disparaissent.
2. Restaurer **sans** les rôles (Supabase les crée déjà), en tant que `postgres` par le pooler en mode
   session :
   ```sh
   export PGPASSWORD=…   # mot de passe de la base du projet cible
   C="host=aws-0-eu-west-1.pooler.supabase.com port=5432 dbname=postgres user=postgres.<ref> sslmode=require"
   pg_restore -d "$C" --no-owner --no-privileges -n public -n private -n coach_photo_rls sauvegarde/base.dump
   pg_restore -d "$C" --data-only -n auth -n storage --disable-triggers sauvegarde/base.dump
   ```
   Les schémas `auth` et `storage` appartiennent à Supabase : on n'y remet que les **données**
   (comptes, identités, buckets, métadonnées). Les droits (GRANT, RLS) de `public` viennent du dump
   sans `--no-privileges` si le projet cible a les mêmes rôles : relancer alors la 1re commande sans
   `--no-privileges` sur un projet neuf, ou rejouer `supabase/migrations/`.
3. Recréer les tâches cron et les secrets du Vault (voir plus haut), redéployer les fonctions Edge
   et leurs secrets, régler Auth (site_url, redirections, Apple, Google, SMTP).
4. Relancer `comptes.sql` sur la nouvelle base et comparer à `comptes.txt`.
5. Si la référence du projet a changé : mettre à jour l'URL et la clé publique dans l'app
   (nouvelle mise à jour), et `PGUSER` dans `sauvegarde-base.yml`.

## Choix retenus

- **Artefact chiffré plutôt que dépôt dédié** : pas de jeton supplémentaire avec droit d'écriture
  dans les secrets CI ; 90 jours de profondeur ; une archive fait ~1 Mo, très loin du quota.
  Limite : si le dépôt Muscu est supprimé, les sauvegardes partent avec. Pour une copie hors GitHub,
  télécharger de temps en temps une archive (elle reste chiffrée).
- **gpg plutôt qu'age** : présent d'office sur les runners et sous WSL, rien à installer.
- **Pooler en mode session** : la connexion directe n'existe qu'en IPv6, absente des runners
  GitHub. Le mode transaction (port 6543) ne convient pas à pg_dump.
- **Pas de restriction d'adresses IP sur la base** : les runners GitHub changent d'adresse à chaque
  exécution ; filtrer casserait la sauvegarde. La base est protégée par SSL imposé et un mot de passe
  aléatoire de 40 caractères.
- **Dépôt public par moments** : GitHub désactive les workflows planifiés d'un dépôt public sans
  activité depuis 60 jours ; un e-mail prévient, il suffit de le réactiver.
