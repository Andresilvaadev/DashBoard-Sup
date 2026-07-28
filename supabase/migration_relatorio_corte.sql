-- ============================================================
-- MIGRAÇÃO: relatório de pedidos cortados
-- Rode no SQL Editor do Supabase. Seguro rodar mais de uma vez.
--
-- Ao concluir o corte, o lote guarda um RESUMO (retrato) do que foi
-- cortado: pedidos, modelagens, grades e total de pares. Assim o
-- histórico não muda se a ficha técnica for editada depois.
-- ============================================================

alter table public.lotes_corte
  add column if not exists resumo jsonb not null default '{}'::jsonb;

-- quem concluiu o corte (o created_by é quem abriu o lote)
alter table public.lotes_corte
  add column if not exists finalizado_por uuid references public.profiles(id);

notify pgrst, 'reload schema';
