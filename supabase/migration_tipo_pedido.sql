-- ============================================================
-- MIGRAÇÃO: tipo do pedido (pronto x criação de arte)
-- Rode este arquivo INTEIRO no SQL Editor do Supabase e clique RUN.
--
--   tipo = 'pronto'  → aba Pedidos (arte já pronta)
--   tipo = 'criacao' → aba Pedidos para criação (arte a criar)
-- ============================================================

alter table public.pedidos
  add column if not exists tipo text not null default 'pronto'
  check (tipo in ('pronto', 'criacao'));

-- criar_pedido passa a aceitar o tipo (remove a assinatura antiga p/ evitar duplicidade)
drop function if exists public.criar_pedido(int, text, text, int, text, date);

create or replace function public.criar_pedido(
  p_numero int,
  p_cliente text,
  p_descricao text default '',
  p_quantidade int default 1,
  p_prioridade text default 'normal',
  p_data_prevista date default null,
  p_tipo text default 'pronto'
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_primeira uuid;
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores podem criar pedidos';
  end if;

  select id into v_primeira from public.etapas where ativo order by ordem limit 1;

  insert into public.pedidos (numero, cliente, descricao, quantidade, prioridade, etapa_atual_id, data_prevista, tipo, created_by)
  values (p_numero, p_cliente, coalesce(p_descricao,''), p_quantidade, p_prioridade, v_primeira, p_data_prevista, coalesce(p_tipo, 'pronto'), auth.uid())
  returning id into v_id;

  insert into public.historico (pedido_id, etapa_id, funcionario_id, observacao)
  values (v_id, v_primeira, auth.uid(), 'Pedido criado');

  return v_id;
end; $$;

notify pgrst, 'reload schema';
