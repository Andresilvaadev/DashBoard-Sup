create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null default '',
  email text not null default '',
  role text not null default 'funcionario' check (role in ('admin', 'funcionario')),
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

-- Cria o perfil automaticamente quando um usuário se cadastra
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, nome, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'nome', split_part(new.email, '@', 1)), coalesce(new.email, ''));
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Helper: verifica se o usuário logado é admin
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and ativo);
$$;

-- ---------- ETAPAS DO FLUXO (editável pelo admin) ----------
create table if not exists public.etapas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  ordem int not null,
  cor text not null default '#38bdf8',
  palavras_chave text[] not null default '{}',  -- usadas pelo comando de voz
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.etapas (nome, ordem, cor, palavras_chave) values
  ('Pedido criado', 1, '#94a3b8', array['criado','novo','pedido criado']),
  ('Arte',          2, '#f472b6', array['arte','design']),
  ('Ficha técnica', 3, '#a78bfa', array['ficha','ficha tecnica']),
  ('Impressão',     4, '#818cf8', array['impressao','imprimir','impresso']),
  ('Corte',         5, '#38bdf8', array['corte','cortar','cortado']),
  ('Prensagem',     6, '#f59e0b', array['prensagem','prensa','prensar','prensado']),
  ('Costura',       7, '#fb923c', array['costura','costurar','costurado']),
  ('Embalagem',     8, '#34d399', array['embalagem','embalar','embalado']),
  ('Entregue',      9, '#22c55e', array['entregue','entrega','finalizado','concluido'])
on conflict do nothing;

-- ---------- PEDIDOS ----------
create table if not exists public.pedidos (
  id uuid primary key default gen_random_uuid(),
  numero int not null unique,
  cliente text not null default '',
  descricao text not null default '',
  quantidade int not null default 1,
  prioridade text not null default 'normal' check (prioridade in ('baixa','normal','alta','urgente')),
  status text not null default 'em_andamento' check (status in ('em_andamento','concluido','cancelado')),
  etapa_atual_id uuid references public.etapas(id),
  data_prevista date,
  concluido_em timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists pedidos_numero_idx on public.pedidos (numero);
create index if not exists pedidos_status_idx on public.pedidos (status);

-- ---------- HISTÓRICO (imutável, nunca apagado) ----------
create table if not exists public.historico (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos(id) on delete restrict,
  etapa_id uuid not null references public.etapas(id),
  funcionario_id uuid references public.profiles(id),
  entrada timestamptz not null default now(),
  saida timestamptz,
  segundos_gastos int,          -- calculado automaticamente na saída
  observacao text not null default '',
  via_voz boolean not null default false
);
create index if not exists historico_pedido_idx on public.historico (pedido_id);
create index if not exists historico_entrada_idx on public.historico (entrada);

-- ---------- ANEXOS ----------
create table if not exists public.anexos (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos(id) on delete restrict,
  nome text not null,
  path text not null,
  tipo text not null default '',
  tamanho bigint not null default 0,
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

-- ---------- METAS DIÁRIAS ----------
-- etapa_id = null → meta geral do dia (pedidos concluídos)
-- etapa_id = <id> → meta daquela etapa (pedidos que passam por ela no dia)
create table if not exists public.metas (
  id uuid primary key default gen_random_uuid(),
  data date not null,
  etapa_id uuid references public.etapas(id) on delete cascade,
  quantidade int not null default 0,
  created_by uuid references public.profiles(id),
  constraint metas_data_etapa_key unique nulls not distinct (data, etapa_id)
);

-- ============================================================
-- FUNÇÃO CENTRAL: mover pedido de etapa
-- Fecha a etapa atual (saída + tempo gasto), abre a nova,
-- registra o funcionário e marca conclusão se for a última.
-- ============================================================
create or replace function public.mover_pedido(
  p_numero int,
  p_etapa_id uuid,
  p_observacao text default '',
  p_via_voz boolean default false
)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_pedido public.pedidos%rowtype;
  v_etapa public.etapas%rowtype;
  v_ultima_ordem int;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Não autenticado';
  end if;

  select * into v_pedido from public.pedidos where numero = p_numero;
  if not found then
    raise exception 'Pedido % não encontrado', p_numero;
  end if;

  select * into v_etapa from public.etapas where id = p_etapa_id and ativo;
  if not found then
    raise exception 'Etapa inválida';
  end if;

  -- fecha a etapa aberta
  update public.historico
     set saida = now(),
         segundos_gastos = extract(epoch from now() - entrada)::int
   where pedido_id = v_pedido.id and saida is null;

  -- abre a nova etapa
  insert into public.historico (pedido_id, etapa_id, funcionario_id, observacao, via_voz)
  values (v_pedido.id, p_etapa_id, v_uid, coalesce(p_observacao, ''), p_via_voz);

  -- última etapa do fluxo => pedido concluído
  select max(ordem) into v_ultima_ordem from public.etapas where ativo;

  update public.pedidos
     set etapa_atual_id = p_etapa_id,
         status = case when v_etapa.ordem >= v_ultima_ordem then 'concluido' else 'em_andamento' end,
         concluido_em = case when v_etapa.ordem >= v_ultima_ordem then now() else null end
   where id = v_pedido.id;

  return json_build_object('pedido', v_pedido.numero, 'etapa', v_etapa.nome);
end; $$;

-- Cria pedido já com histórico inicial na primeira etapa
create or replace function public.criar_pedido(
  p_numero int,
  p_cliente text,
  p_descricao text default '',
  p_quantidade int default 1,
  p_prioridade text default 'normal',
  p_data_prevista date default null
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

  insert into public.pedidos (numero, cliente, descricao, quantidade, prioridade, etapa_atual_id, data_prevista, created_by)
  values (p_numero, p_cliente, coalesce(p_descricao,''), p_quantidade, p_prioridade, v_primeira, p_data_prevista, auth.uid())
  returning id into v_id;

  insert into public.historico (pedido_id, etapa_id, funcionario_id, observacao)
  values (v_id, v_primeira, auth.uid(), 'Pedido criado');

  return v_id;
end; $$;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.profiles enable row level security;
alter table public.etapas enable row level security;
alter table public.pedidos enable row level security;
alter table public.historico enable row level security;
alter table public.anexos enable row level security;
alter table public.metas enable row level security;

-- profiles: todos autenticados leem; admin gerencia; usuário edita o próprio nome
create policy "profiles_select" on public.profiles for select to authenticated using (true);
create policy "profiles_update_admin" on public.profiles for update to authenticated using (public.is_admin());
create policy "profiles_update_self" on public.profiles for update to authenticated using (id = auth.uid());

-- etapas: leitura para todos; escrita apenas admin
create policy "etapas_select" on public.etapas for select to authenticated using (true);
create policy "etapas_admin_insert" on public.etapas for insert to authenticated with check (public.is_admin());
create policy "etapas_admin_update" on public.etapas for update to authenticated using (public.is_admin());
create policy "etapas_admin_delete" on public.etapas for delete to authenticated using (public.is_admin());

-- pedidos: leitura para todos; criação/edição/exclusão apenas admin
-- (funcionários movem etapas apenas pela função mover_pedido)
create policy "pedidos_select" on public.pedidos for select to authenticated using (true);
create policy "pedidos_admin_insert" on public.pedidos for insert to authenticated with check (public.is_admin());
create policy "pedidos_admin_update" on public.pedidos for update to authenticated using (public.is_admin());
create policy "pedidos_admin_delete" on public.pedidos for delete to authenticated using (public.is_admin());

-- historico: leitura para todos; NUNCA pode ser apagado ou alterado diretamente
-- (inserções/fechamentos acontecem via funções security definer)
create policy "historico_select" on public.historico for select to authenticated using (true);

-- anexos: leitura para todos; upload por qualquer autenticado; exclusão só admin
create policy "anexos_select" on public.anexos for select to authenticated using (true);
create policy "anexos_insert" on public.anexos for insert to authenticated with check (uploaded_by = auth.uid());
create policy "anexos_admin_delete" on public.anexos for delete to authenticated using (public.is_admin());

-- metas: leitura para todos; escrita apenas admin
create policy "metas_select" on public.metas for select to authenticated using (true);
create policy "metas_admin_insert" on public.metas for insert to authenticated with check (public.is_admin());
create policy "metas_admin_update" on public.metas for update to authenticated using (public.is_admin());
create policy "metas_admin_delete" on public.metas for delete to authenticated using (public.is_admin());

-- ============================================================
-- REALTIME: publica alterações das tabelas principais
-- ============================================================
do $$ begin
  alter publication supabase_realtime add table public.pedidos;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.historico;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.metas;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.etapas;
exception when duplicate_object then null; end $$;

-- ============================================================
-- STORAGE: bucket de anexos
-- ============================================================
insert into storage.buckets (id, name, public)
values ('anexos', 'anexos', false)
on conflict (id) do nothing;

create policy "anexos_storage_read" on storage.objects
  for select to authenticated using (bucket_id = 'anexos');
create policy "anexos_storage_upload" on storage.objects
  for insert to authenticated with check (bucket_id = 'anexos');
create policy "anexos_storage_delete_admin" on storage.objects
  for delete to authenticated using (bucket_id = 'anexos' and public.is_admin());

-- ============================================================
-- IMPORTANTE: após criar seu primeiro usuário (via tela de login
-- ou painel do Supabase), promova-o a administrador:
--
--   update public.profiles set role = 'admin' where email = 'seu@email.com';
-- ============================================================
