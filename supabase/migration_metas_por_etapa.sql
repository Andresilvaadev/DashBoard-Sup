-- ============================================================
-- MIGRAÇÃO: metas por etapa
-- Rode este arquivo no SQL Editor do Supabase (banco já existente).
--
-- Cada etapa passa a poder ter sua própria meta diária:
--   etapa_id = null  → meta geral do dia (pedidos concluídos), como antes
--   etapa_id = <id>  → meta daquela etapa (pedidos que devem passar por ela no dia)
-- ============================================================

alter table public.metas
  add column if not exists etapa_id uuid references public.etapas(id) on delete cascade;

-- antes só podia existir uma meta por dia; agora é uma por dia POR etapa
alter table public.metas drop constraint if exists metas_data_key;

alter table public.metas
  add constraint metas_data_etapa_key unique nulls not distinct (data, etapa_id);
