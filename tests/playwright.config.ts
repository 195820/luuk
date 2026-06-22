import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './playwright',
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
  // 项目配置
  projects: [
    {
      name: 'chrome',
      use: {
        channel: 'chrome',
      },
      // Web 服务器配置（连接已有的 dev server）
      webServer: {
        url: 'http://localhost:5174',
        reuseExistingServer: true,
        timeout: 30000,
      },
    },
    {
      name: 'electron',
      use: {},
      // Electron 测试不需要 webServer
    },
  ],
});
