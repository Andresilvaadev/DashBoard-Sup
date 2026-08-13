-- ============================================================
-- MARCAR ARTE PRONTA — liberado para qualquer funcionário
-- Rode INTEIRO no SQL Editor do Supabase. Seguro rodar mais de uma vez.
--
-- Problema: o botão "Marcar arte" salvava com um UPDATE direto na tabela
-- pedidos, que a política de segurança só permite a admin/gestor. Para o
-- funcionário comum o banco não altera nada e TAMBÉM NÃO devolve erro —
-- então a tela dizia "arte pronta!" e o campo continuava como estava.
--
-- Solução: uma função dedicada que mexe SOMENTE nesse campo. Assim o
-- funcionário marca a arte sem ganhar permissão de editar o resto do
-- pedido (cliente, número, prazo, status…).
-- ============================================================

create or replace function public.marcar_arte(
  p_pedido_id uuid,
  p_concluida boolean
)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_ativo boolean;
begin
  -- precisa estar logado e com a conta ativa
  select ativo into v_ativo from public.profiles where id = auth.uid();
  if not coalesce(v_ativo, false) then
    raise exception 'Sem permissão para marcar a arte';
  end if;

  update public.pedidos
     set arte_concluida = coalesce(p_concluida, false)
   where id = p_pedido_id;

  if not found then
    raise exception 'Pedido não encontrado';
  end if;

  return coalesce(p_concluida, false);
end $$;

revoke all on function public.marcar_arte(uuid, boolean) from public;
grant execute on function public.marcar_arte(uuid, boolean) to authenticated;

-- ============================================================
-- Conferir:
--   select public.marcar_arte('<id-do-pedido>'::uuid, true);
-- ============================================================
