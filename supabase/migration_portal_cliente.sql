-- ============================================================
-- PORTAL DO CLIENTE
-- Rode este arquivo INTEIRO no SQL Editor do Supabase.
-- Seguro rodar mais de uma vez.
--
-- O portal é PÚBLICO (sem login) e usa o mesmo banco do dashboard.
-- Nenhuma tabela é aberta para visitantes: toda a consulta passa por
-- UMA função `security definer` que só devolve o pedido quando o CPF
-- E o número conferem, e só com os campos que o cliente pode ver.
-- ============================================================

-- ------------------------------------------------------------
-- 1. CPF do cliente no pedido (guardado só com dígitos)
-- ------------------------------------------------------------
alter table public.pedidos add column if not exists cpf text;

-- busca por CPF sem varrer a tabela inteira
create index if not exists pedidos_cpf_idx on public.pedidos (cpf);

comment on column public.pedidos.cpf is
  'CPF ou CNPJ do cliente, apenas dígitos. Autentica a consulta no Portal do Cliente.';

-- ------------------------------------------------------------
-- 2. criar_pedido passa a gravar o CPF
--    (a versão antiga é removida para não ficarem duas funções de
--     mesmo nome, o que deixaria a chamada ambígua)
-- ------------------------------------------------------------
drop function if exists public.criar_pedido(int, text, text, int, text, date, text);

create or replace function public.criar_pedido(
  p_numero int,
  p_cliente text,
  p_descricao text default '',
  p_quantidade int default 1,
  p_prioridade text default 'normal',
  p_data_prevista date default null,
  p_tipo text default 'pronto',
  p_cpf text default null
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

  insert into public.pedidos (numero, cliente, descricao, quantidade, prioridade,
                              etapa_atual_id, data_prevista, tipo, cpf, created_by)
  values (p_numero, p_cliente, coalesce(p_descricao,''), p_quantidade, p_prioridade,
          v_primeira, p_data_prevista, coalesce(p_tipo, 'pronto'),
          nullif(regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g'), ''), auth.uid())
  returning id into v_id;

  insert into public.historico (pedido_id, etapa_id, funcionario_id, observacao)
  values (v_id, v_primeira, auth.uid(), 'Pedido criado');

  return v_id;
end; $$;

-- ------------------------------------------------------------
-- 3. Consulta pública do pedido
--    Exige número + CPF. Devolve null quando não confere — assim
--    a resposta é idêntica para "não existe" e "CPF errado", sem
--    revelar se aquele número de pedido existe.
-- ------------------------------------------------------------
create or replace function public.consultar_pedido_cliente(
  p_numero int,
  p_cpf text
)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_pedido public.pedidos%rowtype;
  v_cpf text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  v_fluxo text;
  v_etapas json;
  v_timeline json;
  v_atualizado timestamptz;
  v_etapa_nome text;
  v_etapa_ordem int;
  v_total_etapas int;
begin
  -- exige documento completo: CPF (11) ou CNPJ (14 dígitos).
  -- Evita consulta com valor parcial e bloqueia busca só pelo número.
  if p_numero is null or length(v_cpf) not in (11, 14) then
    return null;
  end if;

  select * into v_pedido
    from public.pedidos
   where numero = p_numero
     and regexp_replace(coalesce(cpf, ''), '\D', '', 'g') = v_cpf;

  if not found then
    return null;
  end if;

  -- fluxo de etapas ao qual este pedido pertence
  v_fluxo := case when coalesce(v_pedido.tipo, 'pronto') = 'pronto'
                  then 'producao' else v_pedido.tipo end;

  -- etapas do fluxo, em ordem: base da barra de progresso
  select json_agg(json_build_object('nome', nome, 'ordem', ordem, 'cor', cor) order by ordem),
         max(ordem)
    into v_etapas, v_total_etapas
    from public.etapas
   where ativo and fluxo = v_fluxo;

  -- etapa atual
  select nome, ordem into v_etapa_nome, v_etapa_ordem
    from public.etapas where id = v_pedido.etapa_atual_id;

  -- linha do tempo: SEM funcionário e SEM observações (dados internos)
  select json_agg(json_build_object('etapa', e.nome, 'cor', e.cor, 'data', h.entrada) order by h.entrada),
         max(h.entrada)
    into v_timeline, v_atualizado
    from public.historico h
    join public.etapas e on e.id = h.etapa_id
   where h.pedido_id = v_pedido.id;

  return json_build_object(
    'numero',           v_pedido.numero,
    'cliente',          v_pedido.cliente,
    'criado_em',        v_pedido.created_at,
    'status',           v_pedido.status,
    'etapa_atual',      v_etapa_nome,
    'etapa_ordem',      v_etapa_ordem,
    'total_etapas',     v_total_etapas,
    'atualizado_em',    coalesce(v_atualizado, v_pedido.created_at),
    'previsao_entrega', v_pedido.data_prevista,
    'concluido_em',     v_pedido.concluido_em,
    'etapas',           coalesce(v_etapas, '[]'::json),
    'timeline',         coalesce(v_timeline, '[]'::json)
  );
end;
$$;

-- ------------------------------------------------------------
-- 4. Permissões: só a função é pública, nunca as tabelas
-- ------------------------------------------------------------
revoke all on function public.consultar_pedido_cliente(int, text) from public;
grant execute on function public.consultar_pedido_cliente(int, text) to anon, authenticated;

-- ============================================================
-- Depois de rodar: preencha o CPF nos pedidos (Admin → editar pedido).
-- Sem CPF preenchido, o pedido não pode ser consultado no portal.
-- ============================================================
