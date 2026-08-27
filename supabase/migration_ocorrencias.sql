-- ============================================================
-- OCORRÊNCIAS DO PEDIDO
-- Rode INTEIRO no SQL Editor do Supabase. Seguro rodar mais de uma vez.
--
-- Campo livre para registrar problemas encontrados na produção — por
-- exemplo, "está faltando 1 uniforme". Fica separado da descrição (que diz
-- o que o pedido pede) para o aviso não se perder no meio do texto e para
-- quem pega o pedido depois enxergar o problema de imediato.
-- ============================================================

alter table public.pedidos add column if not exists ocorrencias text not null default '';

comment on column public.pedidos.ocorrencias is
  'Problemas encontrados na produção (faltas, trocas, avarias). Livre.';

-- ============================================================
-- Conferir:
--   select numero, cliente, ocorrencias from public.pedidos
--    where ocorrencias <> '' order by numero desc;
-- ============================================================
