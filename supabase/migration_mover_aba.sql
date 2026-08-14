-- ============================================================
-- MOVER PEDIDO DE ABA — liberado para qualquer funcionário
-- Rode INTEIRO no SQL Editor do Supabase. Seguro rodar mais de uma vez.
--
-- Regra do sistema: o funcionário NÃO cria pedidos, mas MOVE — tanto entre
-- etapas quanto entre abas (Pedidos ↔ Criação ↔ Canecas).
--
-- Antes a troca de aba era um UPDATE direto na tabela pedidos, permitido só
-- a admin/gestor. Esta função faz a mesma coisa mexendo SOMENTE na aba e na
-- etapa — o funcionário não ganha permissão de alterar cliente, número,
-- prazo, CPF nem status.
-- ============================================================

create or replace function public.mover_pedido_aba(
  p_numero int,
  p_tipo text
)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_pedido public.pedidos%rowtype;
  v_primeira public.etapas%rowtype;
  v_fluxo text;
  v_uid uuid := auth.uid();
  v_ativo boolean;
begin
  -- precisa estar logado e com a conta ativa
  select ativo into v_ativo from public.profiles where id = v_uid;
  if not coalesce(v_ativo, false) then
    raise exception 'Sem permissão para mover pedidos';
  end if;

  if p_tipo not in ('pronto', 'criacao', 'caneca') then
    raise exception 'Aba inválida';
  end if;

  select * into v_pedido from public.pedidos where numero = p_numero;
  if not found then
    raise exception 'Pedido % não encontrado', p_numero;
  end if;

  if coalesce(v_pedido.tipo, 'pronto') = p_tipo then
    raise exception 'O pedido já está nessa aba';
  end if;

  -- cada aba tem seu fluxo; o pedido recomeça na primeira etapa do destino
  v_fluxo := case when p_tipo = 'pronto' then 'producao' else p_tipo end;

  select * into v_primeira from public.etapas
   where ativo and fluxo = v_fluxo
   order by ordem limit 1;
  if not found then
    raise exception 'A aba de destino ainda não tem etapas configuradas';
  end if;

  -- fecha a etapa em aberto, contando o tempo gasto
  update public.historico
     set saida = now(),
         segundos_gastos = extract(epoch from now() - entrada)::int
   where pedido_id = v_pedido.id and saida is null;

  update public.pedidos
     set tipo = p_tipo,
         etapa_atual_id = v_primeira.id,
         status = 'em_andamento',
         concluido_em = null
   where id = v_pedido.id;

  insert into public.historico (pedido_id, etapa_id, funcionario_id, observacao)
  values (v_pedido.id, v_primeira.id, v_uid, 'Movido para outra aba');

  return json_build_object('pedido', v_pedido.numero, 'etapa', v_primeira.nome);
end $$;

revoke all on function public.mover_pedido_aba(int, text) from public;
grant execute on function public.mover_pedido_aba(int, text) to authenticated;
