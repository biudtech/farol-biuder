import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Teto de 4 workers: é o limite combinado para qualquer suíte nesta base.
export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    maxWorkers: 4,
    restoreMocks: true,
  },
});
