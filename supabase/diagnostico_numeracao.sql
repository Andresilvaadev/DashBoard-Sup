-- ============================================================
-- DIAGNÓSTICO DA NUMERAÇÃO DOS PEDIDOS
-- Rode no SQL Editor do Supabase. Só consulta, não altera nada.
-- Mande o resultado das 4 perguntas.
-- ============================================================

-- 1) A sequência existe? Em que número ela está?
select
  'sequencia' as item,
  case when to_regclass('public.pedidos_numero_seq') is null
       then 'NAO EXISTE — a migração não foi rodada'
       else 'existe' end as situacao;

select last_value, is_called,
       case when is_called then last_value + 1 else last_value end as proximo_numero
  from public.pedidos_numero_seq;

-- 2) Quantas versões de criar_pedido existem? (mais de uma = chamada ambígua)
select p.oid::regprocedure as assinatura
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'criar_pedido';

-- 3) A função em uso realmente usa a sequência?
select case
         when pg_get_functiondef(p.oid) like '%proximo_numero_pedido%'
           then 'OK — usa a sequência'
           else 'ANTIGA — não usa a sequência'
       end as versao_da_funcao
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'criar_pedido';

-- 4) Faixa dos números já usados
select min(numero) as menor, max(numero) as maior, count(*) as total
  from public.pedidos;

-- ============================================================
-- CORREÇÃO (só rode depois de ver o resultado acima):
-- joga a contagem para começar no 600, sem tocar nos pedidos existentes.
--
--   select setval('public.pedidos_numero_seq', 599, true);
--
-- O próximo pedido criado sai como 600. Se já existir um pedido 600,
-- a função pula sozinha para o próximo livre.
-- ============================================================
