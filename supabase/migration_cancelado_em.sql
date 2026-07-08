-- ============================================================
-- MIGRAÇÃO: data de cancelamento do pedido
-- Rode este arquivo no SQL Editor do Supabase (banco já existente).
--
-- Registra QUANDO o pedido foi cancelado, para o relatório poder
-- contar cancelamentos por período e a linha do tempo exibi-los.
-- ============================================================

alter table public.pedidos
  add column if not exists cancelado_em timestamptz;

-- mover um pedido pelo fluxo o reativa: limpa a data de cancelamento
create or replace function public.mover_pedido(
  p_numero int,
  p_etapa_id uuid,
  p_observacao text default '',
  p_via_voz boolean default false
)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_pedido public.pedidos%rowtype;
  v_etapa public.etapas%rowtype;
  v_ultima_ordem int;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Não autenticado';
  end if;

  select * into v_pedido from public.pedidos where numero = p_numero;
  if not found then
    raise exception 'Pedido % não encontrado', p_numero;
  end if;

  select * into v_etapa from public.etapas where id = p_etapa_id and ativo;
  if not found then
    raise exception 'Etapa inválida';
  end if;

  -- fecha a etapa aberta
  update public.historico
     set saida = now(),
         segundos_gastos = extract(epoch from now() - entrada)::int
   where pedido_id = v_pedido.id and saida is null;

  -- abre a nova etapa
  insert into public.historico (pedido_id, etapa_id, funcionario_id, observacao, via_voz)
  values (v_pedido.id, p_etapa_id, v_uid, coalesce(p_observacao, ''), p_via_voz);

  -- última etapa do fluxo => pedido concluído
  select max(ordem) into v_ultima_ordem from public.etapas where ativo;

  update public.pedidos
     set etapa_atual_id = p_etapa_id,
         status = case when v_etapa.ordem >= v_ultima_ordem then 'concluido' else 'em_andamento' end,
         concluido_em = case when v_etapa.ordem >= v_ultima_ordem then now() else null end,
         cancelado_em = null
   where id = v_pedido.id;

  return json_build_object('pedido', v_pedido.numero, 'etapa', v_etapa.nome);
end; $$;
