import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // usa a porta indicada pelo ambiente (preview) ou a padrão 5173
  server: { port: Number(process.env.PORT) || 5173 },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          graficos: ['recharts'],
          exportacao: ['jspdf', 'jspdf-autotable', 'xlsx'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Supreme — Dashboard de Produção',
        short_name: 'Supreme',
        description: 'Sistema interno de acompanhamento de produção da Supreme',
        theme_color: '#060b26',
        background_color: '#060b26',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        lang: 'pt-BR',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallbackDenylist: [/^\/api/]
      }
    })
  ]
})
