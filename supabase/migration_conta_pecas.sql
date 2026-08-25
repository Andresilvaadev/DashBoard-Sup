-- ============================================================
-- CONTAGEM DE PEÇAS POR ETAPA
-- Rode INTEIRO no SQL Editor do Supabase. Seguro rodar mais de uma vez.
--
-- Nem toda etapa produz peça: "Falta ficha técnica", "Teste de cor" ou
-- "Pendente a pagamento" são espera, não produção. Contar peças nelas
-- inflaria o número e atrapalharia a leitura do quanto a fábrica aguenta.
--
-- Esta coluna marca as etapas onde a contagem interessa. Fica editável em
-- Admin → Fluxo, então renomear ou criar etapas não quebra o relatório.
-- ============================================================

alter table public.etapas
  add column if not exists conta_pecas boolean not null default false;

comment on column public.etapas.conta_pecas is
  'Quando true, esta etapa aparece nos contadores de peças produzidas.';

-- Liga nas etapas de produção física. A condição "conta_pecas = false"
-- garante que rodar de novo não reverta o que o admin desmarcou depois.
update public.etapas
   set conta_pecas = true
 where conta_pecas = false
   and fluxo = 'producao'
   and (
     nome ilike '%corte%'
     or nome ilike '%impress%'
     or nome ilike '%prensa%'
     or nome ilike '%costura%'
     or nome ilike '%ocorr%'
     or nome ilike '%embal%'
   );

-- ============================================================
-- Conferir quais ficaram marcadas:
--   select nome, ordem, conta_pecas from public.etapas
--    where fluxo = 'producao' order by ordem;
-- ============================================================
