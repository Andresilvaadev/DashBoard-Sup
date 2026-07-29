create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null default '',
  email text not null default '',
  -- admin = tudo | gestor = "Administrativo" (pedidos + semanal) | funcionario = move etapas
  role text not null default 'funcionario' check (role in ('admin', 'gestor', 'funcionario')),
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

-- Helper: quem pode criar/editar pedidos e mexer no planejamento semanal
-- (administrador OU administrativo/gestor)
create or replace function public.pode_gerenciar_pedidos()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
     where id = auth.uid() and ativo and role in ('admin', 'gestor')
  );
$$;

-- ---------- ETAPAS DO FLUXO (editável pelo admin) ----------
create table if not exists public.etapas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  ordem int not null,
  cor text not null default '#38bdf8',
  palavras_chave text[] not null default '{}',  -- usadas pelo comando de voz
  ativo boolean not null default true,
  -- fluxo da etapa: 'producao' (Pedidos), 'criacao' (Criação de arte), 'caneca' (Canecas)
  fluxo text not null default 'producao' check (fluxo in ('producao','criacao','caneca')),
  -- capacidade = teto (máx/dia); meta = alvo diário (0 = não definida)
  capacidade int not null default 0,
  meta int not null default 0,
  created_at timestamptz not null default now()
);

-- Seeds das etapas (só insere se o fluxo ainda estiver vazio — seguro re-rodar)
do $$ begin
  if not exists (select 1 from public.etapas where fluxo = 'producao') then
    insert into public.etapas (nome, ordem, cor, palavras_chave) values
      ('Pedido criado', 1, '#94a3b8', array['criado','novo','pedido criado']),
      ('Arte',          2, '#f472b6', array['arte','design']),
      ('Ficha técnica', 3, '#a78bfa', array['ficha','ficha tecnica']),
      ('Impressão',     4, '#818cf8', array['impressao','imprimir','impresso']),
      ('Corte',         5, '#38bdf8', array['corte','cortar','cortado']),
      ('Prensagem',     6, '#f59e0b', array['prensagem','prensa','prensar','prensado']),
      ('Costura',       7, '#fb923c', array['costura','costurar','costurado']),
      ('Embalagem',     8, '#34d399', array['embalagem','embalar','embalado']),
      ('Entregue',      9, '#22c55e', array['entregue','entrega','finalizado','concluido']);
  end if;
  -- etapas iniciais do fluxo de criação de arte (aba Criação)
  if not exists (select 1 from public.etapas where fluxo = 'criacao') then
    insert into public.etapas (nome, ordem, cor, palavras_chave, fluxo) values
      ('Aguardando criação', 1, '#94a3b8', array['aguardando'],           'criacao'),
      ('Em criação',         2, '#f472b6', array['criando','em criacao'], 'criacao'),
      ('Em aprovação',       3, '#a78bfa', array['aprovacao'],            'criacao'),
      ('Arte aprovada',      4, '#34d399', array['aprovada','aprovado'],  'criacao');
  end if;
  -- etapas iniciais do fluxo de canecas (aba Canecas)
  if not exists (select 1 from public.etapas where fluxo = 'caneca') then
    insert into public.etapas (nome, ordem, cor, palavras_chave, fluxo) values
      ('Pedido criado', 1, '#94a3b8', array['criado','novo'],       'caneca'),
      ('Impressão',     2, '#818cf8', array['impressao','imprimir'], 'caneca'),
      ('Sublimação',    3, '#f59e0b', array['sublimacao','prensa'],  'caneca'),
      ('Embalagem',     4, '#34d399', array['embalagem','embalar'],  'caneca'),
      ('Entregue',      5, '#22c55e', array['entregue','entrega'],   'caneca');
  end if;
end $$;

-- ---------- PEDIDOS ----------
create table if not exists public.pedidos (
  id uuid primary key default gen_random_uuid(),
  numero int not null unique,
  cliente text not null default '',
  descricao text not null default '',
  quantidade int not null default 1,
  prioridade text not null default 'normal' check (prioridade in ('baixa','normal','alta','urgente')),
  status text not null default 'em_andamento' check (status in ('em_andamento','concluido','cancelado','arquivado')),
  -- aba do pedido: 'pronto' (Pedidos), 'criacao' (Criação de arte), 'caneca' (Canecas)
  tipo text not null default 'pronto' check (tipo in ('pronto','criacao','caneca')),
  etapa_atual_id uuid references public.etapas(id),
  data_prevista date,
  concluido_em timestamptz,
  cancelado_em timestamptz,
  arquivado_em timestamptz,
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

-- ---------- FICHAS TÉCNICAS (uma por modelagem do pedido) ----------
create table if not exists public.fichas_tecnicas (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  modelagem text not null,
  tecido text not null default '',
  gola text not null default '',
  manga text not null default '',
  punho text not null default '',
  estampa text not null default '',
  -- grade de tamanhos: {"PP":4,"P":12,...} — cada unidade = 1 par
  grade jsonb not null default '{}'::jsonb,
  observacoes text not null default '',
  layout_anexo_id uuid references public.anexos(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists fichas_pedido_idx on public.fichas_tecnicas (pedido_id);
create index if not exists fichas_modelagem_idx on public.fichas_tecnicas (modelagem);

alter table public.anexos
  add column if not exists ficha_id uuid references public.fichas_tecnicas(id) on delete cascade;
create index if not exists anexos_ficha_idx on public.anexos (ficha_id);

alter table public.fichas_tecnicas enable row level security;
drop policy if exists "fichas_select" on public.fichas_tecnicas;
drop policy if exists "fichas_admin_insert" on public.fichas_tecnicas;
drop policy if exists "fichas_admin_update" on public.fichas_tecnicas;
drop policy if exists "fichas_admin_delete" on public.fichas_tecnicas;
create policy "fichas_select" on public.fichas_tecnicas for select to authenticated using (true);
create policy "fichas_admin_insert" on public.fichas_tecnicas for insert to authenticated with check (public.is_admin());
create policy "fichas_admin_update" on public.fichas_tecnicas for update to authenticated using (public.is_admin());
create policy "fichas_admin_delete" on public.fichas_tecnicas for delete to authenticated using (public.is_admin());

do $$ begin alter publication supabase_realtime add table public.fichas_tecnicas; exception when duplicate_object then null; end $$;

-- ---------- LOTES DE CORTE (Mapa de Corte persistente) ----------
create table if not exists public.lotes_corte (
  id uuid primary key default gen_random_uuid(),
  pedido_ids uuid[] not null default '{}',
  -- progresso: { "MANGA LONGA": { "M MASC": true } }
  progresso jsonb not null default '{}'::jsonb,
  -- retrato do que foi cortado (para o histórico não mudar depois)
  resumo jsonb not null default '{}'::jsonb,
  finalizado_em timestamptz,
  finalizado_por uuid references public.profiles(id),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists lotes_corte_aberto_idx on public.lotes_corte (finalizado_em, created_at desc);

alter table public.lotes_corte enable row level security;
drop policy if exists "lote_select" on public.lotes_corte;
drop policy if exists "lote_insert" on public.lotes_corte;
drop policy if exists "lote_update" on public.lotes_corte;
drop policy if exists "lote_admin_delete" on public.lotes_corte;
create policy "lote_select" on public.lotes_corte for select to authenticated using (true);
create policy "lote_insert" on public.lotes_corte for insert to authenticated with check (true);
create policy "lote_update" on public.lotes_corte for update to authenticated using (true);
create policy "lote_admin_delete" on public.lotes_corte for delete to authenticated using (public.is_admin());

do $$ begin alter publication supabase_realtime add table public.lotes_corte; exception when duplicate_object then null; end $$;

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

  -- conclui ao chegar na última etapa de QUALQUER fluxo, exceto 'criacao'
  -- (arte aprovada não é entrega)
  select max(ordem) into v_ultima_ordem
    from public.etapas where ativo and fluxo = v_etapa.fluxo;

  update public.pedidos
     set etapa_atual_id = p_etapa_id,
         status = case when v_etapa.fluxo <> 'criacao' and v_etapa.ordem >= v_ultima_ordem then 'concluido' else 'em_andamento' end,
         concluido_em = case when v_etapa.fluxo <> 'criacao' and v_etapa.ordem >= v_ultima_ordem then now() else null end,
         cancelado_em = null
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
  p_data_prevista date default null,
  p_tipo text default 'pronto'
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_primeira uuid;
  v_fluxo text := case when p_tipo = 'pronto' then 'producao' else p_tipo end;
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores podem criar pedidos';
  end if;

  -- o pedido nasce na primeira etapa do SEU fluxo
  select id into v_primeira from public.etapas
   where ativo and fluxo = v_fluxo
   order by ordem limit 1;

  insert into public.pedidos (numero, cliente, descricao, quantidade, prioridade, etapa_atual_id, data_prevista, tipo, created_by)
  values (p_numero, p_cliente, coalesce(p_descricao,''), p_quantidade, p_prioridade, v_primeira, p_data_prevista, coalesce(p_tipo, 'pronto'), auth.uid())
  returning id into v_id;

  insert into public.historico (pedido_id, etapa_id, funcionario_id, observacao)
  values (v_id, v_primeira, auth.uid(), 'Pedido criado');

  return v_id;
end; $$;

-- Exclui um pedido DEFINITIVAMENTE, junto com histórico e anexos.
-- Retorna os paths dos anexos para o app limpar o Storage.
create or replace function public.excluir_pedido(p_numero int)
returns text[] language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_paths text[];
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores podem excluir pedidos';
  end if;

  select id into v_id from public.pedidos where numero = p_numero;
  if not found then
    raise exception 'Pedido % não encontrado', p_numero;
  end if;

  select coalesce(array_agg(path), '{}') into v_paths
    from public.anexos where pedido_id = v_id;

  delete from public.historico where pedido_id = v_id;
  delete from public.anexos where pedido_id = v_id;
  delete from public.pedidos where id = v_id;

  return v_paths;
end; $$;

-- Zera TODA a produção: pedidos, histórico, anexos e metas.
-- Funcionários, etapas do fluxo e contas de acesso são mantidos.
create or replace function public.zerar_producao()
returns text[] language plpgsql security definer set search_path = public as $$
declare
  v_paths text[];
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores podem zerar a produção';
  end if;

  select coalesce(array_agg(path), '{}') into v_paths from public.anexos;

  -- WHERE obrigatório: a extensão safeupdate do Supabase bloqueia DELETE sem WHERE
  delete from public.historico where id is not null;
  delete from public.anexos where id is not null;
  delete from public.pedidos where id is not null;
  delete from public.metas where id is not null;

  return v_paths;
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
drop policy if exists "profiles_select" on public.profiles;
drop policy if exists "profiles_update_admin" on public.profiles;
drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_select" on public.profiles for select to authenticated using (true);
create policy "profiles_update_admin" on public.profiles for update to authenticated using (public.is_admin());
create policy "profiles_update_self" on public.profiles for update to authenticated using (id = auth.uid());

-- etapas: leitura para todos; escrita apenas admin
drop policy if exists "etapas_select" on public.etapas;
drop policy if exists "etapas_admin_insert" on public.etapas;
drop policy if exists "etapas_admin_update" on public.etapas;
drop policy if exists "etapas_admin_delete" on public.etapas;
create policy "etapas_select" on public.etapas for select to authenticated using (true);
create policy "etapas_admin_insert" on public.etapas for insert to authenticated with check (public.is_admin());
create policy "etapas_admin_update" on public.etapas for update to authenticated using (public.is_admin());
create policy "etapas_admin_delete" on public.etapas for delete to authenticated using (public.is_admin());

-- pedidos: leitura para todos; criação/edição/exclusão apenas admin
-- (funcionários movem etapas apenas pela função mover_pedido)
drop policy if exists "pedidos_select" on public.pedidos;
drop policy if exists "pedidos_admin_insert" on public.pedidos;
drop policy if exists "pedidos_admin_update" on public.pedidos;
drop policy if exists "pedidos_admin_delete" on public.pedidos;
create policy "pedidos_select" on public.pedidos for select to authenticated using (true);
create policy "pedidos_gestor_insert" on public.pedidos for insert to authenticated with check (public.pode_gerenciar_pedidos());
create policy "pedidos_gestor_update" on public.pedidos for update to authenticated using (public.pode_gerenciar_pedidos());
create policy "pedidos_gestor_delete" on public.pedidos for delete to authenticated using (public.pode_gerenciar_pedidos());

-- historico: leitura para todos; NUNCA pode ser apagado ou alterado diretamente
-- (inserções/fechamentos acontecem via funções security definer)
drop policy if exists "historico_select" on public.historico;
create policy "historico_select" on public.historico for select to authenticated using (true);

-- anexos: leitura para todos; upload por qualquer autenticado; exclusão só admin
drop policy if exists "anexos_select" on public.anexos;
drop policy if exists "anexos_insert" on public.anexos;
drop policy if exists "anexos_admin_delete" on public.anexos;
create policy "anexos_select" on public.anexos for select to authenticated using (true);
create policy "anexos_insert" on public.anexos for insert to authenticated with check (uploaded_by = auth.uid());
create policy "anexos_gestor_delete" on public.anexos for delete to authenticated using (public.pode_gerenciar_pedidos());

-- metas: leitura para todos; escrita apenas admin
drop policy if exists "metas_select" on public.metas;
drop policy if exists "metas_admin_insert" on public.metas;
drop policy if exists "metas_admin_update" on public.metas;
drop policy if exists "metas_admin_delete" on public.metas;
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
-- ESTOQUE: categorias (tópicos) + itens (subtópicos com quantidade)
-- ============================================================
create table if not exists public.estoque_categorias (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  ordem int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.estoque_itens (
  id uuid primary key default gen_random_uuid(),
  categoria_id uuid not null references public.estoque_categorias(id) on delete cascade,
  nome text not null,
  quantidade numeric not null default 0,
  ordem int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists estoque_itens_categoria_idx on public.estoque_itens (categoria_id);

alter table public.estoque_categorias enable row level security;
alter table public.estoque_itens enable row level security;

drop policy if exists "estoque_cat_select" on public.estoque_categorias;
drop policy if exists "estoque_cat_admin_insert" on public.estoque_categorias;
drop policy if exists "estoque_cat_admin_update" on public.estoque_categorias;
drop policy if exists "estoque_cat_admin_delete" on public.estoque_categorias;
create policy "estoque_cat_select" on public.estoque_categorias for select to authenticated using (true);
create policy "estoque_cat_admin_insert" on public.estoque_categorias for insert to authenticated with check (public.is_admin());
create policy "estoque_cat_admin_update" on public.estoque_categorias for update to authenticated using (public.is_admin());
create policy "estoque_cat_admin_delete" on public.estoque_categorias for delete to authenticated using (public.is_admin());

drop policy if exists "estoque_item_select" on public.estoque_itens;
drop policy if exists "estoque_item_admin_insert" on public.estoque_itens;
drop policy if exists "estoque_item_admin_update" on public.estoque_itens;
drop policy if exists "estoque_item_admin_delete" on public.estoque_itens;
create policy "estoque_item_select" on public.estoque_itens for select to authenticated using (true);
create policy "estoque_item_admin_insert" on public.estoque_itens for insert to authenticated with check (public.is_admin());
create policy "estoque_item_admin_update" on public.estoque_itens for update to authenticated using (public.is_admin());
create policy "estoque_item_admin_delete" on public.estoque_itens for delete to authenticated using (public.is_admin());

-- Ajuste de quantidade: qualquer funcionário DIMINUI (consumo); só admin AUMENTA
create or replace function public.ajustar_estoque(p_item_id uuid, p_delta numeric)
returns numeric language plpgsql security definer set search_path = public as $$
declare
  v_novo numeric;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  if p_delta > 0 and not public.is_admin() then
    raise exception 'Apenas administradores podem aumentar o estoque';
  end if;
  update public.estoque_itens
     set quantidade = greatest(0, quantidade + p_delta)
   where id = p_item_id
   returning quantidade into v_novo;
  if not found then
    raise exception 'Item não encontrado';
  end if;
  return v_novo;
end; $$;

do $$ begin
  alter publication supabase_realtime add table public.estoque_categorias;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.estoque_itens;
exception when duplicate_object then null; end $$;

-- ============================================================
-- CONFIGURAÇÕES (chave/valor) — ex.: capacidade diária de produção
-- ============================================================
create table if not exists public.config (
  chave text primary key,
  valor text not null default '',
  atualizado_em timestamptz not null default now()
);

insert into public.config (chave, valor) values ('capacidade_diaria', '80')
on conflict (chave) do nothing;
insert into public.config (chave, valor) values ('meta_diaria', '0')
on conflict (chave) do nothing;

alter table public.config enable row level security;
drop policy if exists "config_select" on public.config;
drop policy if exists "config_admin_insert" on public.config;
drop policy if exists "config_admin_update" on public.config;
create policy "config_select" on public.config for select to authenticated using (true);
create policy "config_admin_insert" on public.config for insert to authenticated with check (public.is_admin());
create policy "config_admin_update" on public.config for update to authenticated using (public.is_admin());

-- ============================================================
-- PERDAS DE MATERIAL
-- ============================================================
create table if not exists public.perdas (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid references public.pedidos(id) on delete set null,
  funcionario_id uuid references public.profiles(id),
  material text not null,
  quantidade numeric not null default 0,
  unidade text not null default 'un',
  valor numeric not null default 0,          -- valor financeiro perdido (R$)
  motivo text not null default '',
  observacoes text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists perdas_created_idx on public.perdas (created_at);
create index if not exists perdas_funcionario_idx on public.perdas (funcionario_id);

alter table public.perdas enable row level security;
drop policy if exists "perdas_select" on public.perdas;
drop policy if exists "perdas_insert" on public.perdas;
drop policy if exists "perdas_admin_update" on public.perdas;
drop policy if exists "perdas_admin_delete" on public.perdas;
create policy "perdas_select" on public.perdas for select to authenticated using (true);
create policy "perdas_insert" on public.perdas for insert to authenticated with check (funcionario_id = auth.uid());
create policy "perdas_admin_update" on public.perdas for update to authenticated using (public.is_admin());
create policy "perdas_admin_delete" on public.perdas for delete to authenticated using (public.is_admin());

do $$ begin alter publication supabase_realtime add table public.perdas; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.config; exception when duplicate_object then null; end $$;

-- ============================================================
-- PLANEJAMENTO DA SEMANA (página "Semana")
-- Referências a pedidos por setor (etapa) + dia + mensagem;
-- o pedido continua na aba dele — aqui é só o plano.
-- ============================================================
-- setores próprios do planejamento (o admin cria os que usa)
create table if not exists public.semana_setores (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  cor text not null default '#ec1c24',
  ordem int not null default 0,
  created_at timestamptz not null default now()
);
do $$ begin
  if not exists (select 1 from public.semana_setores) then
    insert into public.semana_setores (nome, cor, ordem) values
      ('Prensagem', '#f59e0b', 1),
      ('Costura',   '#fb923c', 2),
      ('Impressão', '#818cf8', 3);
  end if;
end $$;
alter table public.semana_setores enable row level security;
drop policy if exists "ssetores_select" on public.semana_setores;
drop policy if exists "ssetores_admin_insert" on public.semana_setores;
drop policy if exists "ssetores_admin_update" on public.semana_setores;
drop policy if exists "ssetores_admin_delete" on public.semana_setores;
create policy "ssetores_select" on public.semana_setores for select to authenticated using (true);
create policy "ssetores_gestor_insert" on public.semana_setores for insert to authenticated with check (public.pode_gerenciar_pedidos());
create policy "ssetores_gestor_update" on public.semana_setores for update to authenticated using (public.pode_gerenciar_pedidos());
create policy "ssetores_gestor_delete" on public.semana_setores for delete to authenticated using (public.pode_gerenciar_pedidos());
do $$ begin alter publication supabase_realtime add table public.semana_setores; exception when duplicate_object then null; end $$;

create table if not exists public.plano_semana (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid references public.pedidos(id) on delete cascade,
  setor_id uuid references public.semana_setores(id) on delete set null,
  dia date not null,
  texto text not null default '',
  feito boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists plano_semana_dia_idx on public.plano_semana (dia);

alter table public.plano_semana enable row level security;
drop policy if exists "plano_select" on public.plano_semana;
drop policy if exists "plano_admin_insert" on public.plano_semana;
drop policy if exists "plano_update" on public.plano_semana;
drop policy if exists "plano_admin_delete" on public.plano_semana;
create policy "plano_select" on public.plano_semana for select to authenticated using (true);
create policy "plano_gestor_insert" on public.plano_semana for insert to authenticated with check (public.pode_gerenciar_pedidos());
create policy "plano_gestor_update" on public.plano_semana for update to authenticated using (public.pode_gerenciar_pedidos());
create policy "plano_gestor_delete" on public.plano_semana for delete to authenticated using (public.pode_gerenciar_pedidos());

-- marcar como feito: qualquer funcionário autenticado, SÓ o campo feito
create or replace function public.marcar_feito_semana(p_id uuid, p_feito boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  update public.plano_semana set feito = p_feito where id = p_id;
  if not found then
    raise exception 'Item não encontrado';
  end if;
end; $$;

do $$ begin alter publication supabase_realtime add table public.plano_semana; exception when duplicate_object then null; end $$;

-- ============================================================
-- STORAGE: bucket de anexos
-- ============================================================
insert into storage.buckets (id, name, public)
values ('anexos', 'anexos', false)
on conflict (id) do nothing;

drop policy if exists "anexos_storage_read" on storage.objects;
drop policy if exists "anexos_storage_upload" on storage.objects;
drop policy if exists "anexos_storage_delete_admin" on storage.objects;
create policy "anexos_storage_read" on storage.objects
  for select to authenticated using (bucket_id = 'anexos');
create policy "anexos_storage_upload" on storage.objects
  for insert to authenticated with check (bucket_id = 'anexos');
create policy "anexos_storage_delete_admin" on storage.objects
  for delete to authenticated using (bucket_id = 'anexos' and public.pode_gerenciar_pedidos());

-- ============================================================
-- IMPORTANTE: após criar seu primeiro usuário (via tela de login
-- ou painel do Supabase), promova-o a administrador:
--
--   update public.profiles set role = 'admin' where email = 'seu@email.com';
-- ============================================================
