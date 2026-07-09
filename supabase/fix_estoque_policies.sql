-- ============================================================
-- SEGURANÇA: (re)cria as permissões (policies) do Estoque
-- Rode no SQL Editor do Supabase se a criação de categoria/item
-- não estiver funcionando. Seguro rodar mais de uma vez.
-- ============================================================

alter table public.estoque_categorias enable row level security;
alter table public.estoque_itens enable row level security;

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

notify pgrst, 'reload schema';
