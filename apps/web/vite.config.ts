import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// 与 API server 一致：读 API_PORT，默认 8787（不用 PORT，避免被部署工具注入覆盖）。
// 目标写 127.0.0.1 而非 localhost：server 默认只绑 IPv4 回环，
// 而 macOS 上 localhost 常先解析到 ::1，会导致代理 ECONNREFUSED
const apiPort = Number(process.env.API_PORT ?? 8787) || 8787;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': `http://127.0.0.1:${apiPort}`,
    },
  },
});
