-- ============================================================
-- CÓDIGO DE ACESSO AO PORTAL (substitui autenticação por CPF)
--
-- Antes: o cliente precisava do CPF para consultar o pedido.
-- Agora: o admin gera um código aleatório (ex.: A3F7K2M9) no
--        momento de criar o pedido e o repassa ao cliente.
--
-- Rode INTEIRO no SQL Editor do Supabase. Seguro rodar mais de uma vez.
-- ============================================================

-- ------------------------------------------------------------
-- 1. criar_pedido — salva o código sem remover letras
-- ------------------------------------------------------------
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
  v_numero int;
  v_fluxo text := case when p_tipo = 'pronto' then 'producao' else p_tipo end;
begin
  if not public.pode_gerenciar_pedidos() then
    raise exception 'Sem permissão para criar pedidos';
  end if;

  -- número informado manualmente tem prioridade; senão, segue a sequência
  v_numero := coalesce(p_numero, public.proximo_numero_pedido());

  select id into v_primeira from public.etapas
   where ativo and fluxo = v_fluxo
   order by ordem limit 1;

  insert into public.pedidos (numero, cliente, descricao, quantidade, prioridade,
                              etapa_atual_id, data_prevista, tipo, cpf, created_by)
  values (v_numero, p_cliente, coalesce(p_descricao,''), p_quantidade, p_prioridade,
          v_primeira, p_data_prevista, coalesce(p_tipo, 'pronto'),
          nullif(trim(upper(coalesce(p_cpf, ''))), ''), auth.uid())
  returning id into v_id;

  insert into public.historico (pedido_id, etapa_id, funcionario_id, observacao)
  values (v_id, v_primeira, auth.uid(), 'Pedido criado');

  return v_id;
end; $$;

-- ------------------------------------------------------------
-- 2. consultar_pedido_cliente — aceita código alfanumérico
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
  v_codigo text := trim(upper(coalesce(p_cpf, '')));
  v_fluxo text;
  v_etapas json;
  v_timeline json;
  v_atualizado timestamptz;
  v_etapa_nome text;
  v_etapa_ordem int;
  v_total_etapas int;
begin
  -- rejeita consulta sem número ou sem código
  if p_numero is null or v_codigo = '' then
    return null;
  end if;

  select * into v_pedido
    from public.pedidos
   where numero = p_numero
     and upper(coalesce(cpf, '')) = v_codigo;

  if not found then
    return null;
  end if;

  v_fluxo := case when coalesce(v_pedido.tipo, 'pronto') = 'pronto'
                  then 'producao' else v_pedido.tipo end;

  select json_agg(json_build_object('nome', nome, 'ordem', ordem, 'cor', cor) order by ordem),
         max(ordem)
    into v_etapas, v_total_etapas
    from public.etapas
   where ativo and fluxo = v_fluxo;

  select nome, ordem into v_etapa_nome, v_etapa_ordem
    from public.etapas where id = v_pedido.etapa_atual_id;

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

-- permissões (idempotente)
revoke all on function public.consultar_pedido_cliente(int, text) from public;
grant execute on function public.consultar_pedido_cliente(int, text) to anon, authenticated;
