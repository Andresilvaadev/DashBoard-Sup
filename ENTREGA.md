# Guia de entrega / troca de contas

Este guia cobre as duas trocas ao entregar o site para o cliente:

1. **Supabase** — mudar para o projeto no nome da empresa compradora.
2. **Cloudinary** — passar a guardar as imagens dos pedidos no Cloudinary.

O código já está preparado: **é só preencher as chaves e rodar o SQL**. Nada
no código precisa mudar.

---

## 1. Trocar o Supabase

1. Crie (ou peça ao cliente para criar) um projeto novo em <https://supabase.com>.
2. No painel do projeto novo: **SQL Editor → New query** → cole **todo** o
   conteúdo de [`supabase/schema.sql`](supabase/schema.sql) e clique **Run**.
   Isso cria tudo de uma vez: tabelas, funções, permissões, realtime e o
   bucket de anexos. (É a instalação completa e atualizada.)
3. Crie o primeiro usuário: na tela de login do site, cadastre-se com o e-mail
   do administrador. Depois, no **SQL Editor**, promova-o a admin:
   ```sql
   update public.profiles set role = 'admin' where email = 'email_do_admin@empresa.com';
   ```
4. Pegue as chaves do projeto novo em **Project Settings → API**:
   - `Project URL`  → vai em `VITE_SUPABASE_URL`
   - `anon public`  → vai em `VITE_SUPABASE_ANON_KEY`
5. Atualize o arquivo `.env` (local) e as **variáveis de ambiente do site
   publicado** (Vercel/Netlify) com esses dois valores. **Refaça o deploy.**

> Observação: as chaves são lidas na hora do build. Sem refazer o deploy com as
> novas variáveis, o site publicado continua apontando para o projeto antigo.

---

## 2. Ativar o Cloudinary para as imagens

Enquanto as chaves do Cloudinary ficarem **em branco**, o site guarda as imagens
no próprio Supabase (como hoje). Ao preenchê-las, as novas imagens passam a ir
para o Cloudinary automaticamente.

1. Crie uma conta em <https://cloudinary.com> (o plano grátis é generoso).
2. No painel: **Settings → Upload → Upload presets → Add upload preset**.
   - **Signing Mode: Unsigned** (permite enviar direto do navegador, sem backend).
   - Salve e anote o **nome do preset**.
3. Anote o **Cloud name** (aparece no topo do painel / em Settings → Account).
4. Preencha no `.env` (e nas variáveis do site publicado):
   ```
   VITE_CLOUDINARY_CLOUD_NAME=seu_cloud_name
   VITE_CLOUDINARY_UPLOAD_PRESET=nome_do_preset
   ```
5. Refaça o deploy.

### O que muda com o Cloudinary ligado
- As fotos novas vão para o Cloudinary; as listas usam **miniaturas** geradas por
  ele (economiza muita banda).
- As imagens antigas que já estavam no Supabase **continuam abrindo** normalmente
  (o site detecta cada caso automaticamente).
- **Exclusão:** ao excluir um pedido/anexo, o registro sai do banco, mas o arquivo
  no Cloudinary **não** é apagado pelo navegador (isso exigiria a chave secreta).
  Como o plano é grande, isso é aceitável; se quiser, dá para limpar depois pelo
  painel do Cloudinary.

---

## Checklist final antes de entregar

- [ ] `schema.sql` rodado no Supabase novo, sem erros.
- [ ] Usuário admin criado e promovido.
- [ ] `.env` / variáveis do site com as chaves **novas** do Supabase.
- [ ] (Opcional) Chaves do Cloudinary preenchidas.
- [ ] Deploy refeito.
- [ ] Login testado no site publicado.
- [ ] **Admin → Sistema → Zerar produção** para começar limpo com os dados do cliente.
