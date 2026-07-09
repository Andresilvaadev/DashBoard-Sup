-- ============================================================
-- MIGRAÇÃO: Estoque (categorias + itens)
-- Rode este arquivo INTEIRO no SQL Editor do Supabase e clique RUN.
-- Seguro para rodar mais de uma vez.
--
--   estoque_categorias = tópicos principais (Dry Fit, Caneca, Linha, Papel…)
--   estoque_itens      = subtópicos de cada categoria (Dry Fit texturizado,
--                        Caneca 800, Algodão azul…), com quantidade
-- ============================================================

create table if not exists public.estoque_categorias (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  ordem int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.estoque_itens (
  id uuid primary key default gen_random_uuid(),
  categoria_id uuid not null references public.estoque_categorias(id) on delete cascade,
  nome text not null,
  quantidade numeric not null default 0,
  ordem int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists estoque_itens_categoria_idx on public.estoque_itens (categoria_id);

alter table public.estoque_categorias enable row level security;
alter table public.estoque_itens enable row level security;

-- leitura para todos os autenticados; criação/edição/exclusão apenas admin
drop policy if exists "estoque_cat_select" on public.estoque_categorias;
drop policy if exists "estoque_cat_admin_insert" on public.estoque_categorias;
drop policy if exists "estoque_cat_admin_update" on public.estoque_categorias;
drop policy if exists "estoque_cat_admin_delete" on public.estoque_categorias;
create policy "estoque_cat_select" on public.estoque_categorias for select to authenticated using (true);
create policy "estoque_cat_admin_insert" on public.estoque_categorias for insert to authenticated with check (public.is_admin());
create policy "estoque_cat_admin_update" on public.estoque_categorias for update to authenticated using (public.is_admin());
create policy "estoque_cat_admin_delete" on public.estoque_categorias for delete to authenticated using (public.is_admin());

drop policy if exists "estoque_item_select" on public.estoque_itens;
drop policy if exists "estoque_item_admin_insert" on public.estoque_itens;
drop policy if exists "estoque_item_admin_update" on public.estoque_itens;
drop policy if exists "estoque_item_admin_delete" on public.estoque_itens;
create policy "estoque_item_select" on public.estoque_itens for select to authenticated using (true);
create policy "estoque_item_admin_insert" on public.estoque_itens for insert to authenticated with check (public.is_admin());
create policy "estoque_item_admin_update" on public.estoque_itens for update to authenticated using (public.is_admin());
create policy "estoque_item_admin_delete" on public.estoque_itens for delete to authenticated using (public.is_admin());

-- Ajuste de quantidade:
--   - QUALQUER funcionário pode DIMINUIR (consumo de material)
--   - AUMENTAR o estoque é apenas para admin
create or replace function public.ajustar_estoque(p_item_id uuid, p_delta numeric)
returns numeric language plpgsql security definer set search_path = public as $$
declare
  v_novo numeric;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  if p_delta > 0 and not public.is_admin() then
    raise exception 'Apenas administradores podem aumentar o estoque';
  end if;
  update public.estoque_itens
     set quantidade = greatest(0, quantidade + p_delta)
   where id = p_item_id
   returning quantidade into v_novo;
  if not found then
    raise exception 'Item não encontrado';
  end if;
  return v_novo;
end; $$;

-- realtime: reflete alterações em todos os aparelhos
do $$ begin alter publication supabase_realtime add table public.estoque_categorias; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.estoque_itens; exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
