import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const e2eFixturePath = fileURLToPath(
  new URL('./tests/fixtures/e2e-scenarios.json', import.meta.url),
);

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_E2E_FIXTURES_JSON': JSON.stringify(
      mode === 'e2e' ? readFileSync(e2eFixturePath, 'utf8') : '',
    ),
  },
  server: {
    allowedHosts: ['moon-courier-vite', 'moon-courier-e2e-vite'],
  },
  build: {
    chunkSizeWarningLimit: 1_500,
  },
}));
