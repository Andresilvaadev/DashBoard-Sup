-- ============================================================
-- SEMANA: permissões definitivas + marcar feito
-- Rode no SQL Editor do Supabase. Seguro rodar mais de uma vez.
--
-- Regras: TODOS veem o plano; SÓ ADMIN cria/edita/apaga tarefas e
-- setores; qualquer funcionário pode apenas MARCAR COMO FEITO
-- (via função própria, sem poder editar o resto).
-- ============================================================

-- 0) SE VOCÊ NÃO CONSEGUE CRIAR SETOR: sua conta precisa ser admin
--    neste projeto. Confira e promova (troque o e-mail):
--
--    select email, role, ativo from public.profiles;
--    update public.profiles set role = 'admin' where email = 'seu@email.com';

-- 1) editar/apagar itens do plano: só admin
drop policy if exists "plano_update" on public.plano_semana;
drop policy if exists "plano_admin_update" on public.plano_semana;
create policy "plano_admin_update" on public.plano_semana
  for update to authenticated using (public.is_admin());

-- 2) marcar como feito: qualquer funcionário autenticado, SÓ o campo feito
create or replace function public.marcar_feito_semana(p_id uuid, p_feito boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  update public.plano_semana set feito = p_feito where id = p_id;
  if not found then
    raise exception 'Item não encontrado';
  end if;
end; $$;

notify pgrst, 'reload schema';
