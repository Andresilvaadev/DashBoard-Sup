-- ============================================================
-- CORREÇÃO RÁPIDA
--   "Could not find the 'fluxo' column of 'etapas' in the schema cache"
--
-- Adiciona as colunas que faltaram (fluxo em etapas, tipo em pedidos),
-- cria as etapas do fluxo de criação e recarrega o cache da API.
--
-- IMPORTANTE: rode este arquivo no MESMO projeto Supabase que o site usa
-- (o que está no seu .env / VITE_SUPABASE_URL). Seguro para rodar mais de uma vez.
-- ============================================================

-- colunas novas (se já existirem, não faz nada)
alter table public.etapas  add column if not exists fluxo text not null default 'producao';
alter table public.pedidos add column if not exists tipo  text not null default 'pronto';

-- etapas iniciais do fluxo de criação (só cria se ainda não houver nenhuma)
do $$ begin
  if not exists (select 1 from public.etapas where fluxo = 'criacao') then
    insert into public.etapas (nome, ordem, cor, palavras_chave, fluxo) values
      ('Aguardando criação', 1, '#94a3b8', array['aguardando'],            'criacao'),
      ('Em criação',         2, '#f472b6', array['criando','em criacao'],  'criacao'),
      ('Em aprovação',       3, '#a78bfa', array['aprovacao'],             'criacao'),
      ('Arte aprovada',      4, '#34d399', array['aprovada','aprovado'],   'criacao');
  end if;
end $$;

-- recarrega o cache da API (resolve o "schema cache")
notify pgrst, 'reload schema';
