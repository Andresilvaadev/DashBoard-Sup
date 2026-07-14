-- ============================================================
-- MIGRAÇÃO: capacidade por etapa
-- Rode no SQL Editor do Supabase. Seguro rodar mais de uma vez.
--
-- Cada etapa ganha sua própria capacidade (peças/dia). A tela
-- Capacidade permite escolher a etapa e definir esse valor.
-- (0 = não definida; a capacidade geral continua na tabela config)
-- ============================================================

alter table public.etapas
  add column if not exists capacidade int not null default 0;

notify pgrst, 'reload schema';
