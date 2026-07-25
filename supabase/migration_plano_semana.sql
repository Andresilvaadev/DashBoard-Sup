-- ============================================================
-- MIGRAÇÃO: Planejamento da semana (página "Semana")
-- Rode no SQL Editor do Supabase. Seguro rodar mais de uma vez.
--
-- Cada item do plano é uma REFERÊNCIA ao pedido (o pedido continua
-- na aba dele) + o setor (etapa) onde o trabalho deve acontecer +
-- o dia planejado + uma mensagem livre.
-- ============================================================

create table if not exists public.plano_semana (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid references public.pedidos(id) on delete cascade,
  etapa_id uuid references public.etapas(id) on delete set null, -- setor alvo
  dia date not null,
  texto text not null default '',
  feito boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists plano_semana_dia_idx on public.plano_semana (dia);

alter table public.plano_semana enable row level security;
drop policy if exists "plano_select" on public.plano_semana;
drop policy if exists "plano_admin_insert" on public.plano_semana;
drop policy if exists "plano_update" on public.plano_semana;
drop policy if exists "plano_admin_delete" on public.plano_semana;
-- todos veem; admin cria/apaga; qualquer funcionário pode marcar como feito
create policy "plano_select" on public.plano_semana for select to authenticated using (true);
create policy "plano_admin_insert" on public.plano_semana for insert to authenticated with check (public.is_admin());
create policy "plano_update" on public.plano_semana for update to authenticated using (true);
create policy "plano_admin_delete" on public.plano_semana for delete to authenticated using (public.is_admin());

do $$ begin alter publication supabase_realtime add table public.plano_semana; exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
