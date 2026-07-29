-- ============================================================
-- NOVO PAPEL: ADMINISTRATIVO (gestor)
-- Rode este arquivo INTEIRO no SQL Editor do Supabase.
-- Seguro rodar mais de uma vez.
--
-- O "Administrativo" pode:
--   • criar, editar e excluir pedidos nas abas Pedidos, Criação e Canecas
--   • montar e editar o planejamento Semanal (setores e itens)
-- O "Administrativo" NÃO pode:
--   • gerenciar funcionários, fluxo de etapas, metas, estoque,
--     configurações do sistema ou zerar a produção
-- Funcionários comuns continuam apenas movendo pedidos de etapa.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Aceita o novo valor na coluna role
-- ------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('admin', 'gestor', 'funcionario'));

-- ------------------------------------------------------------
-- 2. Helper: quem pode gerenciar pedidos e o planejamento semanal
--    (admin OU gestor). is_admin() continua valendo só para admin.
-- ------------------------------------------------------------
create or replace function public.pode_gerenciar_pedidos()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
     where id = auth.uid() and ativo and role in ('admin', 'gestor')
  );
$$;

-- ------------------------------------------------------------
-- 3. PEDIDOS: criação/edição/exclusão liberada para o administrativo
-- ------------------------------------------------------------
drop policy if exists "pedidos_admin_insert" on public.pedidos;
drop policy if exists "pedidos_admin_update" on public.pedidos;
drop policy if exists "pedidos_admin_delete" on public.pedidos;

create policy "pedidos_gestor_insert" on public.pedidos
  for insert to authenticated with check (public.pode_gerenciar_pedidos());
create policy "pedidos_gestor_update" on public.pedidos
  for update to authenticated using (public.pode_gerenciar_pedidos());
create policy "pedidos_gestor_delete" on public.pedidos
  for delete to authenticated using (public.pode_gerenciar_pedidos());

-- anexos: quem gerencia pedidos também pode remover anexos deles
drop policy if exists "anexos_admin_delete" on public.anexos;
create policy "anexos_gestor_delete" on public.anexos
  for delete to authenticated using (public.pode_gerenciar_pedidos());

-- e apagar o arquivo em si do bucket de anexos
drop policy if exists "anexos_storage_delete_admin" on storage.objects;
create policy "anexos_storage_delete_admin" on storage.objects
  for delete to authenticated using (bucket_id = 'anexos' and public.pode_gerenciar_pedidos());

-- ------------------------------------------------------------
-- 4. Funções de pedido passam a aceitar o administrativo
-- ------------------------------------------------------------
create or replace function public.criar_pedido(
  p_numero int,
  p_cliente text,
  p_descricao text default '',
  p_quantidade int default 1,
  p_prioridade text default 'normal',
  p_data_prevista date default null,
  p_tipo text default 'pronto'
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_primeira uuid;
  v_fluxo text := case when p_tipo = 'pronto' then 'producao' else p_tipo end;
begin
  if not public.pode_gerenciar_pedidos() then
    raise exception 'Sem permissão para criar pedidos';
  end if;

  -- o pedido nasce na primeira etapa do SEU fluxo
  select id into v_primeira from public.etapas
   where ativo and fluxo = v_fluxo
   order by ordem limit 1;

  insert into public.pedidos (numero, cliente, descricao, quantidade, prioridade, etapa_atual_id, data_prevista, tipo, created_by)
  values (p_numero, p_cliente, coalesce(p_descricao,''), p_quantidade, p_prioridade, v_primeira, p_data_prevista, coalesce(p_tipo, 'pronto'), auth.uid())
  returning id into v_id;

  insert into public.historico (pedido_id, etapa_id, funcionario_id, observacao)
  values (v_id, v_primeira, auth.uid(), 'Pedido criado');

  return v_id;
end; $$;

create or replace function public.excluir_pedido(p_numero int)
returns text[] language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_paths text[];
begin
  if not public.pode_gerenciar_pedidos() then
    raise exception 'Sem permissão para excluir pedidos';
  end if;

  select id into v_id from public.pedidos where numero = p_numero;
  if not found then
    raise exception 'Pedido % não encontrado', p_numero;
  end if;

  select coalesce(array_agg(path), '{}') into v_paths
    from public.anexos where pedido_id = v_id;

  delete from public.historico where pedido_id = v_id;
  delete from public.anexos where pedido_id = v_id;
  delete from public.pedidos where id = v_id;

  return v_paths;
end; $$;

-- ------------------------------------------------------------
-- 5. SEMANAL: setores e itens do planejamento
-- ------------------------------------------------------------
drop policy if exists "ssetores_admin_insert" on public.semana_setores;
drop policy if exists "ssetores_admin_update" on public.semana_setores;
drop policy if exists "ssetores_admin_delete" on public.semana_setores;

create policy "ssetores_gestor_insert" on public.semana_setores
  for insert to authenticated with check (public.pode_gerenciar_pedidos());
create policy "ssetores_gestor_update" on public.semana_setores
  for update to authenticated using (public.pode_gerenciar_pedidos());
create policy "ssetores_gestor_delete" on public.semana_setores
  for delete to authenticated using (public.pode_gerenciar_pedidos());

drop policy if exists "plano_admin_insert" on public.plano_semana;
drop policy if exists "plano_admin_update" on public.plano_semana;
drop policy if exists "plano_admin_delete" on public.plano_semana;

create policy "plano_gestor_insert" on public.plano_semana
  for insert to authenticated with check (public.pode_gerenciar_pedidos());
create policy "plano_gestor_update" on public.plano_semana
  for update to authenticated using (public.pode_gerenciar_pedidos());
create policy "plano_gestor_delete" on public.plano_semana
  for delete to authenticated using (public.pode_gerenciar_pedidos());

-- ============================================================
-- Para promover alguém pelo SQL (também dá para fazer pelo app,
-- em Admin → Funcionários → "Tornar administrativo"):
--   update public.profiles set role = 'gestor' where email = 'pessoa@empresa.com';
-- ============================================================
