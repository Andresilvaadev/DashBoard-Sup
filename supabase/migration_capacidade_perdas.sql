-- ============================================================
-- MIGRAÇÃO: Capacidade da produção + Perdas de material
-- Rode este arquivo INTEIRO no SQL Editor do Supabase e clique RUN.
-- Seguro para rodar mais de uma vez.
--
--   config → configurações do sistema (ex.: capacidade diária em peças)
--   perdas → registro de perdas de material por pedido/funcionário
-- Os indicadores de capacidade são calculados dos próprios pedidos
-- (nada é duplicado; só a capacidade configurada fica salva).
-- ============================================================

-- ---------- CONFIGURAÇÕES (chave/valor) ----------
create table if not exists public.config (
  chave text primary key,
  valor text not null default '',
  atualizado_em timestamptz not null default now()
);

insert into public.config (chave, valor) values ('capacidade_diaria', '80')
on conflict (chave) do nothing;

alter table public.config enable row level security;
drop policy if exists "config_select" on public.config;
drop policy if exists "config_admin_insert" on public.config;
drop policy if exists "config_admin_update" on public.config;
create policy "config_select" on public.config for select to authenticated using (true);
create policy "config_admin_insert" on public.config for insert to authenticated with check (public.is_admin());
create policy "config_admin_update" on public.config for update to authenticated using (public.is_admin());

-- ---------- PERDAS DE MATERIAL ----------
create table if not exists public.perdas (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid references public.pedidos(id) on delete set null,
  funcionario_id uuid references public.profiles(id),
  material text not null,
  quantidade numeric not null default 0,
  unidade text not null default 'un',
  valor numeric not null default 0,          -- valor financeiro perdido (R$)
  motivo text not null default '',
  observacoes text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists perdas_created_idx on public.perdas (created_at);
create index if not exists perdas_funcionario_idx on public.perdas (funcionario_id);

alter table public.perdas enable row level security;
drop policy if exists "perdas_select" on public.perdas;
drop policy if exists "perdas_insert" on public.perdas;
drop policy if exists "perdas_admin_update" on public.perdas;
drop policy if exists "perdas_admin_delete" on public.perdas;
create policy "perdas_select" on public.perdas for select to authenticated using (true);
create policy "perdas_insert" on public.perdas for insert to authenticated with check (funcionario_id = auth.uid());
create policy "perdas_admin_update" on public.perdas for update to authenticated using (public.is_admin());
create policy "perdas_admin_delete" on public.perdas for delete to authenticated using (public.is_admin());

-- realtime
do $$ begin alter publication supabase_realtime add table public.perdas; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.config; exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
