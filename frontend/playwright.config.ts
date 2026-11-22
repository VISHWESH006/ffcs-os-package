import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(frontendRoot, '..');
const pythonBin = process.env.PYTHON_BIN ?? (process.platform === 'win32' ? 'python' : 'python3');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: 'http://127.0.0.1:13000',
    browserName: 'chromium',
    headless: true,
    launchOptions: { channel: 'chrome' },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node --enable-source-maps api-server/dist/index.mjs',
      cwd: packageRoot,
      url: 'http://127.0.0.1:18080/api/healthz',
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        NODE_ENV: 'test', FFCS_TEST_AUTH: '1', FFCS_TEST_AUTH_DEFAULT_UID: 'browser-test-user', PORT: '18080', WORKSPACE_ROOT: packageRoot,
        CORS_ORIGINS: 'http://127.0.0.1:13000',
        PYTHON_BIN: pythonBin, FFCS_PYTHON_TIMEOUT_MS: '30000',
        FFCS_STORE_PATH: path.join(frontendRoot, 'test-results', 'phase17-store.json'),
      },
    },
    {
      command: 'node scripts/serve-frontend.mjs frontend/dist 13000',
      cwd: packageRoot,
      url: 'http://127.0.0.1:13000',
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
