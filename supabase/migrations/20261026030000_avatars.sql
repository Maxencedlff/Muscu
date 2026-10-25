-- ═══════════════════════════════════════════════════════════
--  Avatars : liste blanche revue après les retours UX (emojis plus « salle », toujours sans
--  personnage ni partie du corps). Même liste et même ordre qu'AVATAR_EMOJIS dans
--  js/data/account-auth.js (test unitaire tests/unit/account.mjs).
--  Retirés : ⚽ 🏀 🎾 🏓 🌲 🍀 🌙 ; un profil qui en avait un repasse à 🔥 (défaut).
-- ═══════════════════════════════════════════════════════════

update public.user_profiles set avatar_emoji = '🔥'
  where avatar_emoji in ('⚽', '🏀', '🎾', '🏓', '🌲', '🍀', '🌙');

alter table public.user_profiles drop constraint user_profiles_avatar_emoji;
alter table public.user_profiles add constraint user_profiles_avatar_emoji check (
  char_length(avatar_emoji) <= 8
  and avatar_emoji = any (array[
      '🔥', '⚡', '🥇', '🏆', '👟', '🥊', '🏅', '⏱️', '🎽', '🥋',
      '🎯', '🔋', '🦍', '🦬', '🦁', '🐯', '🐻', '🐺', '🦊', '🐼',
      '🦅', '🦈', '🐙', '🦉', '🏔️', '🌊', '⭐', '🚀', '🎧', '💎'
  ])
);
