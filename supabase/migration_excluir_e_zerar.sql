-- ============================================================
-- MIGRAÇÃO: excluir pedido definitivamente + zerar produção
-- Rode este arquivo no SQL Editor do Supabase (banco já existente).
--
-- O histórico não pode ser apagado diretamente (RLS), então a
-- exclusão acontece por funções security definer, sempre exigindo
-- que o usuário logado seja administrador.
-- ============================================================

-- Exclui um pedido DEFINITIVAMENTE, junto com histórico e anexos.
-- Retorna os paths dos anexos para o app limpar o Storage.
create or replace function public.excluir_pedido(p_numero int)
returns text[] language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_paths text[];
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores podem excluir pedidos';
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

-- Zera TODA a produção: pedidos, histórico, anexos e metas.
-- Funcionários, etapas do fluxo e contas de acesso são mantidos.
-- Retorna os paths de todos os anexos para o app limpar o Storage.
create or replace function public.zerar_producao()
returns text[] language plpgsql security definer set search_path = public as $$
declare
  v_paths text[];
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores podem zerar a produção';
  end if;

  select coalesce(array_agg(path), '{}') into v_paths from public.anexos;

  delete from public.historico;
  delete from public.anexos;
  delete from public.pedidos;
  delete from public.metas;

  return v_paths;
end; $$;
