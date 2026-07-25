-- ============================================================
-- DIAGNÓSTICO: "sou admin mas não consigo criar"
-- Rode no SQL Editor do projeto que o site usa (VITE_SUPABASE_URL).
-- Execute UMA consulta por vez e leia o resultado.
-- ============================================================

-- 1) Quem existe e qual o papel? (role precisa ser 'admin' E ativo = true)
select email, role, ativo, id from public.profiles order by email;

-- 2) Se o SEU e-mail não estiver como admin/ativo, corrija (troque o e-mail):
-- update public.profiles set role = 'admin', ativo = true where email = 'seu@email.com';

-- 3) O e-mail do login existe em profiles? Compare com as contas do Auth:
select u.email as email_no_login, p.role, p.ativo
  from auth.users u
  left join public.profiles p on p.id = u.id
 order by u.email;
-- Se aparecer alguma linha com role NULO, o perfil não foi criado.
-- Crie o perfil que falta (troque o e-mail):
-- insert into public.profiles (id, nome, email, role, ativo)
-- select id, coalesce(raw_user_meta_data->>'nome', split_part(email,'@',1)), email, 'admin', true
--   from auth.users where email = 'seu@email.com'
-- on conflict (id) do update set role = 'admin', ativo = true;

-- 4) A função is_admin existe? (a policy depende dela)
select proname from pg_proc where proname = 'is_admin';

-- 5) As policies da Semana estão no lugar?
select tablename, policyname, cmd
  from pg_policies
 where tablename in ('semana_setores','plano_semana')
 order by tablename, policyname;

-- 6) Depois de qualquer correção, recarregue o cache da API:
notify pgrst, 'reload schema';
