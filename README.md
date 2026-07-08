# Dashboard de Produção — Sistema Interno

PWA de acompanhamento de produção em tempo real: pedidos, etapas, histórico imutável,
comandos de voz, metas, relatórios com exportação PDF/Excel e anexos de arquivos.

**Stack:** React + TypeScript + Vite + Tailwind CSS + Supabase (PostgreSQL, Auth, Storage, Realtime) + PWA.

---

## 🚀 Como colocar no ar

### 1. Criar o projeto no Supabase

1. Acesse [supabase.com](https://supabase.com) e crie um projeto.
2. No painel, abra **SQL Editor** → **New query**.
3. Cole todo o conteúdo de [`supabase/schema.sql`](supabase/schema.sql) e execute (**Run**).
   Isso cria as tabelas, o fluxo padrão de 9 etapas, as políticas de segurança (RLS),
   o Realtime e o bucket de arquivos.
4. Em **Authentication → Providers → Email**, deixe **Email** habilitado.
   Recomendado para uso interno: desative **"Confirm email"** para que contas criadas
   pelo admin funcionem imediatamente.

### 2. Configurar o app

```bash
# copie o exemplo e preencha com os dados do painel (Project Settings -> API)
copy .env.example .env
```

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
```

### 3. Rodar

```bash
npm install
npm run dev        # desenvolvimento
npm run build      # produção (gera dist/ com PWA)
```

### 4. Criar o primeiro administrador

1. No painel do Supabase: **Authentication → Users → Add user** (email + senha).
2. No **SQL Editor**, promova-o:

```sql
update public.profiles set role = 'admin' where email = 'admin@supreme.com';
```

3. Faça login no app. A partir daí, cadastre os demais funcionários em **Admin → Funcionários**.

---

## 🎙️ Comandos de voz

Toque no botão do microfone e fale, por exemplo:

- `"1234 corte"`
- `"pedido 1234 foi para costura"`
- `"pedido 1234 foi entregue"`

O sistema identifica o número do pedido e a etapa, registra quem falou, data/hora,
e atualiza todos os dashboards em tempo real. Se a interpretação não for confiável,
uma confirmação é exibida antes de salvar.

As palavras-chave que ativam cada etapa são editáveis em **Admin → Fluxo de produção**.

> Requer navegador com Web Speech API (Chrome/Edge/Safari) e conexão HTTPS
> (obrigatória para microfone — o `npm run dev` em localhost também funciona).

## 🔄 Fluxo de produção

Padrão: Pedido criado → Arte → Ficha técnica → Impressão → Corte → Prensagem → Costura → Embalagem → Entregue.

O administrador pode **criar, renomear, reordenar, colorir, desativar e excluir** etapas.
Cada movimentação grava entrada, saída, funcionário responsável e tempo gasto — o
histórico é **imutável** (o banco não permite apagar nem editar registros).

## 📱 PWA

O build gera manifest + service worker (atualização automática). No celular,
use "Adicionar à tela inicial" para instalar. Para melhor suporte a ícones no iOS,
substitua os SVGs em `public/` por PNGs 192×192 e 512×512 e ajuste o `vite.config.ts`.

## 🔐 Segurança

- Login obrigatório (Supabase Auth) e controle de acesso por função (admin/funcionário).
- Row Level Security em todas as tabelas: funcionários movem pedidos apenas pela função
  `mover_pedido` (auditada); criação/edição/exclusão de pedidos, etapas, metas e
  usuários é restrita a administradores no próprio banco.
- Histórico protegido por RLS: sem política de UPDATE/DELETE = ninguém apaga.
- Arquivos em bucket privado, acessados por URLs assinadas temporárias.

## 🗂️ Estrutura

```
supabase/schema.sql      # todo o banco: tabelas, RLS, funções, realtime, storage
src/
  contexts/              # Auth (sessão + perfil) e Toast
  hooks/                 # usePedidos / useEtapas (com Supabase Realtime)
  utils/                 # voz (interpretação), tempo, exportação PDF/Excel
  components/            # Layout responsivo, VoiceButton, cards, modais
  pages/                 # Dashboard, Pedidos, Detalhe, Relatórios, Login
  pages/admin/           # Funcionários, Fluxo de etapas, Metas
```

## 🌐 Deploy

Qualquer host estático com HTTPS (Vercel, Netlify, Cloudflare Pages):

```bash
npm run build   # publique a pasta dist/
```

Configure as variáveis `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` no painel do host.
Em hosts com SPA, habilite o fallback de rotas para `index.html`.
