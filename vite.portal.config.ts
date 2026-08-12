import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Build do PORTAL DO CLIENTE — site separado do dashboard.
 *
 * Compartilha o mesmo banco, o mesmo cliente Supabase (src/lib/supabase.ts)
 * e as mesmas variáveis de ambiente, mas gera um bundle próprio: o código
 * do dashboard nunca chega ao navegador do cliente.
 *
 *   npm run dev:portal     → desenvolvimento
 *   npm run build:portal   → gera dist-portal/ para publicar
 */
export default defineConfig({
  root: 'portal',
  // as variáveis VITE_* ficam no .env da raiz, junto com as do dashboard
  envDir: '..',
  // reaproveita os ícones da marca, sem duplicar arquivos
  publicDir: '../public',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    // permite importar de ../src (cliente Supabase e tipos compartilhados)
    fs: { allow: ['..'] },
  },
  build: {
    outDir: '../dist-portal',
    emptyOutDir: true,
  },
})
