-- ============================================================
-- MIGRAÇÃO: status "arquivado" (guardado sem ter terminado)
-- Rode este arquivo no SQL Editor do Supabase (banco já existente).
--
-- Um pedido pode ser ARQUIVADO sem ter sido concluído — sai do fluxo
-- e vai para o Arquivo, mas NÃO conta como produção/entrega.
--   concluido  = terminou de verdade (entregue)
--   arquivado  = guardado, sem ter terminado
--   cancelado  = cancelado
-- ============================================================

-- permite o novo valor de status
alter table public.pedidos drop constraint if exists pedidos_status_check;
alter table public.pedidos
  add constraint pedidos_status_check
  check (status in ('em_andamento', 'concluido', 'cancelado', 'arquivado'));

-- quando o pedido foi arquivado
alter table public.pedidos
  add column if not exists arquivado_em timestamptz;

-- recarrega o cache da API
notify pgrst, 'reload schema';
