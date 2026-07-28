-- ============================================================
-- MIGRAÇÃO: Lote de corte (o Mapa de Corte deixa de sumir)
-- Rode no SQL Editor do Supabase. Seguro rodar mais de uma vez.
--
-- O lote guarda os pedidos selecionados e o PROGRESSO do corte por
-- tamanho, para o operador marcar o que já cortou. Ao finalizar, os
-- pedidos avançam automaticamente para a próxima etapa.
-- ============================================================

create table if not exists public.lotes_corte (
  id uuid primary key default gen_random_uuid(),
  pedido_ids uuid[] not null default '{}',
  -- progresso: { "MANGA LONGA": { "M MASC": true, "G FEM": false } }
  progresso jsonb not null default '{}'::jsonb,
  finalizado_em timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists lotes_corte_aberto_idx on public.lotes_corte (finalizado_em, created_at desc);

alter table public.lotes_corte enable row level security;
drop policy if exists "lote_select" on public.lotes_corte;
drop policy if exists "lote_insert" on public.lotes_corte;
drop policy if exists "lote_update" on public.lotes_corte;
drop policy if exists "lote_admin_delete" on public.lotes_corte;
-- todos veem e podem marcar o progresso (quem corta precisa marcar);
-- excluir é só admin
create policy "lote_select" on public.lotes_corte for select to authenticated using (true);
create policy "lote_insert" on public.lotes_corte for insert to authenticated with check (true);
create policy "lote_update" on public.lotes_corte for update to authenticated using (true);
create policy "lote_admin_delete" on public.lotes_corte for delete to authenticated using (public.is_admin());

do $$ begin alter publication supabase_realtime add table public.lotes_corte; exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
