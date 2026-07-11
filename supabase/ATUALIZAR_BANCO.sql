-- ============================================================
-- ATUALIZAÇÃO COMPLETA DO BANCO — rode este arquivo INTEIRO
-- no SQL Editor do Supabase (Dashboard → SQL Editor → New query,
-- cole tudo e clique em RUN).
--
-- Reúne as 3 migrações pendentes em um só arquivo e é seguro
-- rodar mais de uma vez (não duplica nada nem apaga dados).
--   1. Metas por etapa
--   2. Excluir pedido definitivamente + zerar produção
--   3. Data de cancelamento do pedido
-- ============================================================

-- ------------------------------------------------------------
-- 1. METAS POR ETAPA
-- ------------------------------------------------------------
alter table public.metas
  add column if not exists etapa_id uuid references public.etapas(id) on delete cascade;

alter table public.metas drop constraint if exists metas_data_key;

do $$ begin
  alter table public.metas
    add constraint metas_data_etapa_key unique nulls not distinct (data, etapa_id);
exception
  when duplicate_object then null;
  when duplicate_table then null;
end $$;

-- ------------------------------------------------------------
-- 2. EXCLUIR PEDIDO + ZERAR PRODUÇÃO (apenas admin)
-- ------------------------------------------------------------

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
create or replace function public.zerar_producao()
returns text[] language plpgsql security definer set search_path = public as $$
declare
  v_paths text[];
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores podem zerar a produção';
  end if;

  select coalesce(array_agg(path), '{}') into v_paths from public.anexos;

  -- WHERE obrigatório: a extensão safeupdate do Supabase bloqueia DELETE sem WHERE
  delete from public.historico where id is not null;
  delete from public.anexos where id is not null;
  delete from public.pedidos where id is not null;
  delete from public.metas where id is not null;

  return v_paths;
end; $$;

-- ------------------------------------------------------------
-- 3. DATA DE CANCELAMENTO
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- 4. TIPO DO PEDIDO (pronto x criação de arte) + CRIAR PEDIDO
-- ------------------------------------------------------------
alter table public.pedidos
  add column if not exists tipo text not null default 'pronto'
  check (tipo in ('pronto', 'criacao'));

drop function if exists public.criar_pedido(int, text, text, int, text, date);

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
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores podem criar pedidos';
  end if;

  -- o pedido nasce na primeira etapa do SEU fluxo (produção ou criação)
  -- (a coluna "fluxo" é criada na seção 6; rode o arquivo inteiro)
  select id into v_primeira from public.etapas
   where ativo and fluxo = (case when p_tipo = 'criacao' then 'criacao' else 'producao' end)
   order by ordem limit 1;

  insert into public.pedidos (numero, cliente, descricao, quantidade, prioridade, etapa_atual_id, data_prevista, tipo, created_by)
  values (p_numero, p_cliente, coalesce(p_descricao,''), p_quantidade, p_prioridade, v_primeira, p_data_prevista, coalesce(p_tipo, 'pronto'), auth.uid())
  returning id into v_id;

  insert into public.historico (pedido_id, etapa_id, funcionario_id, observacao)
  values (v_id, v_primeira, auth.uid(), 'Pedido criado');

  return v_id;
end; $$;

-- ------------------------------------------------------------
-- 5. STATUS "arquivado" (guardado sem ter terminado)
-- ------------------------------------------------------------
alter table public.pedidos drop constraint if exists pedidos_status_check;
alter table public.pedidos
  add constraint pedidos_status_check
  check (status in ('em_andamento', 'concluido', 'cancelado', 'arquivado'));

alter table public.pedidos
  add column if not exists arquivado_em timestamptz;

-- ------------------------------------------------------------
-- 6. FLUXO DE ETAPAS DA CRIAÇÃO (aba Pedidos para criação)
-- ------------------------------------------------------------
alter table public.etapas
  add column if not exists fluxo text not null default 'producao'
  check (fluxo in ('producao', 'criacao'));

do $$ begin
  if not exists (select 1 from public.etapas where fluxo = 'criacao') then
    insert into public.etapas (nome, ordem, cor, palavras_chave, fluxo) values
      ('Aguardando criação', 1, '#94a3b8', array['aguardando'],            'criacao'),
      ('Em criação',         2, '#f472b6', array['criando','em criacao'],  'criacao'),
      ('Em aprovação',       3, '#a78bfa', array['aprovacao'],             'criacao'),
      ('Arte aprovada',      4, '#34d399', array['aprovada','aprovado'],   'criacao');
  end if;
end $$;

-- mover_pedido: conclusão automática só no fluxo de produção
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
  v_concluiu := (v_etapa.fluxo = 'producao' and v_etapa.ordem >= v_ultima_ordem);

  update public.pedidos
     set etapa_atual_id = p_etapa_id,
         status = case when v_concluiu then 'concluido' else 'em_andamento' end,
         concluido_em = case when v_concluiu then now() else null end,
         cancelado_em = null
   where id = v_pedido.id;

  return json_build_object('pedido', v_pedido.numero, 'etapa', v_etapa.nome);
end; $$;

-- ------------------------------------------------------------
-- Recarrega o cache de schema da API (resolve o erro
-- "Could not find the function ... in the schema cache")
-- ------------------------------------------------------------
notify pgrst, 'reload schema';
