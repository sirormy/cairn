import { defineConfig } from 'vitest/config';

// 独立于 vite.config.ts：测试只跑纯逻辑（SSE 解析 / 事件状态机），不加载 react 与 tailwind 插件
export default defineConfig({
  test: {
    environment: 'node',
  },
});
