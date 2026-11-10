import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    build: {
      emptyOutDir: false,
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      port: 3001,
      strictPort: true,
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: {
        ignored: [
          '**/.delta_auto_trader_state.json',
          '**/public/**',
          '**/*.json',
          '**/.system_generated/**',
          '**/.user_uploaded/**',
          '**/brain/**',
          '**/dist/**',
          '**/.git/**',
        ],
      },
    },
    preview: {
      port: 3001,
      strictPort: true,
    },
  };
});
