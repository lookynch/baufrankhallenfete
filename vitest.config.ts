import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/server/**/*.ts', 'src/shared/**/*.ts'],
      thresholds: {
        'src/server/security/**': { lines: 80, functions: 80 },
        'src/server/services/**': { lines: 70, functions: 70 },
      },
    },
  },
});
