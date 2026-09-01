-- ============================================================
-- PEDIDO DE KIT
-- Rode INTEIRO no SQL Editor do Supabase. Seguro rodar mais de uma vez.
--
-- Um kit é um pedido montado com itens variados — camisa, caneca,
-- tirante, ecobag, sacolinha, pulseira — cada um com a sua quantidade.
-- Fica na MESMA tabela dos outros pedidos (mesmo fluxo de etapas, mesmo
-- Kanban, mesmo portal); o que muda é a coluna abaixo.
--
-- Formato: {"camisa": 30, "caneca": 30, "pulseira": 50}
-- Só entram os itens marcados. Objeto vazio ({}) = pedido comum.
-- ============================================================

alter table public.pedidos add column if not exists kit jsonb not null default '{}'::jsonb;

comment on column public.pedidos.kit is
  'Itens do kit e suas quantidades. {} = pedido comum (não é kit).';

-- ------------------------------------------------------------
-- criar_pedido passa a receber o kit
--
-- A versão de 8 parâmetros é removida antes: se as duas ficassem no
-- banco, a chamada do app viraria ambígua ("could not choose the best
-- candidate function"), que foi o mesmo cuidado tomado na migração da
-- numeração sequencial.
-- ------------------------------------------------------------

drop function if exists public.criar_pedido(int, text, text, int, text, date, text, text);

create or replace function public.criar_pedido(
  p_numero int,
  p_cliente text,
  p_descricao text default '',
  p_quantidade int default 1,
  p_prioridade text default 'normal',
  p_data_prevista date default null,
  p_tipo text default 'pronto',
  p_cpf text default null,
  p_kit jsonb default '{}'::jsonb
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
                              etapa_atual_id, data_prevista, tipo, cpf, kit, created_by)
  values (v_numero, p_cliente, coalesce(p_descricao,''), p_quantidade, p_prioridade,
          v_primeira, p_data_prevista, coalesce(p_tipo, 'pronto'),
          -- código de acesso ao portal: alfanumérico, NÃO remover as letras
          nullif(trim(upper(coalesce(p_cpf, ''))), ''),
          coalesce(p_kit, '{}'::jsonb), auth.uid())
  returning id into v_id;

  insert into public.historico (pedido_id, etapa_id, funcionario_id, observacao)
  values (v_id, v_primeira, auth.uid(), 'Pedido criado');

  return v_id;
end; $$;

revoke all on function public.criar_pedido(int, text, text, int, text, date, text, text, jsonb) from public;
grant execute on function public.criar_pedido(int, text, text, int, text, date, text, text, jsonb) to authenticated;

-- ============================================================
-- Conferir:
--   select numero, cliente, kit from public.pedidos
--    where kit <> '{}'::jsonb order by numero desc;
-- ============================================================
