-- ============================================================
-- MIGRAÇÃO: setores próprios da página Semana
-- Rode no SQL Editor do Supabase. Seguro rodar mais de uma vez.
--
-- Em vez de listar TODAS as etapas, o admin cria só os setores
-- que usa no planejamento (Prensagem, Costura, Impressão, ...).
-- ============================================================

create table if not exists public.semana_setores (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  cor text not null default '#ec1c24',
  ordem int not null default 0,
  created_at timestamptz not null default now()
);

-- setores iniciais (só se a tabela estiver vazia; o admin edita depois)
do $$ begin
  if not exists (select 1 from public.semana_setores) then
    insert into public.semana_setores (nome, cor, ordem) values
      ('Prensagem', '#f59e0b', 1),
      ('Costura',   '#fb923c', 2),
      ('Impressão', '#818cf8', 3);
  end if;
end $$;

alter table public.semana_setores enable row level security;
drop policy if exists "ssetores_select" on public.semana_setores;
drop policy if exists "ssetores_admin_insert" on public.semana_setores;
drop policy if exists "ssetores_admin_update" on public.semana_setores;
drop policy if exists "ssetores_admin_delete" on public.semana_setores;
create policy "ssetores_select" on public.semana_setores for select to authenticated using (true);
create policy "ssetores_admin_insert" on public.semana_setores for insert to authenticated with check (public.is_admin());
create policy "ssetores_admin_update" on public.semana_setores for update to authenticated using (public.is_admin());
create policy "ssetores_admin_delete" on public.semana_setores for delete to authenticated using (public.is_admin());

-- o plano passa a apontar para o setor próprio (a coluna etapa_id antiga fica sem uso)
alter table public.plano_semana
  add column if not exists setor_id uuid references public.semana_setores(id) on delete set null;

do $$ begin alter publication supabase_realtime add table public.semana_setores; exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
