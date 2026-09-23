import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './playwright',
  // M-B 门禁仅跑 smoke；UI交互测试按需运行（手动指定文件时自动匹配）
  testMatch: ['smoke.spec.ts', 'ui-interaction.spec.ts', 'coverage.spec.ts', 'm-c-automation.spec.ts', 'm-c-v5-worker.spec.ts', 'm-c-v6-ui.spec.ts', 'm-c-b-collector.spec.ts'],
  // ℹ️ 门禁 npm run e2e 只跑 smoke（通过文件过滤器）；UI测试手动触发：node node_modules/@playwright/test/cli.js test "ui-interaction" --config=tests/playwright.config.ts
  fullyParallel: false,
  forbidOnly: false,
  retries: 0,
  workers: 1,
  timeout: 120000,
  reporter: [['list'], ['html', { open: 'never', outputFolder: '../tests/playwright-report' }]],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 10000,
    navigationTimeout: 30000,
  },
  // Web 服务器：默认**不启用**（smoke 走已构建产物 dist/，§5.5）。仅当 E2E_DEV=1 连 dev server 调试时才启动。
  // 置于顶层（webServer 只属 TestConfig，写在 project 内会被 Playwright 静默忽略）；端口与 vite.config.ts 一致（5173）。
  webServer: process.env.E2E_DEV === '1' ? {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 30000,
  } : undefined,
  // 项目配置：仅 electron 一个门禁项目（smoke 的 electronTest fixture 总走 Electron）。
  // 原 chrome 项目无 window.electronAPI 且与 electron 重复跑同一例，按 §5.5 移除。
  projects: [
    {
      name: 'electron',
      use: {},
    },
  ],
});
