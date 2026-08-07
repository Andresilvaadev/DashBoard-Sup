create sequence if not exists public.pedidos_numero_seq
  as integer
  start with 600
  increment by 1
  minvalue 600;

-- Se já existem pedidos criados pela nova numeração, continua de onde parou.
-- (Ignora os números antigos aleatórios: só considera a faixa sequencial.)
do $$
declare
  v_max int;
begin
  select max(numero) into v_max
    from public.pedidos
   where numero >= 600 and numero < 10000;

  if v_max is not null then
    -- 'true' = já foi usado, então o próximo nextval devolve v_max + 1
    perform setval('public.pedidos_numero_seq', v_max, true);
  end if;
end $$;

-- ------------------------------------------------------------
-- 2. Próximo número livre (consome a sequência)
--    nextval é atômico: dois cadastros simultâneos nunca recebem
--    o mesmo número. O laço pula números já ocupados por pedidos
--    antigos, caso a contagem chegue neles um dia.
-- ------------------------------------------------------------
create or replace function public.proximo_numero_pedido()
returns int language plpgsql security definer set search_path = public as $$
declare
  v_num int;
begin
  loop
    v_num := nextval('public.pedidos_numero_seq');
    exit when not exists (select 1 from public.pedidos where numero = v_num);
  end loop;
  return v_num;
end $$;

-- ------------------------------------------------------------
-- 3. Prévia do próximo número (NÃO consome)
--    Serve só para o formulário mostrar o número antes de salvar.
-- ------------------------------------------------------------
create or replace function public.previa_numero_pedido()
returns int language plpgsql stable security definer set search_path = public as $$
declare
  v_num int;
begin
  select case when is_called then last_value + 1 else last_value end
    into v_num from public.pedidos_numero_seq;

  -- pula os que já existem, do mesmo jeito que a função de verdade faria
  while exists (select 1 from public.pedidos where numero = v_num) loop
    v_num := v_num + 1;
  end loop;

  return v_num;
end $$;

-- a prévia é só leitura: liberada para quem está logado
revoke all on function public.previa_numero_pedido() from public;
grant execute on function public.previa_numero_pedido() to authenticated;

-- a que CONSOME a sequência não é chamada pelo app: só por criar_pedido
revoke all on function public.proximo_numero_pedido() from public;

-- ------------------------------------------------------------
-- 4. criar_pedido: quando o número não é informado, usa a sequência
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

  -- o pedido nasce na primeira etapa do SEU fluxo
  select id into v_primeira from public.etapas
   where ativo and fluxo = v_fluxo
   order by ordem limit 1;

  insert into public.pedidos (numero, cliente, descricao, quantidade, prioridade,
                              etapa_atual_id, data_prevista, tipo, cpf, created_by)
  values (v_numero, p_cliente, coalesce(p_descricao,''), p_quantidade, p_prioridade,
          v_primeira, p_data_prevista, coalesce(p_tipo, 'pronto'),
          nullif(regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g'), ''), auth.uid())
  returning id into v_id;

  insert into public.historico (pedido_id, etapa_id, funcionario_id, observacao)
  values (v_id, v_primeira, auth.uid(), 'Pedido criado');

  return v_id;
end; $$;

-- ============================================================
-- Conferir como ficou:
--   select public.previa_numero_pedido();   -- próximo número a sair
-- ============================================================
