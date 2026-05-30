import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  test: {
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
    projects: [
      {
        plugins: [react()],
        resolve: {
          alias: { '@': path.resolve(__dirname, './src') },
        },
        test: {
          name: 'unit',
          environment: 'jsdom',
          globals: true,
          include: ['tests/unit/**/*.{test,spec}.{ts,tsx}'],
          exclude: ['node_modules', '.next', 'tests/e2e'],
        },
      },
      {
        resolve: {
          alias: { '@': path.resolve(__dirname, './src') },
        },
        test: {
          name: 'integration',
          environment: 'node',
          globals: true,
          include: ['tests/integration/**/*.{test,spec}.{ts,tsx}'],
          exclude: ['node_modules', '.next', 'tests/e2e'],
          setupFiles: ['./tests/_setup/integration-setup.ts'],
        },
      },
    ],
  },
})
