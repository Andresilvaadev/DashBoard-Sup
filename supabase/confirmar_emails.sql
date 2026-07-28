-- ============================================================
-- LIBERAR ACESSO: confirmar e-mails pendentes
-- Rode no SQL Editor do Supabase.
--
-- Use quando alguém foi cadastrado e não consegue entrar porque
-- o Supabase está pedindo confirmação de e-mail.
--
-- IMPORTANTE: isto resolve só quem JÁ existe. Para que os PRÓXIMOS
-- cadastros já nasçam liberados, desligue a exigência uma vez em:
--   Painel do Supabase → Authentication → Sign In / Providers → Email
--   → desmarque "Confirm email" → Save
-- ============================================================

-- Confirma TODOS os usuários com e-mail pendente
update auth.users
   set email_confirmed_at = coalesce(email_confirmed_at, now())
 where email_confirmed_at is null;

-- (Opcional) Confirmar apenas uma pessoa específica:
-- update auth.users
--    set email_confirmed_at = coalesce(email_confirmed_at, now())
--  where email = 'pessoa@empresa.com';

-- Conferir como ficou: quem ainda está pendente aparece com "PENDENTE"
select
  u.email,
  case when u.email_confirmed_at is null then 'PENDENTE' else 'confirmado' end as situacao,
  p.nome,
  p.role,
  case when p.ativo then 'ativo' else 'inativo' end as acesso
from auth.users u
left join public.profiles p on p.id = u.id
order by u.created_at desc;
