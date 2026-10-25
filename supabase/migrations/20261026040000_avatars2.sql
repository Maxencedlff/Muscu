-- ═══════════════════════════════════════════════════════════
--  Avatars : facultatifs, liste blanche plus sobre. Même liste et même ordre qu'AVATAR_EMOJIS dans
--  js/data/account-auth.js (test unitaire tests/unit/account.mjs).
--  - avatar_emoji devient nullable, sans défaut : null = aucun avatar, l'app montre l'initiale du
--    pseudo sur un disque gris (comme Contacts).
--  - Retirés : 🔥 (ancien défaut) ⚡ 🎯 🔋 🚀 💎 ; un profil qui en avait un repasse à null.
--  À appliquer APRÈS la mise à jour à chaud de l'app : l'ancienne app envoie 🔥 à la création d'un
--  profil (refusé par la nouvelle contrainte), la nouvelle n'envoie rien tant qu'aucun emoji n'est
--  choisi et affiche 🔥 comme une initiale.
-- ═══════════════════════════════════════════════════════════

alter table public.user_profiles drop constraint user_profiles_avatar_emoji;
alter table public.user_profiles alter column avatar_emoji drop not null;
alter table public.user_profiles alter column avatar_emoji drop default;

update public.user_profiles set avatar_emoji = null
  where avatar_emoji in ('🔥', '⚡', '🎯', '🔋', '🚀', '💎');

alter table public.user_profiles add constraint user_profiles_avatar_emoji check (
  avatar_emoji is null or (
    char_length(avatar_emoji) <= 8
    and avatar_emoji = any (array[
        '🏆', '🥇', '🏅', '🥊', '🥋', '👟', '🎽', '⏱️', '🎧', '⭐',
        '🦍', '🦬', '🦁', '🐯', '🐻', '🐺', '🦊', '🐼', '🦅', '🦈',
        '🐙', '🦉', '🏔️', '🌊'
    ])
  )
);
