  -- ============================================================
  -- MIGRAÇÃO: meta diária por etapa (separada da capacidade)
  -- Rode no SQL Editor do Supabase. Seguro rodar mais de uma vez.
  --
  --   capacidade = teto: o MÁXIMO que a etapa consegue por dia
  --   meta       = alvo: o que se DEVE produzir por dia (pode ser < capacidade)
  -- ============================================================

  alter table public.etapas
    add column if not exists meta int not null default 0;

  -- meta geral (produção completa), guardada junto da capacidade geral
  insert into public.config (chave, valor) values ('meta_diaria', '0')
  on conflict (chave) do nothing;

  notify pgrst, 'reload schema';
