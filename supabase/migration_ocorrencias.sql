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

-- ============================================================
-- ESCRITA LIBERADA PARA QUALQUER FUNCIONÁRIO
--
-- Quem vê o problema é quem está na produção, então o registro não pode
-- depender de admin/gestor. A política da tabela pedidos só deixa
-- admin/gestor darem UPDATE (e é por linha, não por coluna — liberar a
-- tabela exporia cliente, número, prazo e status). Por isso a escrita
-- passa por esta função, que mexe SOMENTE na coluna ocorrencias.
-- ============================================================

create or replace function public.registrar_ocorrencia(
  p_pedido_id uuid,
  p_texto text
)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_ativo boolean;
  v_texto text := coalesce(trim(p_texto), '');
begin
  -- precisa estar logado e com a conta ativa
  select ativo into v_ativo from public.profiles where id = auth.uid();
  if not coalesce(v_ativo, false) then
    raise exception 'Sem permissão para registrar a ocorrência';
  end if;

  update public.pedidos set ocorrencias = v_texto where id = p_pedido_id;

  if not found then
    raise exception 'Pedido não encontrado';
  end if;

  return v_texto;
end $$;

revoke all on function public.registrar_ocorrencia(uuid, text) from public;
grant execute on function public.registrar_ocorrencia(uuid, text) to authenticated;

-- ============================================================
-- Conferir:
--   select public.registrar_ocorrencia('<id-do-pedido>'::uuid, 'faltou 1 M');
-- ============================================================
