-- ============================================================
-- CORREÇÃO: "Zerar produção" travando com
--   "DELETE requires a WHERE clause"
--
-- O Supabase tem uma proteção (extensão safeupdate) que bloqueia
-- DELETE/UPDATE sem WHERE. A função abaixo passa a usar
-- "where id is not null" (pega todas as linhas) para satisfazer
-- essa proteção e conseguir zerar tudo.
--
-- Rode este arquivo INTEIRO no SQL Editor do Supabase e clique RUN.
-- ============================================================

create or replace function public.zerar_producao()
returns text[] language plpgsql security definer set search_path = public as $$
declare
  v_paths text[];
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores podem zerar a produção';
  end if;

  select coalesce(array_agg(path), '{}') into v_paths from public.anexos;

  -- WHERE obrigatório (a extensão de segurança do Supabase bloqueia DELETE sem WHERE).
  -- A ordem respeita as chaves estrangeiras: histórico e anexos antes dos pedidos.
  delete from public.historico where id is not null;
  delete from public.anexos where id is not null;
  delete from public.pedidos where id is not null;
  delete from public.metas where id is not null;

  return v_paths;
end; $$;

notify pgrst, 'reload schema';
