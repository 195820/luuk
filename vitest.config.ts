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
