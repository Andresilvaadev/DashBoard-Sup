-- ============================================================
-- MIGRAÇÃO: Fichas técnicas + Layout de Corte (Mapa de Corte)
-- Rode no SQL Editor do Supabase. Seguro rodar mais de uma vez.
--
-- Um pedido pode ter VÁRIAS fichas técnicas (uma por modelagem).
-- Cada ficha tem sua grade de tamanhos e pode ter várias imagens;
-- UMA delas é marcada como "Layout de Corte" (layout_anexo_id),
-- o que garante exclusividade sem coluna extra nos anexos.
-- ============================================================

create table if not exists public.fichas_tecnicas (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  modelagem text not null,                       -- ex.: Manga Curta, Raglan
  tecido text not null default '',
  gola text not null default '',
  manga text not null default '',
  punho text not null default '',
  estampa text not null default '',
  -- grade de tamanhos: {"PP":4,"P":12,"M":28,...} — cada unidade = 1 par
  grade jsonb not null default '{}'::jsonb,
  observacoes text not null default '',
  -- imagem marcada como Layout de Corte (só pode haver uma por ficha)
  layout_anexo_id uuid references public.anexos(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists fichas_pedido_idx on public.fichas_tecnicas (pedido_id);
create index if not exists fichas_modelagem_idx on public.fichas_tecnicas (modelagem);

-- anexos podem pertencer a uma ficha específica (os antigos ficam no pedido)
alter table public.anexos
  add column if not exists ficha_id uuid references public.fichas_tecnicas(id) on delete cascade;
create index if not exists anexos_ficha_idx on public.anexos (ficha_id);

alter table public.fichas_tecnicas enable row level security;
drop policy if exists "fichas_select" on public.fichas_tecnicas;
drop policy if exists "fichas_admin_insert" on public.fichas_tecnicas;
drop policy if exists "fichas_admin_update" on public.fichas_tecnicas;
drop policy if exists "fichas_admin_delete" on public.fichas_tecnicas;
create policy "fichas_select" on public.fichas_tecnicas for select to authenticated using (true);
create policy "fichas_admin_insert" on public.fichas_tecnicas for insert to authenticated with check (public.is_admin());
create policy "fichas_admin_update" on public.fichas_tecnicas for update to authenticated using (public.is_admin());
create policy "fichas_admin_delete" on public.fichas_tecnicas for delete to authenticated using (public.is_admin());

do $$ begin alter publication supabase_realtime add table public.fichas_tecnicas; exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
