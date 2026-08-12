-- ============================================================
-- GESTOR PASSA A CRIAR FICHAS TÉCNICAS
-- Rode este arquivo INTEIRO no SQL Editor do Supabase.
-- Seguro rodar mais de uma vez.
--
-- A ficha técnica faz parte do cadastro do pedido — quem pode criar e
-- editar pedidos também precisa poder preencher a ficha. Antes só o
-- administrador conseguia, então o Gestor travava nessa etapa.
-- ============================================================

drop policy if exists "fichas_admin_insert" on public.fichas_tecnicas;
drop policy if exists "fichas_admin_update" on public.fichas_tecnicas;
drop policy if exists "fichas_admin_delete" on public.fichas_tecnicas;
drop policy if exists "fichas_gestor_insert" on public.fichas_tecnicas;
drop policy if exists "fichas_gestor_update" on public.fichas_tecnicas;
drop policy if exists "fichas_gestor_delete" on public.fichas_tecnicas;

create policy "fichas_gestor_insert" on public.fichas_tecnicas
  for insert to authenticated with check (public.pode_gerenciar_pedidos());
create policy "fichas_gestor_update" on public.fichas_tecnicas
  for update to authenticated using (public.pode_gerenciar_pedidos());
create policy "fichas_gestor_delete" on public.fichas_tecnicas
  for delete to authenticated using (public.pode_gerenciar_pedidos());

-- ============================================================
-- Conferir quem pode o quê:
--   select nome, role from public.profiles order by role, nome;
-- ============================================================
