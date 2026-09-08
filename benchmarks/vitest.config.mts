import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '#benchmark-source': resolve(
        process.env.BENCH_SOURCE || 'src',
        'ReactKonva.ts',
      ),
    },
  },
  test: {
    include: ['benchmarks/events.bench.tsx'],
    browser: {
      enabled: true,
      commands: {
        saveResults: (_, data) =>
          writeFileSync(process.env.BENCH_OUTPUT!, JSON.stringify(data)),
      },
      provider: playwright(),
      headless: true,
      instances: [{ browser: 'chromium' }],
    },
  },
});
