import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// 与 API server 一致：读 API_PORT，默认 8787（不用 PORT，避免被部署工具注入覆盖）
const apiPort = Number(process.env.API_PORT ?? 8787) || 8787;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': `http://localhost:${apiPort}`,
    },
  },
});
