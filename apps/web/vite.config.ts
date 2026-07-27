import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// Port and API target come from the env file the dev script loads, so the same code
// serves both the live workspace (.env → :5173 → :3000) and the demo/testing one
// (.env.demo → :5273 → :3100). Defaults keep `npm run dev:web` working unchanged.
const WEB_PORT = Number(process.env.WEB_PORT ?? 5173);
const API_TARGET = process.env.API_PROXY_TARGET ?? 'http://localhost:3000';
// Shown as a badge in the app so the demo can never be mistaken for live.
const ENV_LABEL = process.env.VITE_ENV_LABEL ?? '';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Keep the stable framework libraries in their own chunk so they stay cached
        // across app deploys (app code changes far more often than these do).
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'query-vendor': ['@tanstack/react-query'],
        },
      },
    },
  },
  define: {
    // Vite only auto-exposes VITE_* from its own .env files; ours arrives via dotenv-cli.
    'import.meta.env.VITE_ENV_LABEL': JSON.stringify(ENV_LABEL),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@masquare/ui': fileURLToPath(new URL('../../packages/ui/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: WEB_PORT,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
});
