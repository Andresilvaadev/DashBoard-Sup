-- ============================================================
-- MIGRAÇÃO: aba/fluxo de Canecas
-- Rode este arquivo INTEIRO no SQL Editor do Supabase e clique RUN.
-- Seguro para rodar mais de uma vez.
--
-- Abas/fluxos do sistema:
--   tipo 'pronto'  ↔ fluxo 'producao'  (aba Pedidos)
--   tipo 'criacao' ↔ fluxo 'criacao'   (aba Criação)
--   tipo 'caneca'  ↔ fluxo 'caneca'    (aba Canecas)   << NOVO
-- ============================================================

-- 1) permite o novo valor 'caneca' em pedidos.tipo e etapas.fluxo
alter table public.pedidos drop constraint if exists pedidos_tipo_check;
alter table public.pedidos
  add constraint pedidos_tipo_check check (tipo in ('pronto', 'criacao', 'caneca'));

alter table public.etapas drop constraint if exists etapas_fluxo_check;
alter table public.etapas
  add constraint etapas_fluxo_check check (fluxo in ('producao', 'criacao', 'caneca'));

-- 2) etapas iniciais do fluxo de canecas (o admin edita em Admin → Fluxo)
do $$ begin
  if not exists (select 1 from public.etapas where fluxo = 'caneca') then
    insert into public.etapas (nome, ordem, cor, palavras_chave, fluxo) values
      ('Pedido criado', 1, '#94a3b8', array['criado','novo'],       'caneca'),
      ('Impressão',     2, '#818cf8', array['impressao','imprimir'], 'caneca'),
      ('Sublimação',    3, '#f59e0b', array['sublimacao','prensa'],  'caneca'),
      ('Embalagem',     4, '#34d399', array['embalagem','embalar'],  'caneca'),
      ('Entregue',      5, '#22c55e', array['entregue','entrega'],   'caneca');
  end if;
end $$;

-- 3) criar_pedido: mapeia o tipo para o fluxo (pronto→producao, resto = próprio nome)
--    e o pedido nasce na primeira etapa do seu fluxo
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
  if not public.is_admin() then
    raise exception 'Apenas administradores podem criar pedidos';
  end if;

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

-- 4) mover_pedido: conclui ao chegar na última etapa de QUALQUER fluxo,
--    exceto 'criacao' (arte aprovada não é entrega)
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
  v_concluiu boolean;
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

  update public.historico
     set saida = now(),
         segundos_gastos = extract(epoch from now() - entrada)::int
   where pedido_id = v_pedido.id and saida is null;

  insert into public.historico (pedido_id, etapa_id, funcionario_id, observacao, via_voz)
  values (v_pedido.id, p_etapa_id, v_uid, coalesce(p_observacao, ''), p_via_voz);

  select max(ordem) into v_ultima_ordem
    from public.etapas where ativo and fluxo = v_etapa.fluxo;
  v_concluiu := (v_etapa.fluxo <> 'criacao' and v_etapa.ordem >= v_ultima_ordem);

  update public.pedidos
     set etapa_atual_id = p_etapa_id,
         status = case when v_concluiu then 'concluido' else 'em_andamento' end,
         concluido_em = case when v_concluiu then now() else null end,
         cancelado_em = null
   where id = v_pedido.id;

  return json_build_object('pedido', v_pedido.numero, 'etapa', v_etapa.nome);
end; $$;

notify pgrst, 'reload schema';
