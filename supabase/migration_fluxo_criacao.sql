-- ============================================================
-- MIGRAÇÃO: fluxo de etapas próprio para a aba Criação
-- Rode este arquivo INTEIRO no SQL Editor do Supabase e clique RUN.
--
-- As etapas passam a pertencer a um fluxo:
--   fluxo = 'producao' → aba Pedidos (Corte, Prensagem, ...)
--   fluxo = 'criacao'  → aba Pedidos para criação (arte)
-- ============================================================

-- 1º passo: cria a coluna (sem restrição embutida, para ser seguro re-rodar)
alter table public.etapas
  add column if not exists fluxo text not null default 'producao';

-- 2º passo: garante a restrição de valores válidos (ignora se já existir)
do $$ begin
  alter table public.etapas
    add constraint etapas_fluxo_check check (fluxo in ('producao', 'criacao'));
exception
  when duplicate_object then null;
  when duplicate_table then null;
end $$;

-- etapas iniciais do fluxo de criação (só cria se ainda não existir nenhuma;
-- o admin pode renomear/editar no Admin → Fluxo)
do $$ begin
  if not exists (select 1 from public.etapas where fluxo = 'criacao') then
    insert into public.etapas (nome, ordem, cor, palavras_chave, fluxo) values
      ('Aguardando criação', 1, '#94a3b8', array['aguardando'],            'criacao'),
      ('Em criação',         2, '#f472b6', array['criando','em criacao'],  'criacao'),
      ('Em aprovação',       3, '#a78bfa', array['aprovacao'],             'criacao'),
      ('Arte aprovada',      4, '#34d399', array['aprovada','aprovado'],   'criacao');
  end if;
end $$;

-- mover_pedido: a conclusão automática só vale no fluxo de PRODUÇÃO
-- (chegar à última etapa da criação não conclui o pedido)
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

  -- fecha a etapa aberta
  update public.historico
     set saida = now(),
         segundos_gastos = extract(epoch from now() - entrada)::int
   where pedido_id = v_pedido.id and saida is null;

  -- abre a nova etapa
  insert into public.historico (pedido_id, etapa_id, funcionario_id, observacao, via_voz)
  values (v_pedido.id, p_etapa_id, v_uid, coalesce(p_observacao, ''), p_via_voz);

  -- última etapa DO MESMO FLUXO => conclui apenas no fluxo de produção
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

-- criar_pedido: o pedido nasce na primeira etapa DO SEU FLUXO
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

notify pgrst, 'reload schema';
