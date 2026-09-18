import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    // DB 集成测试需要 Node-ABI 的 better-sqlite3 二进制（app 用 Electron-ABI），
    // globalSetup 自动准备到 .test-native/，env 把路径转发给各测试 worker
    globalSetup: ['./scripts/ensure-test-native.mjs'],
    env: {
      BETTER_SQLITE3_NATIVE_BINDING: path.resolve(__dirname, '.test-native/better_sqlite3.node'),
    },
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'src/utils/**',
        'src/stores/**',
        'src/main/services/cache.ts',
        'src/main/services/export-service.ts',
        'src/main/services/database.ts',
        'src/main/utils/histogram.ts',
      ],
    },
  },
})
